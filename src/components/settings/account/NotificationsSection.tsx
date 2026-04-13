import { useState, useEffect, useRef, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlarmClock, Check, Mail, Bell, TrendingUp, ListChecks, Building2, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSecurityAudit } from '@/hooks/useSecurityAudit';

interface NotificationPrefs {
  email_notifications: boolean;
  in_app_notifications: boolean;
  push_notifications: boolean;
  lead_assigned: boolean;
  deal_updates: boolean;
  task_reminders: boolean;
  meeting_reminders: boolean;
  weekly_digest: boolean;
  notification_frequency: string;
  leads_notifications: boolean;
  contacts_notifications: boolean;
  accounts_notifications: boolean;
  daily_reminder_time: string;
}

interface NotificationsSectionProps {
  notificationPrefs: NotificationPrefs;
  setNotificationPrefs: React.Dispatch<React.SetStateAction<NotificationPrefs>>;
  userId: string;
  userTimezone?: string;
}

const TIME_OPTIONS = Array.from({ length: 33 }, (_, i) => {
  const totalMinutes = 6 * 60 + i * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const value = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  const hour12 = hours % 12 || 12;
  const ampm = hours < 12 ? 'AM' : 'PM';
  const label = `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  return { value, label };
});

const NotificationsSection = ({ notificationPrefs, setNotificationPrefs, userId, userTimezone }: NotificationsSectionProps) => {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(notificationPrefs));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const { logSecurityEvent } = useSecurityAudit();

  const saveNotificationPrefs = useCallback(async (prefs: NotificationPrefs) => {
    if (!userId) return;
    setSaveStatus('saving');
    try {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: userId,
          email_notifications: prefs.email_notifications,
          in_app_notifications: prefs.in_app_notifications,
          push_notifications: prefs.push_notifications,
          lead_assigned: prefs.lead_assigned,
          deal_updates: prefs.deal_updates,
          task_reminders: prefs.task_reminders,
          meeting_reminders: prefs.meeting_reminders,
          weekly_digest: prefs.weekly_digest,
          notification_frequency: prefs.notification_frequency,
          leads_notifications: prefs.leads_notifications,
          contacts_notifications: prefs.contacts_notifications,
          accounts_notifications: prefs.accounts_notifications,
          daily_reminder_time: prefs.daily_reminder_time,
          updated_at: new Date().toISOString()
        } as any, { onConflict: 'user_id' });
      if (error) throw error;
      lastSavedRef.current = JSON.stringify(prefs);
      logSecurityEvent('SETTINGS_UPDATE', 'notification_preferences', undefined, {
        updated_preferences: prefs
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      toast.error('Failed to save notification preferences');
      setSaveStatus('idle');
    }
  }, [userId]);

  useEffect(() => {
    const currentPrefs = JSON.stringify(notificationPrefs);
    if (currentPrefs === lastSavedRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveNotificationPrefs(notificationPrefs), 600);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [notificationPrefs, saveNotificationPrefs]);

  const updatePref = <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
    setNotificationPrefs(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Save status indicator */}
      {saveStatus !== 'idle' && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-in fade-in duration-200">
          {saveStatus === 'saving' && (
            <span className="text-muted-foreground">Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <>
            <Check className="h-3.5 w-3.5 text-primary" />
              <span className="text-primary">Saved</span>
            </>
          )}
        </div>
      )}

      {/* Delivery Channels */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Delivery Channels</h4>
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {/* Email */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Email Notifications</Label>
                <p className="text-xs text-muted-foreground">Receive notifications via email</p>
              </div>
            </div>
            <Switch
              checked={notificationPrefs.email_notifications}
              onCheckedChange={(v) => updatePref('email_notifications', v)}
            />
          </div>

          {/* In-App */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">In-App Notifications</Label>
                <p className="text-xs text-muted-foreground">Show notifications in the app</p>
              </div>
            </div>
            <Switch
              checked={notificationPrefs.in_app_notifications}
              onCheckedChange={(v) => updatePref('in_app_notifications', v)}
            />
          </div>

          {/* Frequency */}
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <Label className="text-sm font-medium">Frequency</Label>
              <p className="text-xs text-muted-foreground">How often to receive notifications</p>
            </div>
            <Select value={notificationPrefs.notification_frequency} onValueChange={(v) => updatePref('notification_frequency', v)}>
              <SelectTrigger className="w-[130px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instant">Instant</SelectItem>
                <SelectItem value="daily">Daily Digest</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Daily Reminder Time - only show when task reminders are on */}
          {notificationPrefs.task_reminders && (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <AlarmClock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Label className="text-sm font-medium">Daily Reminder Time</Label>
                  <p className="text-xs text-muted-foreground">
                    When to send action item reminders
                    {userTimezone && <span className="ml-1">({userTimezone})</span>}
                  </p>
                </div>
              </div>
              <Select value={notificationPrefs.daily_reminder_time} onValueChange={(v) => updatePref('daily_reminder_time', v)}>
                <SelectTrigger className="w-[120px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Notify Me About */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notify Me About</h4>
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {/* Deal Stage Changes */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Deal Stage Changes</Label>
                <p className="text-xs text-muted-foreground">When a deal moves to a new stage</p>
              </div>
            </div>
            <Switch
              checked={notificationPrefs.deal_updates}
              onCheckedChange={(v) => updatePref('deal_updates', v)}
            />
          </div>

          {/* Action Item Reminders */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Action Item Reminders</Label>
                <p className="text-xs text-muted-foreground">Overdue and high-priority task alerts</p>
              </div>
            </div>
            <Switch
              checked={notificationPrefs.task_reminders}
              onCheckedChange={(v) => updatePref('task_reminders', v)}
            />
          </div>

          {/* Account Updates */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Account Updates</Label>
                <p className="text-xs text-muted-foreground">Changes to accounts you own or follow</p>
              </div>
            </div>
            <Switch
              checked={notificationPrefs.accounts_notifications}
              onCheckedChange={(v) => updatePref('accounts_notifications', v)}
            />
          </div>

          {/* Contact Updates */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Contact Updates</Label>
                <p className="text-xs text-muted-foreground">Changes to contacts you own or follow</p>
              </div>
            </div>
            <Switch
              checked={notificationPrefs.contacts_notifications}
              onCheckedChange={(v) => updatePref('contacts_notifications', v)}
            />
          </div>

          {/* Deals module (mapped to leads_notifications DB column) */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Deal Notifications</Label>
                <p className="text-xs text-muted-foreground">All deal-related activity notifications</p>
              </div>
            </div>
            <Switch
              checked={notificationPrefs.leads_notifications}
              onCheckedChange={(v) => updatePref('leads_notifications', v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationsSection;
