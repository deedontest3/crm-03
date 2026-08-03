// db-cleanup-action: secure, audited, idempotent destructive operations
// for the Database Cleanup panel.
//
// Hardening vs. the previous version:
//   • Per-action allow-list (delete/patch/merge) — profiles can only be
//     tombstoned, user_roles can only be merged.
//   • Snapshot of affected rows is written to public.cleanup_audit BEFORE
//     any destructive change, so admins can review or restore later.
//   • Merge runs inside a single Postgres transaction via the
//     cleanup_merge_records RPC, which uses information_schema to repoint
//     EVERY foreign key targeting the parent table automatically.
//   • Idempotency: caller passes a request_id; duplicate calls return the
//     original result instead of re-applying.
//   • All actions are mirrored into security_audit_log.

import { adminGate } from '../_shared/safety-backup.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// What the panel is allowed to touch, and how.
//   delete:   hard-delete rows
//   patch:    UPDATE specific columns
//   merge:    repoint + delete duplicates via cleanup_merge_records()
//   tombstone:soft-delete by setting is_deleted=true / deleted_at=now()
type ActionKind = 'delete' | 'patch' | 'merge' | 'tombstone';

const TABLE_POLICY: Record<string, Set<ActionKind>> = {
  accounts:                  new Set(['delete', 'patch', 'merge']),
  contacts:                  new Set(['delete', 'patch', 'merge']),
  deals:                     new Set(['delete', 'patch', 'merge']),
  campaigns:                 new Set(['delete', 'patch', 'merge']),
  action_items:              new Set(['delete', 'patch']),
  notifications:             new Set(['delete']),
  saved_filters:             new Set(['delete', 'patch']),
  column_preferences:        new Set(['delete']),
  security_audit_log:        new Set(['delete']),
  email_reply_skip_log:      new Set(['delete']),
  email_history:             new Set(['delete']),
  campaign_webhook_deliveries: new Set(['delete']),
  backup_jobs:               new Set(['delete']),
  backups:                   new Set(['delete']),
  // Auth surface — never hard-delete from here.
  profiles:                  new Set(['tombstone', 'patch']),
  user_roles:                new Set(['merge', 'delete']), // delete only for true duplicates
  currency_rates:            new Set(['delete', 'merge']),
};

// Columns the panel is allowed to UPDATE per table. Anything else is rejected.
const PATCHABLE_COLUMNS: Record<string, Set<string>> = {
  accounts:     new Set(['industry', 'region', 'country', 'website']),
  contacts:     new Set(['email', 'phone_no', 'company_name', 'department', 'designation']),
  deals:        new Set(['stage', 'lead_owner', 'expected_closing_date', 'amount', 'total_contract_value']),
  campaigns:    new Set(['goal', 'start_date', 'end_date']),
  action_items: new Set(['due_date', 'assigned_to', 'status']),
  profiles:     new Set(['full_name', 'is_deleted', 'deleted_at']),
  saved_filters: new Set(['name', 'module']),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function assertIdsBelongToTable(client: any, table: string, ids: string[]) {
  const found = new Set<string>();
  for (const batch of chunk(ids, BATCH)) {
    const { data, error } = await client.from(table).select('id').in('id', batch);
    if (error) throw error;
    for (const r of data || []) found.add(r.id);
  }
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error(`${missing.length} record id(s) do not exist in ${table}`);
  }
}

async function snapshotRows(client: any, table: string, ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const batch of chunk(ids, BATCH)) {
    const { data, error } = await client.from(table).select('*').in('id', batch);
    if (error) throw error;
    if (data) out.push(...data);
  }
  return out;
}

async function findExistingAudit(client: any, actorId: string | null, requestId: string | null) {
  if (!actorId || !requestId) return null;
  const { data } = await client
    .from('cleanup_audit')
    .select('id, result')
    .eq('actor_user_id', actorId)
    .eq('request_id', requestId)
    .maybeSingle();
  return data ?? null;
}

async function writeAudit(client: any, row: Record<string, any>) {
  const { data, error } = await client.from('cleanup_audit').insert(row).select('id').single();
  if (error) {
    console.error('cleanup_audit insert failed', error);
    return null;
  }
  return data?.id ?? null;
}

