import { adminGate } from '../_shared/safety-backup.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BACKUP_TABLES = [
  'leads', 'contacts', 'accounts', 'deals', 'action_items',
  'deal_action_items', 'lead_action_items', 'notifications',
  'notification_preferences', 'page_permissions', 'profiles',
  'user_preferences', 'user_roles',
  'saved_filters', 'column_preferences', 'dashboard_preferences',
  'yearly_revenue_targets'
]

const MODULE_TABLES: Record<string, string[]> = {
  contacts: ['contacts'],
  accounts: ['accounts'],
  deals: ['deals', 'deal_action_items', 'leads', 'lead_action_items'],
  action_items: ['action_items'],
  notifications: ['notifications', 'notification_preferences'],
}

const MAX_BACKUPS = 30
const BATCH_SIZE = 1000

async function fetchAllRows(client: any, table: string): Promise<any[]> {
  const allData: any[] = []
  let from = 0

  while (true) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .range(from, from + BATCH_SIZE - 1)

    if (error) {
      console.error(`Error fetching ${table} at offset ${from}:`, error)
      break
    }

    if (!data || data.length === 0) break
    allData.push(...data)
    if (data.length < BATCH_SIZE) break
    from += BATCH_SIZE
  }

  return allData
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('MY_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('MY_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const gate = await adminGate(req, supabaseUrl, anonKey, serviceRoleKey)
    if ('error' in gate) {
      return new Response(JSON.stringify({ error: gate.error }), {
        status: gate.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const { user, adminClient } = gate

    const body = await req.json().catch(() => ({}))
    const backupType = body.backupType || 'manual'
    const moduleName = body.moduleName || null

    let tablesToBackup = BACKUP_TABLES
    if (moduleName && MODULE_TABLES[moduleName]) {
      tablesToBackup = MODULE_TABLES[moduleName]
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = moduleName
      ? `backup-${moduleName}-${timestamp}.json`
      : `backup-full-${timestamp}.json`
    const filePath = `${user.id}/${fileName}`

    const { data: backupRecord, error: insertError } = await adminClient
      .from('backups')
      .insert({
        file_name: fileName,
        file_path: filePath,
        backup_type: moduleName ? 'module' : backupType,
        module_name: moduleName,
        status: 'in_progress',
        created_by: user.id,
      })
      .select()
      .single()

    if (insertError) throw insertError

    const backupData: Record<string, any[]> = {}
    const manifest: Record<string, number> = {}
    let totalRecords = 0

    for (const table of tablesToBackup) {
      const data = await fetchAllRows(adminClient, table)
      backupData[table] = data
      manifest[table] = data.length
      totalRecords += data.length
      console.log(`Backed up ${table}: ${data.length} records`)
    }

    const backupJson = JSON.stringify({
      version: '1.0',
      created_at: new Date().toISOString(),
      created_by: user.id,
      backup_type: moduleName ? 'module' : backupType,
      module_name: moduleName,
      tables: tablesToBackup,
      manifest,
      data: backupData,
    }, null, 2)

    const sizeBytes = new Blob([backupJson]).size

    const { error: uploadError } = await adminClient.storage
      .from('backups')
      .upload(filePath, backupJson, {
        contentType: 'application/json',
        upsert: true,
      })

    if (uploadError) {
      await adminClient.from('backups').update({ status: 'failed' }).eq('id', backupRecord.id)
      throw uploadError
    }

    await adminClient.from('backups').update({
      status: 'completed',
      size_bytes: sizeBytes,
      tables_count: tablesToBackup.length,
      records_count: totalRecords,
      manifest,
    }).eq('id', backupRecord.id)

    // Enforce max backups limit
    const { data: allBackups } = await adminClient
      .from('backups')
      .select('id, file_path')
      .eq('status', 'completed')
      .order('created_at', { ascending: true })

    if (allBackups && allBackups.length > MAX_BACKUPS) {
      const toDelete = allBackups.slice(0, allBackups.length - MAX_BACKUPS)
      for (const old of toDelete) {
        await adminClient.storage.from('backups').remove([old.file_path])
        await adminClient.from('backups').delete().eq('id', old.id)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      backupId: backupRecord.id,
      fileName,
      tablesCount: tablesToBackup.length,
      recordsCount: totalRecords,
      sizeBytes,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('Backup error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
