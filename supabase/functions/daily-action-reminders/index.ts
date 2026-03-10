import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get all users with task_reminders enabled
    const { data: prefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('user_id, daily_reminder_time, last_reminder_sent_at')
      .eq('task_reminders', true);

    if (prefsError) throw prefsError;
    if (!prefs || prefs.length === 0) {
      return new Response(JSON.stringify({ message: 'No users with task reminders enabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user timezones from profiles
    const userIds = prefs.map(p => p.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, timezone, full_name')
      .in('id', userIds);

    if (profilesError) throw profilesError;

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
    const now = new Date();
    let notificationsSent = 0;

    for (const pref of prefs) {
      const profile = profileMap.get(pref.user_id);
      const timezone = profile?.timezone || 'Asia/Kolkata';
      const reminderTime = pref.daily_reminder_time || '09:00';

      // Get current time in user's timezone
      const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const userHour = userNow.getHours();
      const userMinute = userNow.getMinutes();
      const userTimeStr = `${userHour.toString().padStart(2, '0')}:${userMinute.toString().padStart(2, '0')}`;

      // Parse reminder time
      const [reminderHour, reminderMinute] = reminderTime.split(':').map(Number);

      // Check if current time is within a 15-minute window of the reminder time
      const userTotalMinutes = userHour * 60 + userMinute;
      const reminderTotalMinutes = reminderHour * 60 + reminderMinute;
      const diff = userTotalMinutes - reminderTotalMinutes;

      if (diff < 0 || diff >= 15) {
        continue; // Not in the reminder window
      }

      // Check if reminder already sent today (in user's timezone)
      const userToday = `${userNow.getFullYear()}-${(userNow.getMonth() + 1).toString().padStart(2, '0')}-${userNow.getDate().toString().padStart(2, '0')}`;
      if (pref.last_reminder_sent_at === userToday) {
        continue; // Already sent today
      }

      // Query incomplete action items for this user
      const { data: actionItems, error: aiError } = await supabase
        .from('action_items')
        .select('id, title, due_date, priority, status')
        .eq('assigned_to', pref.user_id)
        .neq('status', 'Completed')
        .is('archived_at', null);

      if (aiError) {
        console.error(`Error fetching action items for user ${pref.user_id}:`, aiError);
        continue;
      }

      if (!actionItems || actionItems.length === 0) {
        continue; // No pending items
      }

      // Count overdue items
      const overdueCount = actionItems.filter(item => {
        if (!item.due_date) return false;
        return new Date(item.due_date) < new Date(userToday);
      }).length;

      const highPriorityCount = actionItems.filter(item => item.priority === 'High').length;

      // Build notification message
      let message = `📋 Daily Reminder: You have ${actionItems.length} pending action item${actionItems.length > 1 ? 's' : ''}`;
      const details: string[] = [];
      if (overdueCount > 0) details.push(`${overdueCount} overdue`);
      if (highPriorityCount > 0) details.push(`${highPriorityCount} high priority`);
      if (details.length > 0) message += ` (${details.join(', ')})`;

      // Insert notification
      const { error: notifError } = await supabase
        .from('notifications')
        .insert({
          user_id: pref.user_id,
          message,
          notification_type: 'task_reminder',
          status: 'unread',
        });

      if (notifError) {
        console.error(`Error inserting notification for user ${pref.user_id}:`, notifError);
        continue;
      }

      // Update last_reminder_sent_at
      await supabase
        .from('notification_preferences')
        .update({ last_reminder_sent_at: userToday })
        .eq('user_id', pref.user_id);

      notificationsSent++;
      console.log(`Sent reminder to user ${pref.user_id}: ${message}`);
    }

    return new Response(JSON.stringify({ 
      message: `Processed ${prefs.length} users, sent ${notificationsSent} reminders` 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in daily-action-reminders:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
