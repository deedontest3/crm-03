import { useState, useEffect, useRef, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, Mail, MessageSquare, Clock, AlarmClock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

const SectionHeader = ({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description?: string }) => (
  <div className="flex items-center gap-2 mb-2">
    <Icon className="h-4 w-4 text-muted-foreground" />
    <span className="text-sm font-semibold">{title}</span>
    {description && <span className="text-xs text-muted-foreground ml-1">— {description}</span>}
  </div>
);

const ToggleRow = ({ label, checked, onChange, icon: Icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: React.ElementType }) => (
  <div className="flex items-center justify-between py-1.5">
    <div className="flex items-center gap-2">
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      <Label className="text-sm cursor-pointer">{label}</Label>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

const NotificationsSection = ({ notificationPrefs, setNotificationPrefs, userId, userTimezone }: NotificationsSectionProps) => {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(notificationPrefs));
  const [isSaving, setIsSaving] = useState(false);

  const saveNotificationPrefs = useCallback(async (prefs: NotificationPrefs) => {
    if (!userId) return;
    setIsSaving(true);
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
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      toast.error('Failed to save notification preferences');
    } finally {
      setIsSaving(false);
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
    <div className="space-y-1">
      {/* Delivery Methods */}
      <div className="rounded-md border bg-card p-4">
        <SectionHeader icon={Bell} title="Delivery Methods" description="How you receive notifications" />
        <div className="divide-y divide-border">
          <ToggleRow icon={Mail} label="Email Notifications" checked={notificationPrefs.email_notifications} onChange={(v) => updatePref('email_notifications', v)} />
          <ToggleRow icon={MessageSquare} label="In-App Notifications" checked={notificationPrefs.in_app_notifications} onChange={(v) => updatePref('in_app_notifications', v)} />
        </div>
      </div>

      {/* Delivery Frequency + Reminder Time */}
      <div className="rounded-md border bg-card p-4">
        <SectionHeader icon={Clock} title="Frequency & Reminders" />
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Frequency</Label>
            <Select value={notificationPrefs.notification_frequency} onValueChange={(v) => updatePref('notification_frequency', v)}>
              <SelectTrigger className="w-[130px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instant">Instant</SelectItem>
                <SelectItem value="daily">Daily Digest</SelectItem>
                <SelectItem value="weekly">Weekly Digest</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {notificationPrefs.task_reminders && (
            <div className="flex items-center gap-2">
              <AlarmClock className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-sm whitespace-nowrap">Daily Reminder</Label>
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
              {userTimezone && <span className="text-xs text-muted-foreground">({userTimezone})</span>}
            </div>
          )}
        </div>
      </div>

      {/* Module Notifications */}
      <div className="rounded-md border bg-card p-4">
        <SectionHeader icon={Bell} title="Module Notifications" description="Which modules send notifications" />
        <div className="divide-y divide-border">
          <ToggleRow label="Leads" checked={notificationPrefs.leads_notifications} onChange={(v) => updatePref('leads_notifications', v)} />
          <ToggleRow label="Contacts" checked={notificationPrefs.contacts_notifications} onChange={(v) => updatePref('contacts_notifications', v)} />
          <ToggleRow label="Accounts" checked={notificationPrefs.accounts_notifications} onChange={(v) => updatePref('accounts_notifications', v)} />
        </div>
      </div>

      {/* Event Triggers */}
      <div className="rounded-md border bg-card p-4">
        <SectionHeader icon={Bell} title="Event Triggers" description="Which events trigger notifications" />
        <div className="divide-y divide-border">
          <ToggleRow label="Lead Assigned" checked={notificationPrefs.lead_assigned} onChange={(v) => updatePref('lead_assigned', v)} />
          <ToggleRow label="Deal Updates" checked={notificationPrefs.deal_updates} onChange={(v) => updatePref('deal_updates', v)} />
          <ToggleRow label="Action Item Reminders" checked={notificationPrefs.task_reminders} onChange={(v) => updatePref('task_reminders', v)} />
          <ToggleRow label="Meeting Reminders" checked={notificationPrefs.meeting_reminders} onChange={(v) => updatePref('meeting_reminders', v)} />
          <ToggleRow label="Weekly Digest" checked={notificationPrefs.weekly_digest} onChange={(v) => updatePref('weekly_digest', v)} />
        </div>
      </div>
    </div>
  );
};

export default NotificationsSection;
