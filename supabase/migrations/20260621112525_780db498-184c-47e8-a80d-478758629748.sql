-- ============================================================================
-- Database Cleanup hardening — Phases 1, 3 & 4
--   1. Persistent dismissals so users don't see the same finding twice
--   2. Pre-action snapshot table for undo / audit
--   3. FK-introspection RPC + transactional merge RPC (auto repoint, atomic)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- cleanup_dismissals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cleanup_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  finding_id text NOT NULL,
  module text NOT NULL,
  rule text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, finding_id)
);

GRANT SELECT, INSERT, DELETE ON public.cleanup_dismissals TO authenticated;
GRANT ALL ON public.cleanup_dismissals TO service_role;

ALTER TABLE public.cleanup_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own dismissals select" ON public.cleanup_dismissals;
CREATE POLICY "own dismissals select"
  ON public.cleanup_dismissals FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "own dismissals insert" ON public.cleanup_dismissals;
CREATE POLICY "own dismissals insert"
  ON public.cleanup_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own dismissals delete" ON public.cleanup_dismissals;
CREATE POLICY "own dismissals delete"
  ON public.cleanup_dismissals FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE INDEX IF NOT EXISTS cleanup_dismissals_user_idx
  ON public.cleanup_dismissals(user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- cleanup_audit  (snapshot of every destructive cleanup action — undo source)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cleanup_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('delete','patch','merge','tombstone')),
  table_name text NOT NULL,
  record_ids uuid[] NOT NULL DEFAULT '{}',
  survivor_id uuid,
  payload jsonb,
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  error text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cleanup_audit TO authenticated;
GRANT ALL ON public.cleanup_audit TO service_role;

ALTER TABLE public.cleanup_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read cleanup audit" ON public.cleanup_audit;
CREATE POLICY "admins read cleanup audit"
  ON public.cleanup_audit FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE INDEX IF NOT EXISTS cleanup_audit_actor_idx
  ON public.cleanup_audit(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cleanup_audit_table_idx
  ON public.cleanup_audit(table_name, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cleanup_audit_request_unique
  ON public.cleanup_audit(actor_user_id, request_id)
  WHERE request_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- get_fk_repoints(table_name)
--   Returns every foreign key in public.* that references <table_name>.id.
--   The cleanup action uses this to repoint child rows during a merge instead
--   of relying on a hand-maintained map.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fk_repoints(_table_name text)
RETURNS TABLE(child_table text, child_column text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tc.table_name::text  AS child_table,
    kcu.column_name::text AS child_column
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc
    ON tc.constraint_name = rc.constraint_name
   AND tc.table_schema = rc.constraint_schema
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = rc.constraint_name
   AND kcu.table_schema = rc.constraint_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = rc.constraint_name
   AND ccu.table_schema = rc.constraint_schema
  WHERE tc.table_schema = 'public'
    AND ccu.table_schema = 'public'
    AND ccu.table_name = _table_name
    AND ccu.column_name = 'id'
    AND tc.constraint_type = 'FOREIGN KEY';
$$;

GRANT EXECUTE ON FUNCTION public.get_fk_repoints(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- cleanup_merge_records(table, survivor, losers, request_id)
--   Transactional merge: repoints every public FK that targets <table>.id
--   from losers → survivor, then deletes the losers, then writes a snapshot
--   row to cleanup_audit. Aborts atomically on any error.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_merge_records(
  _table text,
  _survivor uuid,
  _losers uuid[],
  _request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_fk record;
  v_repoints jsonb := '[]'::jsonb;
  v_repointed bigint;
  v_snapshot jsonb := '[]'::jsonb;
  v_loser_row jsonb;
  v_audit_id uuid;
  v_deleted bigint := 0;
  v_existing_audit uuid;
BEGIN
  -- AuthZ: admin or super_admin only.
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'permission_denied: cleanup_merge_records requires admin role' USING ERRCODE = '42501';
  END IF;

  IF _table IS NULL OR _table = '' THEN
    RAISE EXCEPTION 'table is required';
  END IF;
  IF _survivor IS NULL THEN
    RAISE EXCEPTION 'survivor is required';
  END IF;
  IF _losers IS NULL OR array_length(_losers, 1) IS NULL THEN
    RAISE EXCEPTION 'losers must be a non-empty array';
  END IF;
  IF _survivor = ANY(_losers) THEN
    RAISE EXCEPTION 'survivor must not appear in losers';
  END IF;

  -- Idempotency: if we've already processed this request_id, return its result.
  IF _request_id IS NOT NULL THEN
    SELECT id INTO v_existing_audit
    FROM public.cleanup_audit
    WHERE actor_user_id = auth.uid()
      AND request_id = _request_id;
    IF v_existing_audit IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'audit_id', v_existing_audit);
    END IF;
  END IF;

  -- Snapshot losers BEFORE we mutate anything.
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%I t WHERE id = ANY($1)',
    _table
  ) INTO v_snapshot USING _losers;

  -- Repoint every FK in public.* that references <table>.id from losers → survivor.
  FOR v_fk IN
    SELECT child_table, child_column FROM public.get_fk_repoints(_table)
  LOOP
    BEGIN
      EXECUTE format(
        'UPDATE public.%I SET %I = $1 WHERE %I = ANY($2)',
        v_fk.child_table, v_fk.child_column, v_fk.child_column
      )
      USING _survivor, _losers;
      GET DIAGNOSTICS v_repointed = ROW_COUNT;
      v_repoints := v_repoints || jsonb_build_object(
        'table', v_fk.child_table,
        'column', v_fk.child_column,
        'rows', v_repointed
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'repoint failed for %.%: %', v_fk.child_table, v_fk.child_column, SQLERRM;
    END;
  END LOOP;

  -- Delete losers from the parent table.
  EXECUTE format('DELETE FROM public.%I WHERE id = ANY($1)', _table) USING _losers;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Record audit.
  INSERT INTO public.cleanup_audit (
    actor_user_id, action, table_name, record_ids, survivor_id,
    snapshot, result, request_id
  ) VALUES (
    auth.uid(), 'merge', _table, _losers, _survivor,
    v_snapshot,
    jsonb_build_object('repoints', v_repoints, 'deleted', v_deleted),
    _request_id
  )
  RETURNING id INTO v_audit_id;

  -- Mirror to security_audit_log so it shows up in the existing audit UI.
  BEGIN
    INSERT INTO public.security_audit_log (user_id, action, resource_type, resource_id, details)
    VALUES (
      auth.uid(),
      'cleanup_merge',
      _table,
      _survivor::text,
      jsonb_build_object(
        'audit_id', v_audit_id,
        'losers', to_jsonb(_losers),
        'repoints', v_repoints,
        'deleted', v_deleted
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true,
    'audit_id', v_audit_id,
    'survivor', _survivor,
    'deleted', v_deleted,
    'repoints', v_repoints
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_merge_records(text, uuid, uuid[], text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- cleanup_snapshot_rows(table, ids)
--   Helper the edge function calls right before a bulk delete to capture an
--   undo-able snapshot. Service-role only (called from edge functions).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_snapshot_rows(_table text, _ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%I t WHERE id = ANY($1)',
    _table
  ) INTO v_rows USING _ids;
  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_snapshot_rows(text, uuid[]) TO service_role;
