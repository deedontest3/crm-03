// edge function: restore-advanced-backup (async job)
import { adminGate, createSafetyBackup } from '../_shared/safety-backup.ts';
import { loadEnvelopeFromPath, assertAdvancedEnvelope } from '../_shared/envelope-loader.ts';
import {
  canonicalize, deepEqual, isVolatileColumn, isEmailColumn, isMetadataColumn,
} from '../_shared/diff-canonicalize.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Wraps canonicalize with the per-column options the diff function uses so the
// "skip no-op upsert" check here mirrors the UI's "unchanged" classification.
function canonForColumn(col: string, v: any) {
  return canonicalize(v, undefined, { lowercase: isEmailColumn(col) });
}

const INSERT_ORDER = [
  'profiles', 'user_roles',
  'accounts', 'leads', 'contacts', 'deals',
  'lead_action_items', 'deal_action_items', 'action_items',
  'notifications', 'notification_preferences', 'saved_filters',
  'column_preferences', 'dashboard_preferences',
  'user_preferences', 'yearly_revenue_targets', 'page_permissions',
];
const DELETE_ORDER = [...INSERT_ORDER].reverse();

interface TablePlan {
  name: string;
  mode: 'replace' | 'merge-upsert' | 'append-only' | 'skip';
  includeColumns?: string[];
  columnMap?: Record<string, string>;
}

/**
 * Per-row, per-column override map.
 *   rowOverrides[table][rowId].action = 'skip' | 'apply'
 *   rowOverrides[table][rowId].columns[col] = 'live' | 'backup' | 'null'
 *
 * When `action === 'skip'`, the row is removed from the upsert batch entirely.
 * When `columns[col] === 'live'`, that column is dropped from the upserted row
 *   so PG keeps the existing value.
 * When `columns[col] === 'null'`, the column is explicitly set to NULL.
 * Default (entry missing) is `backup` — backup value wins, current behaviour.
 */
type RowOverrideAction = 'skip' | 'apply';
type ColumnChoice = 'live' | 'backup' | 'null';
interface RowOverride {
  action?: RowOverrideAction;
  columns?: Record<string, ColumnChoice>;
}
type RowOverrides = Record<string, Record<string, RowOverride>>;

interface RestorePlan {
  tables: TablePlan[];
  userRemap: Record<string, string | 'skip' | 'invite'>;
  userIdColumns?: Array<{ table: string; column: string }>;
  rowOverrides?: RowOverrides;
  /** Drop columns matching the default volatile list (updated_at, etc.). */
  skipVolatileColumns?: boolean;
  /** Drop owner/audit metadata columns (contact_owner, created_by, ...) so they
   * are not overwritten unless the user explicitly opted in via rowOverrides. */
  skipMetadataColumns?: boolean;
}

