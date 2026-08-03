// edge function: create-advanced-backup (redeploy trigger)
import { fetchAllRows, ensureBucket, adminGate } from '../_shared/safety-backup.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALL_TABLES = [
  'leads', 'contacts', 'accounts', 'deals', 'action_items',
  'deal_action_items', 'lead_action_items', 'notifications',
  'notification_preferences', 'page_permissions', 'profiles',
  'user_preferences', 'user_roles',
  'saved_filters', 'column_preferences', 'dashboard_preferences',
  'yearly_revenue_targets',
];

const MODULE_TABLES: Record<string, string[]> = {
  contacts: ['contacts'],
  accounts: ['accounts'],
  deals: ['deals', 'deal_action_items', 'leads', 'lead_action_items'],
  action_items: ['action_items'],
  notifications: ['notifications', 'notification_preferences'],
};

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const buf = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function gzipBytes(input: string): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function fetchFiltered(client: any, table: string, filter?: { column: string; from?: string; to?: string }): Promise<any[]> {
  if (!filter || !filter.column) return fetchAllRows(client, table);
  const all: any[] = [];
  const BATCH = 1000;
  let from = 0;
  while (true) {
    let q = client.from(table).select('*').range(from, from + BATCH - 1);
    if (filter.from) q = q.gte(filter.column, filter.from);
    if (filter.to) q = q.lte(filter.column, filter.to);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('MY_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('MY_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const gate = await adminGate(req, supabaseUrl, anonKey, serviceRoleKey);
    if ('error' in gate) {
      return new Response(JSON.stringify({ error: gate.error }), {
        status: gate.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { user, adminClient } = gate;

    const body = await req.json().catch(() => ({}));
    const scope: 'full' | 'module' | 'custom' = body.scope || 'full';
    const moduleName: string | null = body.moduleName || null;
    const customTables: string[] | undefined = body.tables;
    const filters: Record<string, { column: string; from?: string; to?: string }> = body.filters || {};
    const includeSchema = body.includeSchema !== false;
    const includeAuthUsers = body.includeAuthUsers !== false;
    const includeStorage = !!body.includeStorage;
    const compress = body.compress !== false;

    let tables = ALL_TABLES;
    if (scope === 'module' && moduleName && MODULE_TABLES[moduleName]) {
      tables = MODULE_TABLES[moduleName];
    } else if (scope === 'custom' && Array.isArray(customTables) && customTables.length > 0) {
      tables = customTables.filter((t) => ALL_TABLES.includes(t));
    }

    await ensureBucket(adminClient, 'backups', false);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `advanced-${scope}${moduleName ? '-' + moduleName : ''}-${timestamp}`;
    const fileName = compress ? `${baseName}.json.gz` : `${baseName}.json`;
    const filePath = `${user.id}/${fileName}`;

    const { data: backupRecord, error: insertError } = await adminClient
      .from('backups')
      .insert({
        file_name: fileName,
        file_path: filePath,
        backup_type: 'advanced',
        module_name: moduleName,
        status: 'in_progress',
        created_by: user.id,
      })
      .select().single();
    if (insertError) throw insertError;

    const data: Record<string, any[]> = {};
    const manifest: Record<string, number> = {};
    const tableErrors: Record<string, string> = {};
    let total = 0;
    for (const t of tables) {
      try {
        const rows = await fetchFiltered(adminClient, t, filters[t]);
        data[t] = rows;
        manifest[t] = rows.length;
        total += rows.length;
      } catch (e: any) {
        console.error(`fetch ${t} failed:`, e);
        data[t] = [];
        manifest[t] = -1;
        tableErrors[t] = e?.message || 'fetch failed';
      }
    }

    let schema: any = null;
    if (includeSchema) {
      const { data: snap, error: schemaErr } = await adminClient.rpc('get_schema_snapshot');
      if (schemaErr) console.error('schema snapshot error', schemaErr);
      schema = snap || null;
    }

    let authUsers: Array<{ id: string; email: string | null; created_at?: string }> = [];
    if (includeAuthUsers) {
      try {
        let page = 1;
        while (true) {
          const { data: list, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) { console.error('listUsers error', error); break; }
          const users = list?.users || [];
          for (const u of users) authUsers.push({ id: u.id, email: u.email ?? null, created_at: u.created_at });
          if (users.length < 1000) break;
          page += 1;
          if (page > 5) break;
        }
      } catch (e) { console.error('auth users error', e); }
    }

    let storage: Record<string, any[]> | null = null;
    if (includeStorage) {
      storage = {};
      try {
        const { data: buckets } = await adminClient.storage.listBuckets();
        for (const b of buckets || []) {
          const { data: objs } = await adminClient.storage.from(b.name).list('', { limit: 1000 });
          storage[b.name] = (objs || []).map((o: any) => ({
            name: o.name, size: o.metadata?.size, mime: o.metadata?.mimetype,
          }));
        }
      } catch (e) { console.error('storage list error', e); }
    }

    const envelopeObj = {
      version: '2.0',
      created_at: new Date().toISOString(),
      created_by: user.id,
      backup_type: 'advanced',
      scope,
      module_name: moduleName,
      compressed: compress,
      schema,
      auth_users: authUsers,
      storage,
      tables,
      manifest,
      data,
      filters,
    };

    const json = JSON.stringify(envelopeObj);
    const checksum = await sha256Hex(json);
    (envelopeObj as any).checksum_sha256 = checksum;
    const finalJson = JSON.stringify(envelopeObj);

    const payload = compress ? await gzipBytes(finalJson) : finalJson;
    const contentType = compress ? 'application/gzip' : 'application/json';
    const sizeBytes = compress ? (payload as Uint8Array).byteLength : new Blob([finalJson]).size;

    const { error: upErr } = await adminClient.storage.from('backups')
      .upload(filePath, payload, { contentType, upsert: true });
    if (upErr) {
      await adminClient.from('backups').update({ status: 'failed' }).eq('id', backupRecord.id);
      throw upErr;
    }

    await adminClient.from('backups').update({
      status: 'completed',
      size_bytes: sizeBytes,
      tables_count: tables.length,
      records_count: total,
      manifest,
      envelope_version: '2.0',
      checksum_sha256: checksum,
      compressed: compress,
      includes_schema: includeSchema,
      includes_auth_users: includeAuthUsers,
      includes_storage: includeStorage,
    }).eq('id', backupRecord.id);

    return new Response(JSON.stringify({
      success: true, backupId: backupRecord.id, fileName, sizeBytes,
      tablesCount: tables.length, recordsCount: total, checksum,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('create-advanced-backup error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