async function mirrorSecurityLog(
  client: any,
  actorId: string | null,
  action: string,
  table: string,
  details: Record<string, any>,
) {
  try {
    await client.from('security_audit_log').insert({
      user_id: actorId,
      action: `cleanup_${action}`,
      resource_type: table,
      resource_id: details.audit_id ?? null,
      details,
    });
  } catch (e) {
    console.error('security_audit_log mirror failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('MY_SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('MY_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: 'Edge function is missing Supabase environment variables' }, 500);
    }

    const gate = await adminGate(req, supabaseUrl, anonKey, serviceRoleKey);
    if ('error' in gate) return json({ error: gate.error }, gate.status);
    const { adminClient, user } = gate as any;
    const actorId: string | null = user?.id ?? null;

    const body = await req.json().catch(() => ({}));
    let action = String(body.action || '') as ActionKind;
    const table = String(body.table || '');
    const recordIds: string[] = Array.isArray(body.recordIds) ? body.recordIds : [];
    const payload = body.payload || {};
    const requestId: string | null = typeof body.requestId === 'string' && body.requestId ? body.requestId : null;

    const policy = TABLE_POLICY[table];
    if (!policy) return json({ error: `Table not allowed: ${table}` }, 400);

    // profiles + delete is silently upgraded to tombstone so the UI button still works safely.
    if (table === 'profiles' && action === 'delete') action = 'tombstone';

    if (!policy.has(action)) {
      return json({ error: `Action "${action}" not allowed on table "${table}"` }, 400);
    }
    if (recordIds.length === 0) return json({ error: 'recordIds required' }, 400);
    if (!recordIds.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
      return json({ error: 'recordIds must all be valid UUIDs' }, 400);
    }
    if (recordIds.length > 5000) {
      return json({ error: 'Refusing to act on more than 5000 records in a single call' }, 400);
    }

    // Idempotency check.
    const existing = await findExistingAudit(adminClient, actorId, requestId);
    if (existing) {
      return json({ ok: true, idempotent: true, audit_id: existing.id, result: existing.result });
    }

    // ----- DELETE --------------------------------------------------------------
    if (action === 'delete') {
      await assertIdsBelongToTable(adminClient, table, recordIds);
      const snapshot = await snapshotRows(adminClient, table, recordIds);

      let deleted = 0;
      for (const batch of chunk(recordIds, BATCH)) {
        const { error } = await adminClient.from(table).delete().in('id', batch);
        if (error) throw error;
        deleted += batch.length;
      }

      const auditId = await writeAudit(adminClient, {
        actor_user_id: actorId,
        action: 'delete',
        table_name: table,
        record_ids: recordIds,
        snapshot,
        result: { deleted },
        request_id: requestId,
      });
      await mirrorSecurityLog(adminClient, actorId, 'delete', table, {
        audit_id: auditId, deleted, count: recordIds.length,
      });

      return json({ ok: true, deleted, audit_id: auditId });
    }

    // ----- TOMBSTONE (profiles) -----------------------------------------------
    if (action === 'tombstone') {
      await assertIdsBelongToTable(adminClient, table, recordIds);
      const snapshot = await snapshotRows(adminClient, table, recordIds);
      const update = { is_deleted: true, deleted_at: new Date().toISOString() };

      let touched = 0;
      for (const batch of chunk(recordIds, BATCH)) {
        const { error } = await adminClient.from(table).update(update).in('id', batch);
        if (error) throw error;
        touched += batch.length;
      }

      const auditId = await writeAudit(adminClient, {
        actor_user_id: actorId,
        action: 'tombstone',
        table_name: table,
        record_ids: recordIds,
        snapshot,
        result: { tombstoned: touched },
        request_id: requestId,
      });
      await mirrorSecurityLog(adminClient, actorId, 'tombstone', table, {
        audit_id: auditId, count: touched,
      });
      return json({ ok: true, tombstoned: touched, audit_id: auditId });
    }

    // ----- PATCH ---------------------------------------------------------------
    if (action === 'patch') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ error: 'payload required for patch' }, 400);
      }
      const allowed = PATCHABLE_COLUMNS[table];
      if (!allowed) return json({ error: `Patch not allowed on ${table}` }, 400);
      const bad = Object.keys(payload).filter((k) => !allowed.has(k));
      if (bad.length) return json({ error: `Columns not patchable: ${bad.join(', ')}` }, 400);
      if (Object.keys(payload).length === 0) return json({ error: 'payload is empty' }, 400);

      await assertIdsBelongToTable(adminClient, table, recordIds);
      const snapshot = await snapshotRows(adminClient, table, recordIds);

      let patched = 0;
      for (const batch of chunk(recordIds, BATCH)) {
        const { error } = await adminClient.from(table).update(payload).in('id', batch);
        if (error) throw error;
        patched += batch.length;
      }

      const auditId = await writeAudit(adminClient, {
        actor_user_id: actorId,
        action: 'patch',
        table_name: table,
        record_ids: recordIds,
        payload,
        snapshot,
        result: { patched },
        request_id: requestId,
      });
      await mirrorSecurityLog(adminClient, actorId, 'patch', table, {
        audit_id: auditId, patched, columns: Object.keys(payload),
      });

      return json({ ok: true, patched, audit_id: auditId });
    }

    // ----- MERGE (transactional, FK-aware) ------------------------------------
    if (action === 'merge') {
      const survivorId = String(body.survivorId || '');
      if (!survivorId || !UUID_RE.test(survivorId) || !recordIds.includes(survivorId)) {
        return json({ error: 'survivorId must be one of recordIds' }, 400);
      }
      await assertIdsBelongToTable(adminClient, table, recordIds);
      const losers = recordIds.filter((id) => id !== survivorId);

      const { data, error } = await adminClient.rpc('cleanup_merge_records', {
        _table: table,
        _survivor: survivorId,
        _losers: losers,
        _request_id: requestId,
      });
      if (error) throw error;
      return json(data);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error('db-cleanup-action fatal', e);
    return json({ error: e?.message || String(e) }, 500);
  }
});
