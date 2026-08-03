import { createClient } from 'npm:@supabase/supabase-js@2';

// Shared helper: create a pre-restore safety backup
const BATCH_SIZE = 1000;
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

export async function fetchAllRows(client: any, table: string): Promise<any[]> {
  const allData: any[] = [];
  let from = 0;
  while (true) {
    // Deterministic ordering by id to prevent duplicate/gap pages when tables exceed 1000 rows.
    // Falls back gracefully (errors once) for tables without an `id` column; in that case we
    // retry unordered to preserve behavior for unusual tables.
    let { data, error } = await client
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    if (error) {
      const retry = await client.from(table).select('*').range(from, from + BATCH_SIZE - 1);
      data = retry.data; error = retry.error;
    }
    if (error || !data || data.length === 0) break;
    allData.push(...data);
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  return allData;
}

export async function createSafetyBackup(
  adminClient: any,
  userId: string,
  tablesToBackup: string[],
  label = 'pre_restore'
): Promise<{ fileName: string; sizeBytes: number; records: number }> {
  const data: Record<string, any[]> = {};
  const manifest: Record<string, number> = {};
  let totalRecords = 0;

  for (const table of tablesToBackup) {
    try {
      const rows = await fetchAllRows(adminClient, table);
      data[table] = rows;
      manifest[table] = rows.length;
      totalRecords += rows.length;
    } catch (e) {
      console.error(`Safety backup: failed to read ${table}`, e);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${label}-safety-${timestamp}.json`;
  const filePath = `${userId}/${fileName}`;
  const json = JSON.stringify({
    version: '1.0',
    created_at: new Date().toISOString(),
    created_by: userId,
    backup_type: label,
    tables: tablesToBackup,
    manifest,
    data,
  }, null, 2);
  const sizeBytes = new Blob([json]).size;

  await adminClient.storage.from('backups').upload(filePath, json, {
    contentType: 'application/json',
    upsert: true,
  });

  await adminClient.from('backups').insert({
    file_name: fileName,
    file_path: filePath,
    backup_type: label,
    status: 'completed',
    created_by: userId,
    size_bytes: sizeBytes,
    tables_count: tablesToBackup.length,
    records_count: totalRecords,
    manifest,
  });

  return { fileName, sizeBytes, records: totalRecords };
}

export async function ensureBucket(adminClient: any, name: string, isPublic = false) {
  try {
    const { data: existing } = await adminClient.storage.getBucket(name);
    if (existing) return;
  } catch {
    // not found
  }
  try {
    await adminClient.storage.createBucket(name, { public: isPublic });
  } catch (e: any) {
    if (!String(e?.message || '').toLowerCase().includes('already exists')) {
      console.error(`ensureBucket(${name}) error:`, e);
    }
  }
}

export async function adminGate(req: Request, supabaseUrl: string, anonKey: string, serviceRoleKey: string) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return { error: 'Unauthorized', status: 401 };
  if (!serviceRoleKey) return { error: 'Backup admin service key is not configured', status: 500 };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return { error: 'Unauthorized', status: 401 };

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: roleRows, error: roleError } = await adminClient
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const tableRoles = (roleRows || []).map((row: any) => String(row.role));
  const tableIsAdmin = tableRoles.some((role) => ADMIN_ROLES.has(role));

  let rpcIsAdmin = false;
  try {
    const { data: rpcAdmin } = await adminClient.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    const { data: rpcSuper } = await adminClient.rpc('has_role', { _user_id: user.id, _role: 'super_admin' });
    rpcIsAdmin = Boolean(rpcAdmin) || Boolean(rpcSuper);
  } catch (e) {
    console.error('adminGate has_role rpc failed', e);
  }

  let helperIsAdmin = false;
  try {
    const { data: helperRole } = await adminClient.rpc('get_user_role', { p_user_id: user.id });
    helperIsAdmin = ADMIN_ROLES.has(String(helperRole));
  } catch (e) {
    console.error('adminGate get_user_role rpc failed', e);
  }

  if (roleError) console.error('adminGate role table check failed', roleError);
  console.log('adminGate diag', { userId: user.id, email: user.email, tableRoles, tableIsAdmin, rpcIsAdmin, helperIsAdmin });

  if (!tableIsAdmin && !rpcIsAdmin && !helperIsAdmin) {
    return { error: 'Admin access required', status: 403 };
  }

  return { user, adminClient, userClient };
}