function orderTables(planned: TablePlan[]): TablePlan[] {
  const map = new Map(planned.map((p) => [p.name, p]));
  const ordered: TablePlan[] = [];
  for (const t of INSERT_ORDER) if (map.has(t)) ordered.push(map.get(t)!);
  for (const p of planned) if (!INSERT_ORDER.includes(p.name)) ordered.push(p);
  return ordered;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

async function runRestore(
  jobId: string,
  adminClient: any,
  userId: string,
  body: { uploadPath?: string; envelope?: any; plan: RestorePlan; requireChecksum?: boolean },
) {
  const setStatus = (patch: Record<string, unknown>) =>
    adminClient.from('backup_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);

  // Singleton concurrency guard — one restore at a time across BOTH restore
  // endpoints. Row released in `finally`. 409 semantics are handled in the
  // outer handler that queues the job; here we just refuse to run.
  const { error: lockErr } = await adminClient
    .from('backup_restore_locks')
    .insert({ id: 'singleton', locked_by: userId });
  if (lockErr) {
    await setStatus({ status: 'failed', error: 'Another restore is currently in progress' });
    return;
  }

  try {
    await setStatus({ status: 'running' });
    const { uploadPath, envelope: inlineEnvelope, plan } = body;

    let envelope: any;
    let checksumOk: boolean | null = null;
    if (uploadPath) {
      const loaded = await loadEnvelopeFromPath(adminClient, uploadPath);
      envelope = loaded.envelope;
      checksumOk = loaded.checksumOk;
    } else {
      envelope = inlineEnvelope;
    }

    assertAdvancedEnvelope(envelope);

    // Checksum is now MANDATORY when we loaded the envelope from storage
    // (previously the caller had to opt in via requireChecksum: true, so a
    // tampered/corrupted backup would restore silently). Inline envelopes
    // skip this because they never had a checksum to begin with.
    if (uploadPath && checksumOk === false) {
      await setStatus({ status: 'failed', error: 'Checksum verification failed — refusing to restore' });
      return;
    }

    const activeTables = plan.tables.filter((t) => t.mode !== 'skip' && envelope.data[t.name]?.length);
    const tableNames = activeTables.map((t) => t.name);

    // 1) Safety backup
    let safetyName: string | null = null;
    try {
      const safety = await createSafetyBackup(adminClient, userId, tableNames, 'pre_advanced_restore');
      safetyName = safety.fileName;
    } catch (e) {
      console.error('Safety backup failed (continuing):', e);
    }
    await setStatus({ progress: { phase: 'safety_done', safetyBackup: safetyName } });

    // 2) Resolve invites
    const authUsersById = new Map<string, { id: string; email: string | null }>();
    for (const u of envelope.auth_users || []) authUsersById.set(u.id, u);

    const inviteResults: Array<{ sourceId: string; email: string | null; targetId: string | null; error?: string }> = [];
    for (const [src, action] of Object.entries(plan.userRemap || {})) {
      if (action !== 'invite') continue;
      const src_user = authUsersById.get(src);
      const email = src_user?.email;
      if (!email) {
        inviteResults.push({ sourceId: src, email: null, targetId: null, error: 'no email in envelope' });
        continue;
      }
      try {
        const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email);
        if (error) throw error;
        const id = data?.user?.id || null;
        inviteResults.push({ sourceId: src, email, targetId: id });
        if (id) plan.userRemap[src] = id;
      } catch (e: any) {
        try {
          let page = 1; let found: string | null = null;
          while (!found && page <= 5) {
            const { data: list } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
            for (const u of list?.users || []) if (u.email?.toLowerCase() === email.toLowerCase()) { found = u.id; break; }
            if (!list?.users || list.users.length < 1000) break;
            page += 1;
          }
          if (found) { plan.userRemap[src] = found; inviteResults.push({ sourceId: src, email, targetId: found }); }
          else inviteResults.push({ sourceId: src, email, targetId: null, error: e.message });
        } catch (e2: any) {
          inviteResults.push({ sourceId: src, email, targetId: null, error: e2.message });
        }
      }
    }

    const userIdMap = new Map<string, string | null>();
    for (const [src, tgt] of Object.entries(plan.userRemap || {})) {
      if (tgt === 'invite') userIdMap.set(src, null);
      else userIdMap.set(src, tgt === 'skip' ? null : tgt);
    }
    const userIdColsByTable = new Map<string, Set<string>>();
    for (const fk of plan.userIdColumns || []) {
      if (!userIdColsByTable.has(fk.table)) userIdColsByTable.set(fk.table, new Set());
      userIdColsByTable.get(fk.table)!.add(fk.column);
    }

    const rowOverrides: RowOverrides = plan.rowOverrides || {};
    const skipVolatile = plan.skipVolatileColumns !== false; // default on
    const skipMetadata = plan.skipMetadataColumns !== false; // default on

    function transformRow(table: string, raw: any, p: TablePlan): any | null {
      const out: any = {};
      let cols: string[];
      if (p.includeColumns && p.includeColumns.length > 0) {
        // Always carry `id` for upsert-style modes so we don't accidentally
        // insert duplicates when the user toggles off the id checkbox.
        const set = new Set(p.includeColumns);
        if (p.mode !== 'append-only' && 'id' in raw) set.add('id');
        cols = Array.from(set);
      } else {
        cols = Object.keys(raw);
      }
      // Drop volatile/auto-managed columns so triggers can re-derive them and
      // we don't pollute audit trails on no-op restores.
      if (skipVolatile) cols = cols.filter((c) => c === 'id' || !isVolatileColumn(c));
      // Drop owner/audit metadata columns by default — those almost always
      // differ between environments and should not silently overwrite live data.
      // Per-row overrides below can still re-introduce a value.
      if (skipMetadata) {
        const explicit = rowOverrides[table] || {};
        cols = cols.filter((c) => {
          if (c === 'id' || !isMetadataColumn(c)) return true;
          const rid = raw?.id != null ? String(raw.id) : null;
          const choice = rid ? explicit[rid]?.columns?.[c] : undefined;
          // keep column only if user explicitly chose backup or null
          return choice === 'backup' || choice === 'null';
        });
      }

      for (const c of cols) {
        const target = p.columnMap?.[c] || c;
        out[target] = raw[c];
      }
      const userCols = userIdColsByTable.get(table);
      if (userCols) {
        for (const uc of userCols) {
          if (uc in out && out[uc]) {
            if (userIdMap.has(out[uc])) {
              const mapped = userIdMap.get(out[uc]);
              if (mapped === null) return null;
              out[uc] = mapped;
            }
          }
        }
      }
      return out;
    }

    /**
     * Apply rowOverrides for a single transformed row against its live counterpart.
     * Returns null if the row should be skipped entirely.
     */
    function applyRowOverride(table: string, row: any, live: any | undefined): any | null {
      const id = row?.id != null ? String(row.id) : null;
      if (!id) return row;
      const ov = rowOverrides[table]?.[id];
      if (!ov) return row;
      if (ov.action === 'skip') return null;
      if (!ov.columns) return row;
      const out = { ...row };
      for (const [col, choice] of Object.entries(ov.columns)) {
        if (col === 'id') continue;
        if (choice === 'live') {
          if (live && col in live) out[col] = live[col];
          else delete out[col]; // no live row → omit so PG default/NULL is used
        } else if (choice === 'null') {
          out[col] = null;
        }
        // 'backup' → keep current value (default)
      }
      return out;
    }

    const tableMap = new Map(activeTables.map((t) => [t.name, t]));
    for (const t of DELETE_ORDER) {
      const p = tableMap.get(t);
      if (!p || p.mode !== 'replace') continue;
      const { error } = await adminClient.from(t).delete().not('id', 'is', null);
      if (error) console.error(`Delete ${t} error:`, error);
    }
    for (const p of activeTables) {
      if (p.mode === 'replace' && !DELETE_ORDER.includes(p.name)) {
        const { error } = await adminClient.from(p.name).delete().not('id', 'is', null);
        if (error) console.error(`Delete ${p.name} error:`, error);
      }
    }

    const results: Array<{ table: string; mode: string; inserted: number; skipped: number; unchanged: number; overridden: number; errors: number; firstError?: string }> = [];
    const ordered = orderTables(activeTables);
    let done = 0;
    for (const p of ordered) {
      try {
        const rows = (envelope.data[p.name] as any[]) || [];
        const transformed: any[] = [];
        let skipped = 0;
        for (const r of rows) {
          const t = transformRow(p.name, r, p);
          if (t === null) skipped++;
          else transformed.push(t);
        }

        // For merge-upsert, prefetch live rows by id and (a) apply per-row
        // overrides, (b) drop no-op rows so unchanged data isn't rewritten
        // (which would bump updated_at triggers and pollute audit logs).
        let toWrite = transformed;
        let unchanged = 0;
        let overridden = 0;
        if (p.mode === 'merge-upsert' && transformed.length > 0 && 'id' in transformed[0]) {
          try {
            const liveById = new Map<string, any>();
            const ids = transformed.map((r) => r.id).filter((x) => x != null);
            for (let i = 0; i < ids.length; i += 500) {
              const chunk = ids.slice(i, i + 500);
              const { data: live } = await adminClient.from(p.name).select('*').in('id', chunk);
              for (const lr of live || []) if (lr?.id != null) liveById.set(String(lr.id), lr);
            }
            const filtered: any[] = [];
            for (const row of transformed) {
              const live = row.id != null ? liveById.get(String(row.id)) : undefined;
              const finalRow = applyRowOverride(p.name, row, live);
              if (finalRow === null) { skipped++; continue; }
              if (finalRow !== row) overridden++;
              if (!live) { filtered.push(finalRow); continue; }
              let changed = false;
              for (const k of Object.keys(finalRow)) {
                if (!deepEqual(canonForColumn(k, finalRow[k]), canonForColumn(k, live[k]))) {
                  changed = true; break;
                }
              }
              if (changed) filtered.push(finalRow);
              else unchanged++;
            }
            toWrite = filtered;
          } catch (e: any) {
            console.warn(`no-op skip prefetch failed for ${p.name}:`, e?.message);
          }
        } else if (Object.keys(rowOverrides[p.name] || {}).length > 0) {
          // append-only / replace modes still honour row-level skip overrides.
          const filtered: any[] = [];
          for (const row of transformed) {
            const finalRow = applyRowOverride(p.name, row, undefined);
            if (finalRow === null) { skipped++; continue; }
            if (finalRow !== row) overridden++;
            filtered.push(finalRow);
          }
          toWrite = filtered;
        }

        let inserted = 0, errors = 0, firstError: string | undefined;
        if (toWrite.length === 0) {
          results.push({ table: p.name, mode: p.mode, inserted: 0, skipped, unchanged, overridden, errors: 0 });
        } else {
          for (let i = 0; i < toWrite.length; i += 500) {
            const batch = toWrite.slice(i, i + 500);
            if (batch.length === 0) continue;
            let resp;
            if (p.mode === 'append-only') {
              resp = await adminClient.from(p.name).insert(batch, { count: 'exact' } as any);
              if (resp.error && /duplicate|unique/i.test(resp.error.message)) {
                for (const row of batch) {
                  const r2 = await adminClient.from(p.name).insert(row);
                  if (r2.error) {
                    if (/duplicate|unique/i.test(r2.error.message)) skipped++;
                    else { errors++; firstError ??= r2.error.message; }
                  } else inserted++;
                }
                continue;
              }
            } else {
              resp = await adminClient.from(p.name).upsert(batch, { onConflict: 'id' });
            }
            if (resp.error) {
              errors += batch.length;
              firstError ??= resp.error.message;
              console.error(`Insert ${p.name} batch ${i} error:`, resp.error);
            } else {
              inserted += batch.length;
            }
          }
          results.push({ table: p.name, mode: p.mode, inserted, skipped, unchanged, overridden, errors, firstError });
        }
      } catch (e: any) {
        console.error(`Restore for table ${p.name} threw:`, e);
        results.push({ table: p.name, mode: p.mode, inserted: 0, skipped: 0, unchanged: 0, overridden: 0, errors: 1, firstError: e?.message || 'unknown error' });
      }
      done++;
      await setStatus({ progress: { phase: 'restoring', tablesDone: done, tablesTotal: ordered.length } });
    }

    if (uploadPath) {
      try { await adminClient.storage.from('backups').remove([uploadPath]); }
      catch (e) { console.error('cleanup error', e); }
    }

    await setStatus({
      status: 'completed',
      result: { success: true, safetyBackup: safetyName, checksumOk, inviteResults, results },
    });
  } catch (error: any) {
    console.error('restore-advanced-backup runRestore error:', error);
    await setStatus({ status: 'failed', error: error?.message || 'Unknown error' });
  } finally {
    // Always release the singleton restore lock, success or failure.
    await adminClient.from('backup_restore_locks').delete().eq('id', 'singleton');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('MY_SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('MY_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ error: 'Backup service is not configured (missing env vars)' }, 500);
    }

    const gate = await adminGate(req, supabaseUrl, anonKey, serviceRoleKey);
    if ('error' in gate) return jsonResponse({ error: gate.error }, gate.status);
    const { user, adminClient } = gate;

    const body = await req.json().catch(() => ({} as any));

    const url = new URL(req.url);
    const jobIdQuery = url.searchParams.get('jobId') || body.jobId;
    if (jobIdQuery) {
      const { data: job, error } = await adminClient.from('backup_jobs').select('*').eq('id', jobIdQuery).maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!job) return jsonResponse({ error: 'Job not found' }, 404);
      return jsonResponse({ job });
    }

    if ((!body.uploadPath && !body.envelope) || !body.plan?.tables || !Array.isArray(body.plan.tables)) {
      return jsonResponse({ error: 'uploadPath (or envelope) and a valid plan.tables array are required' }, 400);
    }

    const { data: jobRow, error: insErr } = await adminClient
      .from('backup_jobs')
      .insert({
        user_id: user.id,
        kind: 'restore',
        status: 'queued',
        upload_path: body.uploadPath || null,
        request_input: { requireChecksum: !!body.requireChecksum, hasInlineEnvelope: !!body.envelope, planTableCount: body.plan.tables.length },
      })
      .select('id')
      .single();
    if (insErr || !jobRow) return jsonResponse({ error: `Failed to enqueue job: ${insErr?.message}` }, 500);

    // @ts-ignore EdgeRuntime is available in Supabase Edge runtime
    EdgeRuntime.waitUntil(runRestore(jobRow.id, adminClient, user.id, body));

    return jsonResponse({ jobId: jobRow.id, status: 'queued' }, 202);
  } catch (error: any) {
    console.error('restore-advanced-backup error:', error);
    return jsonResponse({ error: error?.message || 'Unknown error' }, 500);
  }
});
