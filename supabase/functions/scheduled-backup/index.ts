import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireCronSecret } from '../_shared/auth-gate.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

const FREQUENCY_HOURS: Record<string, number> = {
  daily: 24,
  every_2_days: 48,
  weekly: 168,
}

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

function computeNextRun(frequency: string, timeOfDay: string): string {
  const hours = FREQUENCY_HOURS[frequency] || 48
  const [h, m] = timeOfDay.split(':').map(Number)
  const next = new Date()
  next.setTime(next.getTime() + hours * 60 * 60 * 1000)
  next.setHours(h, m, 0, 0)
  return next.toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Cron-only endpoint. Prevents anyone with the public anon key from forcing
  // off-schedule backups and, via MAX_BACKUPS rotation, prematurely deleting
  // legitimate older backups.
  const cron = requireCronSecret(req)
  if ('response' in cron) return cron.response

  try {
    const supabaseUrl = Deno.env.get('MY_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('MY_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Find enabled schedules that are due
    const { data: schedules, error: schedError } = await adminClient
      .from('backup_schedules')
      .select('*')
      .eq('is_enabled', true)
      .lte('next_run_at', new Date().toISOString())

    if (schedError) throw schedError
    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ message: 'No scheduled backups due' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const results: any[] = []

    for (const sched of schedules) {
      try {
        // Determine tables to backup based on scope
        let tablesToBackup = BACKUP_TABLES
        let moduleName: string | null = null

        if (sched.backup_scope === 'module' && sched.backup_module && MODULE_TABLES[sched.backup_module]) {
          tablesToBackup = MODULE_TABLES[sched.backup_module]
          moduleName = sched.backup_module
        }

        const createdBy = sched.created_by
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const fileName = moduleName
          ? `scheduled-${moduleName}-${timestamp}.json`
          : `scheduled-full-${timestamp}.json`
        const filePath = `${createdBy}/${fileName}`

        // Create backup metadata
        const { data: backupRecord, error: insertErr } = await adminClient
          .from('backups')
          .insert({
            file_name: fileName,
            file_path: filePath,
            backup_type: 'scheduled',
            module_name: moduleName,
            status: 'in_progress',
            created_by: createdBy,
          })
          .select()
          .single()

        if (insertErr) {
          console.error('Failed to create backup record:', insertErr)
          continue
        }

        // Export data
        const backupData: Record<string, any[]> = {}
        const manifest: Record<string, number> = {}
        let totalRecords = 0

        for (const table of tablesToBackup) {
          const data = await fetchAllRows(adminClient, table)
          backupData[table] = data
          manifest[table] = data.length
          totalRecords += data.length
        }

        const backupJson = JSON.stringify({
          version: '1.0',
          created_at: new Date().toISOString(),
          created_by: createdBy,
          backup_type: 'scheduled',
          module_name: moduleName,
          tables: tablesToBackup,
          manifest,
          data: backupData,
        }, null, 2)

        const sizeBytes = new Blob([backupJson]).size

        // Upload
        const { error: uploadErr } = await adminClient.storage
          .from('backups')
          .upload(filePath, backupJson, { contentType: 'application/json', upsert: true })

        if (uploadErr) {
          await adminClient.from('backups').update({ status: 'failed' }).eq('id', backupRecord.id)
          console.error('Upload failed:', uploadErr)
          continue
        }

        // Update metadata
        await adminClient.from('backups').update({
          status: 'completed',
          size_bytes: sizeBytes,
          tables_count: tablesToBackup.length,
          records_count: totalRecords,
          manifest,
        }).eq('id', backupRecord.id)

        // Update schedule timing
        const nextRunAt = computeNextRun(sched.frequency, sched.time_of_day)
        await adminClient
          .from('backup_schedules')
          .update({
            last_run_at: new Date().toISOString(),
            next_run_at: nextRunAt,
          })
          .eq('id', sched.id)

        results.push({ scheduleId: sched.id, backupId: backupRecord.id, records: totalRecords })
        console.log(`Scheduled backup completed: ${fileName} (${totalRecords} records)`)
      } catch (err: any) {
        console.error(`Error processing schedule ${sched.id}:`, err)
        results.push({ scheduleId: sched.id, error: err.message })
      }
    }

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

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('Scheduled backup error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
