// edge function: diff-backup (async job)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminGate } from '../_shared/safety-backup.ts';
import { loadEnvelopeFromPath, assertAdvancedEnvelope } from '../_shared/envelope-loader.ts';
import {
  canonicalize, deepEqual, isVolatileColumn, isEmailColumn, isMetadataColumn,
} from '../_shared/diff-canonicalize.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name?: string;
  is_nullable?: string;
  is_generated?: string;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const MAX_RAW_BYTES = 25 * 1024 * 1024; // 25 MB
const TIME_BUDGET_MS = 120_000;
const ROW_DIFF_PER_TABLE_CAP = 25_000;

async function runDiff(
  jobId: string,
  adminClient: any,
  userClient: any,
  body: any,
) {
  const startedAt = Date.now();
  const timeUp = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const setStatus = (patch: Record<string, unknown>) =>
    adminClient.from('backup_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);

  try {
    await setStatus({ status: 'running' });

    const onlyTables: string[] | undefined = Array.isArray(body.onlyTables) ? body.onlyTables : undefined;

    let envelope: any;
    let checksumOk: boolean | null = null;
    let rawSize = 0;

    if (body.uploadPath) {
      // Pre-flight size check
      try {
        const { data: meta } = await adminClient.storage.from('backups').list(
          body.uploadPath.split('/').slice(0, -1).join('/'),
          { limit: 1000, search: body.uploadPath.split('/').pop() },
        );
        const size = (meta || []).find((o: any) => body.uploadPath.endsWith(o.name))?.metadata?.size;
        const isGz = body.uploadPath.toLowerCase().endsWith('.gz');
        if (typeof size === 'number' && !isGz && size > MAX_RAW_BYTES) {
          await setStatus({
            status: 'failed',
            error: `Backup file is ${(size / 1024 / 1024).toFixed(1)} MB which exceeds the ${(MAX_RAW_BYTES / 1024 / 1024).toFixed(0)} MB uncompressed limit. Upload a gzip-compressed (.json.gz) backup.`,
          });
          return;
        }
      } catch { /* best effort */ }

      const loaded = await loadEnvelopeFromPath(adminClient, body.uploadPath);
      envelope = loaded.envelope;
      checksumOk = loaded.checksumOk;
      rawSize = loaded.rawSize;
    } else if (body.envelope) {
      envelope = body.envelope;
    } else {
      await setStatus({ status: 'failed', error: 'uploadPath or envelope required' });
      return;
    }

    assertAdvancedEnvelope(envelope);

    // Live schema. Use the ADMIN client first because the user client may not
    // have EXECUTE on `get_schema_snapshot`, in which case the RPC silently
    // returns nothing and every column gets typed as `unknown` — which then
    // causes mass false-positive row diffs. Fall back to the user client only
    // if admin truly fails.
    let liveSchema: any = { columns: [], enums: [], foreign_keys: [] };
    let schemaSource: 'admin' | 'user' | 'none' = 'none';
    try {
      const { data, error: schemaErr } = await adminClient.rpc('get_schema_snapshot');
      if (!schemaErr && data && Array.isArray(data?.columns) && data.columns.length > 0) {
        liveSchema = data;
        schemaSource = 'admin';
      } else if (schemaErr) {
        console.warn('get_schema_snapshot (admin) error:', schemaErr.message);
      }
    } catch (e: any) {
      console.warn('get_schema_snapshot (admin) threw:', e?.message);
    }
    if (schemaSource === 'none' && userClient) {
      try {
        const { data, error: schemaErr } = await userClient.rpc('get_schema_snapshot');
        if (!schemaErr && data && Array.isArray(data?.columns) && data.columns.length > 0) {
          liveSchema = data;
          schemaSource = 'user';
        } else if (schemaErr) {
          console.warn('get_schema_snapshot (user) error:', schemaErr.message);
        }
      } catch (e: any) {
        console.warn('get_schema_snapshot (user) threw:', e?.message);
      }
    }

    const liveCols: ColumnInfo[] = liveSchema?.columns || [];
    const liveByTable: Record<string, Record<string, ColumnInfo>> = {};
    for (const c of liveCols) (liveByTable[c.table_name] ??= {})[c.column_name] = c;
    const liveTables = new Set(Object.keys(liveByTable));

    const backupSchema = envelope.schema;
    const backupCols: ColumnInfo[] = backupSchema?.columns || [];
    const backupByTable: Record<string, Record<string, ColumnInfo>> = {};
    for (const c of backupCols) (backupByTable[c.table_name] ??= {})[c.column_name] = c;

    const allTablesInBackup = Object.keys(envelope.data);
    const tablesInBackup = onlyTables && onlyTables.length > 0
      ? allTablesInBackup.filter((t) => onlyTables.includes(t))
      : allTablesInBackup;

    const ROW_FETCH_LIMIT = 50000;

    async function diffOneTable(t: string) {
      const inLive = liveTables.size > 0 ? liveTables.has(t) : true;
      const live = liveByTable[t] || {};
      let bk = backupByTable[t];
      if (!bk || Object.keys(bk).length === 0) {
        const sample = envelope.data[t]?.[0];
        bk = {};
        if (sample) for (const k of Object.keys(sample)) bk[k] = { table_name: t, column_name: k, data_type: 'unknown' };
      }
      const backupColNames = new Set(Object.keys(bk));
      const liveColNames = new Set(Object.keys(live));

      const matching: string[] = [];
      const extraInFile: string[] = [];
      const missingInFile: string[] = [];
      const typeMismatches: Array<{ column: string; live: string; backup: string }> = [];
      const effectiveTypeMissing: string[] = [];
      const generatedCols = new Set<string>();

      for (const col of backupColNames) {
        if (liveColNames.size === 0 || liveColNames.has(col)) {
          matching.push(col);
          const a = bk[col]?.data_type;
          const b = live[col]?.data_type;
          if (a && b && a !== 'unknown' && a !== b) typeMismatches.push({ column: col, live: b, backup: a });
          const eff = (a && a !== 'unknown') ? a : ((b && b !== 'unknown') ? b : undefined);
          if (!eff) effectiveTypeMissing.push(col);
          if (live[col]?.is_generated === 'ALWAYS' || (live[col] as any)?.is_generated === true) {
            generatedCols.add(col);
          }
        } else extraInFile.push(col);
      }
      for (const col of liveColNames) if (!backupColNames.has(col)) missingInFile.push(col);

      let liveRowCount: number | null = null;
      if (inLive) {
        try {
          const { count } = await adminClient.from(t).select('*', { count: 'estimated', head: true });
          liveRowCount = count ?? null;
        } catch { liveRowCount = null; }
      }

      const backupRows: any[] = envelope.data[t] || [];
      let rowDiff: any = null;
      const hasId = backupRows[0] && 'id' in backupRows[0];
      if (inLive && hasId && backupRows.length > 0) {
        try {
          const liveRows: any[] = [];
          const pageSize = 1000;
          for (let off = 0; off < ROW_FETCH_LIMIT; off += pageSize) {
            const { data, error } = await adminClient.from(t).select('*').order('id', { ascending: true }).range(off, off + pageSize - 1);
            if (error || !data || data.length === 0) break;
            liveRows.push(...data);
            if (data.length < pageSize) break;
          }
          const liveById = new Map<string, any>();
          for (const r of liveRows) if (r && r.id != null) liveById.set(String(r.id), r);
          const backupById = new Map<string, any>();
          for (const r of backupRows) if (r && r.id != null) backupById.set(String(r.id), r);

          let newCount = 0, updatedCount = 0, volatileOnlyCount = 0, metadataOnlyCount = 0, unchangedCount = 0;
          const rows: any[] = []; // full per-row diff records (capped)
          const changedColumnCounts: Record<string, number> = {};
          const pushRow = (r: any) => {
            if (rows.length < ROW_DIFF_PER_TABLE_CAP) rows.push(r);
          };

          for (const [id, bRow] of backupById) {
            const lRow = liveById.get(id);
            if (!lRow) {
              newCount++;
              pushRow({ id, status: 'new', backup: bRow });
              continue;
            }
            const changed: Record<string, { live: any; backup: any; volatile: boolean; metadata: boolean }> = {};
            let nonVolatileChange = false;
            let nonMetadataChange = false;
            for (const k of matching) {
              if (generatedCols.has(k)) continue; // generated columns are not restorable
              const bkDt = bk[k]?.data_type;
              const dt = (bkDt && bkDt !== 'unknown') ? bkDt : live[k]?.data_type;
              const opts = { lowercase: isEmailColumn(k) };
              const ca = canonicalize(bRow[k], dt, opts);
              const cb = canonicalize(lRow[k], dt, opts);
              if (!deepEqual(ca, cb)) {
                const volatile = isVolatileColumn(k);
                const metadata = isMetadataColumn(k);
                changed[k] = { live: lRow[k], backup: bRow[k], volatile, metadata };
                if (!volatile) nonVolatileChange = true;
                if (!volatile && !metadata) nonMetadataChange = true;
                changedColumnCounts[k] = (changedColumnCounts[k] || 0) + 1;
              }
            }
            const changedKeys = Object.keys(changed);
            if (changedKeys.length === 0) {
              unchangedCount++;
            } else if (!nonVolatileChange) {
              volatileOnlyCount++;
              pushRow({ id, status: 'volatileOnly', changedColumns: changed });
            } else if (!nonMetadataChange) {
              metadataOnlyCount++;
              pushRow({ id, status: 'metadataOnly', changedColumns: changed });
            } else {
              updatedCount++;
              pushRow({ id, status: 'updated', changedColumns: changed });
            }
          }

          let deletedCount = 0;
          for (const [id, lRow] of liveById) {
            if (!backupById.has(id)) {
              deletedCount++;
              pushRow({ id, status: 'deleted', live: lRow });
            }
          }

          const changedColumnSummary = Object.entries(changedColumnCounts)
            .map(([column, count]) => ({
              column, count,
              volatile: isVolatileColumn(column),
              metadata: isMetadataColumn(column),
            }))
            .sort((a, b) => b.count - a.count);

          rowDiff = {
            newCount, updatedCount, volatileOnlyCount, metadataOnlyCount, deletedCount, unchangedCount,
            liveFetched: liveRows.length,
            liveTruncated: liveRows.length >= ROW_FETCH_LIMIT,
            // `samples` kept for backwards-compat with older UI; same data as `rows`.
            samples: rows.slice(0, 500),
            rows,
            rowsTruncated: rows.length >= ROW_DIFF_PER_TABLE_CAP,
            generatedCols: Array.from(generatedCols),
            changedColumnSummary,
          };
        } catch (e: any) {
          rowDiff = { error: e?.message || 'row diff failed' };
        }
      }

      return {
        table: t, inLive,
        backupRowCount: backupRows.length,
        liveRowCount, matching, extraInFile, missingInFile, typeMismatches,
        effectiveTypeMissing,
        rowDiff,
      };
    }


    const tableDiffs: any[] = [];
    const skippedTables: string[] = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < tablesInBackup.length; i += CONCURRENCY) {
      if (timeUp()) { skippedTables.push(...tablesInBackup.slice(i)); break; }
      const batch = tablesInBackup.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((t) =>
        diffOneTable(t).catch((e) => ({
          table: t, inLive: false, backupRowCount: envelope.data[t]?.length || 0,
          liveRowCount: null, matching: [], extraInFile: [], missingInFile: [], typeMismatches: [],
          error: e?.message || 'diff failed',
        })),
      ));
      tableDiffs.push(...results);
      await setStatus({ progress: { tablesDone: tableDiffs.length, tablesTotal: tablesInBackup.length } });
    }

    const tablesOnlyInLive = Array.from(liveTables).filter((t) => !envelope.data[t]);

    // Auth user mapping
    const backupAuth: Array<{ id: string; email: string | null }> = envelope.auth_users || [];
    const liveUsersByEmail = new Map<string, string>();
    if (backupAuth.length > 0 && !timeUp()) {
      const neededEmails = new Set(
        backupAuth.map((u) => u.email?.toLowerCase()).filter((e): e is string => !!e),
      );
      try {
        let page = 1;
        while (neededEmails.size > 0 && page <= 5) {
          const { data: list, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) break;
          for (const u of list?.users || []) {
            if (u.email) {
              const em = u.email.toLowerCase();
              liveUsersByEmail.set(em, u.id);
              neededEmails.delete(em);
            }
          }
          if (!list?.users || list.users.length < 1000) break;
          page += 1;
        }
      } catch (e) { console.error('listUsers error', e); }
    }

    const userMapping = backupAuth.map((u) => ({
      sourceId: u.id,
      email: u.email,
      targetId: u.email ? (liveUsersByEmail.get(u.email.toLowerCase()) || null) : null,
    }));

    const liveEnums: Record<string, string[]> = {};
    for (const e of liveSchema?.enums || []) liveEnums[e.name] = e.values || [];
    const backupEnums: Record<string, string[]> = {};
    for (const e of backupSchema?.enums || []) backupEnums[e.name] = e.values || [];
    const enumDiffs: Array<{ name: string; missingValues: string[]; extraValues: string[] }> = [];
    for (const [name, values] of Object.entries(backupEnums)) {
      const liveVals = new Set(liveEnums[name] || []);
      const missing = values.filter((v) => !liveVals.has(v));
      const extra = (liveEnums[name] || []).filter((v) => !values.includes(v));
      if (missing.length || extra.length) enumDiffs.push({ name, missingValues: missing, extraValues: extra });
    }

    const userIdColumns = (backupSchema?.foreign_keys || [])
      .filter((fk: any) => fk.foreign_table_schema === 'auth' && fk.foreign_table_name === 'users')
      .map((fk: any) => ({ table: fk.table_name, column: fk.column_name }));

    // Build warnings
    const warnings: Array<{ severity: 'info' | 'warn' | 'blocker'; table?: string; message: string }> = [];
    if (checksumOk === false) warnings.push({ severity: 'blocker', message: 'Checksum verification failed for backup envelope' });
    if (schemaSource === 'none') {
      warnings.push({
        severity: 'blocker',
        message: 'Live schema snapshot is unavailable — column types are unknown, so row-level updates may be reported as false positives. Resolve get_schema_snapshot before applying.',
      });
    } else if (schemaSource === 'user') {
      warnings.push({
        severity: 'info',
        message: 'Live schema was loaded via the user client (admin RPC failed). Diff accuracy is unchanged but please grant the service_role EXECUTE on get_schema_snapshot.',
      });
    }
    for (const td of tableDiffs) {
      if (!td.inLive) warnings.push({ severity: 'warn', table: td.table, message: `Table "${td.table}" not present in live DB — rows will be skipped` });
      if (td.typeMismatches?.length) warnings.push({ severity: 'warn', table: td.table, message: `${td.typeMismatches.length} column type mismatch(es) in "${td.table}"` });
      if (td.effectiveTypeMissing?.length) {
        warnings.push({
          severity: 'warn',
          table: td.table,
          message: `${td.effectiveTypeMissing.length} column(s) in "${td.table}" have no resolvable data type — comparison falls back to format heuristics and may over-report updates. Columns: ${td.effectiveTypeMissing.slice(0, 6).join(', ')}${td.effectiveTypeMissing.length > 6 ? '…' : ''}`,
        });
      }
      if (td.missingInFile?.length) warnings.push({ severity: 'info', table: td.table, message: `Live "${td.table}" has ${td.missingInFile.length} column(s) not in backup — values will be left as-is on upsert, NULL on insert` });
      if (td.extraInFile?.length) warnings.push({ severity: 'info', table: td.table, message: `Backup "${td.table}" has ${td.extraInFile.length} column(s) not in live — they will be dropped` });
      if (td.rowDiff?.deletedCount > 0) warnings.push({ severity: 'warn', table: td.table, message: `${td.rowDiff.deletedCount} live row(s) in "${td.table}" are NOT in backup (will be deleted if mode = Replace)` });
      if (td.rowDiff?.updatedCount > 0) {
        const top = (td.rowDiff.changedColumnSummary || [])
          .filter((s: any) => !s.volatile && !s.metadata)
          .slice(0, 5)
          .map((s: any) => `${s.column} (${s.count.toLocaleString()})`)
          .join(', ');
        warnings.push({
          severity: 'info',
          table: td.table,
          message: `${td.rowDiff.updatedCount} row(s) in "${td.table}" will be overwritten by backup values${top ? ` — top changed columns: ${top}` : ''}`,
        });
      }
      if (td.rowDiff?.metadataOnlyCount > 0) {
        const top = (td.rowDiff.changedColumnSummary || [])
          .filter((s: any) => s.metadata && !s.volatile)
          .slice(0, 5)
          .map((s: any) => `${s.column} (${s.count.toLocaleString()})`)
          .join(', ');
        warnings.push({
          severity: 'info',
          table: td.table,
          message: `${td.rowDiff.metadataOnlyCount} row(s) in "${td.table}" differ ONLY in owner/audit columns${top ? ` — ${top}` : ''}. Skipped from "To update" by default.`,
        });
      }
      if (td.rowDiff?.volatileOnlyCount > 0) warnings.push({ severity: 'info', table: td.table, message: `${td.rowDiff.volatileOnlyCount} row(s) in "${td.table}" differ ONLY in auto-managed columns (updated_at, etc.) — safe to skip` });
      if (td.rowDiff?.liveTruncated) warnings.push({ severity: 'info', table: td.table, message: `Live row count for "${td.table}" exceeded sample limit — row diff is partial` });
      if (td.rowDiff?.rowsTruncated) warnings.push({ severity: 'info', table: td.table, message: `Per-row diff for "${td.table}" exceeded ${ROW_DIFF_PER_TABLE_CAP.toLocaleString()} rows — picker shows the first ${ROW_DIFF_PER_TABLE_CAP.toLocaleString()} only` });
    }
    for (const ed of enumDiffs) {
      if (ed.missingValues.length) warnings.push({ severity: 'warn', message: `Enum "${ed.name}" missing values in live: ${ed.missingValues.join(', ')}` });
    }
    const unmatchedUsers = userMapping.filter((u: any) => !u.targetId).length;
    if (unmatchedUsers > 0) warnings.push({ severity: 'warn', message: `${unmatchedUsers} backup user(s) have no matching live account` });

    const result = {
      success: true,
      envelopeVersion: envelope.version,
      checksum: envelope.checksum_sha256 || null,
      checksumOk,
      rawSize,
      tableDiffs,
      tablesOnlyInLive,
      enumDiffs,
      userMapping,
      userIdColumns,
      backupCreatedAt: envelope.created_at,
      warnings,
      diagnostics: {
        schemaSource,
        liveSchemaColumnCount: liveCols.length,
        backupSchemaColumnCount: backupCols.length,
      },
      partial: skippedTables.length > 0,
      skippedTables,
      note: skippedTables.length > 0
        ? `Analysis time budget exceeded — ${skippedTables.length} table(s) were skipped. Use Re-analyze to continue.`
        : undefined,
    };


    await setStatus({ status: 'completed', result });
  } catch (error: any) {
    console.error('diff-backup runDiff error:', error);
    await setStatus({ status: 'failed', error: error?.message || 'Unknown error' });
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
    const { adminClient, userClient, user } = gate;

    const body = await req.json().catch(() => ({} as any));

    // Allow polling existing job by id (?jobId=... or { jobId })
    const url = new URL(req.url);
    const jobIdQuery = url.searchParams.get('jobId') || body.jobId;
    if (jobIdQuery) {
      const { data: job, error } = await adminClient.from('backup_jobs').select('*').eq('id', jobIdQuery).maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!job) return jsonResponse({ error: 'Job not found' }, 404);
      return jsonResponse({ job });
    }

    if (!body.uploadPath && !body.envelope) {
      return jsonResponse({ error: 'uploadPath or envelope required' }, 400);
    }

    const { data: jobRow, error: insErr } = await adminClient
      .from('backup_jobs')
      .insert({
        user_id: user.id,
        kind: 'diff',
        status: 'queued',
        upload_path: body.uploadPath || null,
        request_input: { onlyTables: body.onlyTables ?? null, hasInlineEnvelope: !!body.envelope },
      })
      .select('id')
      .single();
    if (insErr || !jobRow) return jsonResponse({ error: `Failed to enqueue job: ${insErr?.message}` }, 500);

    // @ts-ignore EdgeRuntime is available in Supabase Edge runtime
    EdgeRuntime.waitUntil(runDiff(jobRow.id, adminClient, userClient, body));

    return jsonResponse({ jobId: jobRow.id, status: 'queued' }, 202);
  } catch (error: any) {
    console.error('diff-backup error:', error);
    return jsonResponse({ error: error?.message || 'Unknown error' }, 500);
  }
});
