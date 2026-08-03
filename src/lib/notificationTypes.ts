// Shared notification type registry — single source of truth for the
// notification_type values produced by DB triggers / edge functions and
// consumed by the UI (filter dropdown + icon resolution).

export type NotificationSeverity = "info" | "success" | "warning" | "critical";

export interface NotificationTypeDef {
  value: string;
  label: string;
  icon: string;
  severity: NotificationSeverity;
}

export interface NotificationRecord {
  id: string;
  user_id: string;
  lead_id: string | null;
  message: string;
  status: "read" | "unread";
  notification_type: string;
  action_item_id: string | null;
  module_type: string | null;
  module_id: string | null;
  created_at: string;
  updated_at: string;
}

export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
  { value: "action_item", label: "Action items", icon: "📋", severity: "info" },
  { value: "task_reminder", label: "Task reminders", icon: "📋", severity: "warning" },
  { value: "meeting_reminder", label: "Meeting reminders", icon: "📅", severity: "warning" },
  { value: "deal_update", label: "Deal updates", icon: "💼", severity: "info" },
  { value: "deal_stale", label: "Stale deals", icon: "⏰", severity: "warning" },
  { value: "lead_update", label: "Lead updates", icon: "👤", severity: "info" },
  { value: "lead_assigned", label: "Lead assigned", icon: "👤", severity: "info" },
  { value: "contact_update", label: "Contact updates", icon: "📇", severity: "info" },
  { value: "account_update", label: "Account updates", icon: "🏢", severity: "info" },
  { value: "campaign_reply", label: "Campaign replies", icon: "📩", severity: "info" },
  { value: "campaign_update", label: "Campaign status", icon: "📣", severity: "info" },
  { value: "backup", label: "Backups", icon: "💾", severity: "info" },
  { value: "security", label: "Security", icon: "🔐", severity: "critical" },
  { value: "user_mgmt", label: "User management", icon: "👥", severity: "info" },
  { value: "import_export", label: "Imports / exports", icon: "📤", severity: "info" },
  { value: "automation", label: "Automation", icon: "⚙️", severity: "info" },
];

const BY_TYPE: Record<string, NotificationTypeDef> = NOTIFICATION_TYPES.reduce(
  (acc, t) => {
    acc[t.value] = t;
    return acc;
  },
  {} as Record<string, NotificationTypeDef>,
);

/**
 * Resolve an icon from the structured notification_type.
 * Message-scan heuristics were removed — icons come strictly from the registry.
 */
export function getNotificationIcon(
  notificationType?: string | null,
  _message?: string | null,
): string {
  if (notificationType && BY_TYPE[notificationType]) {
    return BY_TYPE[notificationType].icon;
  }
  return "🔔";
}

export function getNotificationTypeLabel(notificationType?: string | null): string {
  if (!notificationType) return "Notification";
  return BY_TYPE[notificationType]?.label ?? notificationType.replace(/_/g, " ");
}

export function getNotificationSeverity(notificationType?: string | null): NotificationSeverity {
  if (!notificationType) return "info";
  return BY_TYPE[notificationType]?.severity ?? "info";
}

/** Tailwind badge classes per severity, using semantic tokens only. */
export function getSeverityBadgeClasses(severity: NotificationSeverity): string {
  switch (severity) {
    case "critical":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "warning":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "success":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "info":
    default:
      return "border-primary/30 bg-primary/10 text-primary";
  }
}

export function getNotificationDestination(notification: NotificationRecord): string {
  if (notification.action_item_id) {
    return `/action-items?highlight=${notification.action_item_id}`;
  }

  if (notification.module_id) {
    if (notification.module_type === "campaigns") return `/campaigns/${notification.module_id}`;
    if (notification.module_type === "deals") return `/deals?highlight=${notification.module_id}`;
    if (notification.module_type === "leads") return `/deals?highlight=${notification.module_id}`;
    if (notification.module_type === "accounts") return `/accounts?highlight=${notification.module_id}`;
    if (notification.module_type === "contacts") return `/contacts?highlight=${notification.module_id}`;
  }

  if (notification.lead_id) return `/deals?highlight=${notification.lead_id}`;
  if (notification.notification_type === "campaign_reply") return "/campaigns";
  if (["action_item", "task_reminder", "meeting_reminder"].includes(notification.notification_type)) return "/action-items";
  if (["deal_update", "deal_stale"].includes(notification.notification_type)) return "/deals";
  if (["lead_update", "lead_assigned"].includes(notification.notification_type)) return "/deals";
  if (notification.notification_type === "account_update") return "/accounts";
  if (notification.notification_type === "contact_update") return "/contacts";

  return "/notifications";
}

/** Bucket a Date into a day-group label used by the notification center list. */
export function getDayGroupLabel(date: Date): "Today" | "Yesterday" | "This week" | "Earlier" {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
  const t = date.getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfYesterday) return "Yesterday";
  if (t >= startOfWeek) return "This week";
  return "Earlier";
}
