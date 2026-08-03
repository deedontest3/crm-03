import { adminGate } from '../_shared/safety-backup.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Tables that should NEVER be restored from backups (noise/session data)
const SKIP_TABLES = ['security_audit_log', 'user_sessions', 'keep_alive']

// Tables in correct deletion order (children first, parents last)
const DELETE_ORDER = [
  'deal_action_items', 'lead_action_items', 'action_items',
  'notifications', 'notification_preferences', 'saved_filters',
  'column_preferences', 'dashboard_preferences',
  'deals', 'contacts', 'leads', 'accounts',
  'user_preferences', 'yearly_revenue_targets', 'page_permissions',
  'user_roles', 'profiles'
]

// Tables in correct insertion order (parents first, children last)
const INSERT_ORDER = [
  'profiles', 'user_roles',
  'accounts', 'leads', 'contacts', 'deals',
  'lead_action_items', 'deal_action_items', 'action_items',
  'notifications', 'notification_preferences', 'saved_filters',
  'column_preferences', 'dashboard_preferences',
  'user_preferences', 'yearly_revenue_targets', 'page_permissions'
]

const BATCH_SIZE = 1000

async function fetchAllRows(client: any, table: string): Promise<any[]> {
  const allData: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await client.from(table).select('*').range(from, from + BATCH_SIZE - 1)
    if (error || !data || data.length === 0) break
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

    const { backupId } = await req.json()
    if (!backupId) {
      return new Response(JSON.stringify({ error: 'backupId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Concurrency guard — only one restore may run at a time across all
    // restore endpoints. Row released in the `finally` at the bottom.
    const { error: lockErr } = await adminClient
      .from('backup_restore_locks')
      .insert({ id: 'singleton', locked_by: user.id })
    if (lockErr) {
      return new Response(JSON.stringify({ error: 'Another restore is currently in progress' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {

    const { data: backup, error: fetchError } = await adminClient
      .from('backups')
      .select('*')
      .eq('id', backupId)
      .single()

    if (fetchError || !backup) {
      return new Response(JSON.stringify({ error: 'Backup not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: fileData, error: downloadError } = await adminClient.storage
      .from('backups')
      .download(backup.file_path)

    if (downloadError || !fileData) {
      return new Response(JSON.stringify({ error: 'Failed to download backup file' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const backupContent = JSON.parse(await fileData.text())
    const backupData = backupContent.data
    if (!backupData || typeof backupData !== 'object' || Array.isArray(backupData)) {
      return new Response(JSON.stringify({ error: 'Invalid backup format' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate the envelope BEFORE deleting anything: every table's payload must
    // be an array. Previously a malformed entry (e.g. a non-array value) would
    // pass through, the DELETE phase would still wipe earlier tables, and the
    // insert would throw mid-run — leaving the database partially emptied while
    // the response still reported success. Fail fast, before any destructive op.
    const malformedTables = Object.keys(backupData).filter((t) => !Array.isArray(backupData[t]))
    if (malformedTables.length > 0) {
      return new Response(JSON.stringify({
        error: `Malformed backup: expected an array of rows for each table. Offending table(s): ${malformedTables.join(', ')}`,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ═══════════════════════════════════════════════════════════════
    // PRE-RESTORE SAFETY BACKUP
    // ═══════════════════════════════════════════════════════════════
    console.log('Creating pre-restore safety backup...')
    const tablesToRestore = Object.keys(backupData).filter(t => !SKIP_TABLES.includes(t))
    const safetyBackupData: Record<string, any[]> = {}
    const safetyManifest: Record<string, number> = {}
    let safetyTotalRecords = 0

    for (const table of tablesToRestore) {
      const data = await fetchAllRows(adminClient, table)
      safetyBackupData[table] = data
      safetyManifest[table] = data.length
      safetyTotalRecords += data.length
    }

    const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safetyFileName = `pre-restore-safety-${safetyTimestamp}.json`
    const safetyFilePath = `${user.id}/${safetyFileName}`

    const safetyJson = JSON.stringify({
      version: '1.0',
      created_at: new Date().toISOString(),
      created_by: user.id,
      backup_type: 'pre_restore',
      tables: tablesToRestore,
      manifest: safetyManifest,
      data: safetyBackupData,
    }, null, 2)

    const safetySizeBytes = new Blob([safetyJson]).size

    await adminClient.storage.from('backups').upload(safetyFilePath, safetyJson, {
      contentType: 'application/json', upsert: true,
    })

    await adminClient.from('backups').insert({
      file_name: safetyFileName,
      file_path: safetyFilePath,
      backup_type: 'pre_restore',
      status: 'completed',
      created_by: user.id,
      size_bytes: safetySizeBytes,
      tables_count: tablesToRestore.length,
      records_count: safetyTotalRecords,
      manifest: safetyManifest,
    })

    console.log('Pre-restore safety backup created:', safetyFileName)

    // ═══════════════════════════════════════════════════════════════
    // RESTORE
    // ═══════════════════════════════════════════════════════════════
    const restoredTables: string[] = []
    let restoredRecords = 0
    // Collect any delete/insert failures so we can report them instead of
    // returning success while some tables silently failed to restore.
    const failures: Array<{ table: string; phase: 'delete' | 'insert'; message: string }> = []

    // Delete existing data in reverse dependency order. Abort on first error
    // so we don't silently partially-empty the database.
    for (const table of DELETE_ORDER) {
      if (tablesToRestore.includes(table)) {
        const { error } = await adminClient.from(table).delete().not('id', 'is', null)
        if (error) {
          console.error(`Error clearing ${table}:`, error)
          failures.push({ table, phase: 'delete', message: error.message })
          break
        }
      }
    }

    // Insert data in correct order — abort on first error.
    if (failures.length === 0) {
      for (const table of INSERT_ORDER) {
        if (!backupData[table] || backupData[table].length === 0) continue

        const records = backupData[table]
        let hadError = false
        for (let i = 0; i < records.length; i += 500) {
          const batch = records.slice(i, i + 500)
          const { error } = await adminClient.from(table).upsert(batch, { onConflict: 'id' })
          if (error) {
            console.error(`Error restoring ${table} batch ${i}:`, error)
            failures.push({ table, phase: 'insert', message: error.message })
            hadError = true
            break
          }
        }
        if (hadError) break
        restoredTables.push(table)
        restoredRecords += records.length
      }
    }

    // Also restore any tables in the backup that aren't in INSERT_ORDER
    if (failures.length === 0) {
      for (const table of tablesToRestore) {
        if (INSERT_ORDER.includes(table) || !backupData[table]?.length) continue
        const records = backupData[table]
        let hadError = false
        for (let i = 0; i < records.length; i += 500) {
          const batch = records.slice(i, i + 500)
          const { error } = await adminClient.from(table).upsert(batch, { onConflict: 'id' })
          if (error) {
            console.error(`Error restoring ${table}:`, error)
            failures.push({ table, phase: 'insert', message: error.message })
            hadError = true
            break
          }
        }
        if (hadError) break
        restoredTables.push(table)
        restoredRecords += records.length
      }
    }

    if (failures.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Restore aborted — database may be partially restored. Use the pre-restore safety backup to recover.',
        failedTable: failures[0].table,
        failures,
        restoredTables,
        restoredRecords,
        safetyBackup: safetyFileName,
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({
      success: true,
      restoredTables,
      restoredRecords,
      safetyBackup: safetyFileName,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

    } finally {
      // Release concurrency lock, always.
      await adminClient.from('backup_restore_locks').delete().eq('id', 'singleton')
    }

  } catch (error: any) {
    console.error('Restore error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

