import { format, isToday, isThisWeek, subDays, startOfMonth } from 'date-fns';

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details?: any;
  ip_address?: string;
  created_at: string;
}

// Actions to exclude by default (system noise)
const EXCLUDED_ACTIONS = [
  'SESSION_ACTIVE', 'SESSION_INACTIVE', 'SESSION_HEARTBEAT',
  'WINDOW_BLUR', 'WINDOW_FOCUS', 'USER_ACTIVITY',
  'SELECT', 'SENSITIVE_DATA_ACCESS', 'PAGE_NAVIGATION'
];

// Internal fields to hide from detail views
const INTERNAL_FIELDS = [
  'id', 'created_at', 'created_by', 'created_time', 'modified_at', 'modified_by',
  'modified_time', 'updated_at', 'last_activity_time', 'account_id'
];

export const getExcludedActions = () => EXCLUDED_ACTIONS;

export const formatFieldName = (field: string): string => {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
};

export const formatFieldValue = (value: any): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  // Check if it looks like an ISO date
  if (/^\d{4}-\d{2}-\d{2}(T|\s)/.test(str)) {
    try {
      return format(new Date(str), 'MMM dd, yyyy h:mm a');
    } catch { return str; }
  }
  return str;
};

export const filterInternalFields = (data: Record<string, any>): Record<string, any> => {
  const filtered: Record<string, any> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (!INTERNAL_FIELDS.includes(key) && value !== null && value !== undefined && value !== '') {
      filtered[key] = value;
    }
  });
  return filtered;
};

export const filterNoiseFieldChanges = (fieldChanges: Record<string, any>): Record<string, any> => {
  const filtered: Record<string, any> = {};
  Object.entries(fieldChanges).forEach(([key, value]) => {
    if (!INTERNAL_FIELDS.includes(key)) {
      filtered[key] = value;
    }
  });
  return filtered;
};

export const getRecordName = (log: AuditLog): string => {
  const d = log.details;
  if (!d) return '';
  
  // From record_data (CREATE)
  if (d.record_data) {
    return d.record_data.deal_name || d.record_data.project_name || d.record_data.lead_name || d.record_data.contact_name || d.record_data.account_name || d.record_data.title || '';
  }
  // From old_data (UPDATE/DELETE)
  if (d.old_data) {
    return d.old_data.deal_name || d.old_data.project_name || d.old_data.lead_name || d.old_data.contact_name || d.old_data.account_name || d.old_data.title || '';
  }
  // From deleted_data (DELETE)
  if (d.deleted_data) {
    return d.deleted_data.deal_name || d.deleted_data.project_name || d.deleted_data.lead_name || d.deleted_data.contact_name || d.deleted_data.account_name || d.deleted_data.title || '';
  }
  // From resolved bulk update metadata
  if (d.update_data?.item_titles?.length) {
    return d.update_data.item_titles[0];
  }
  if (d.item_titles?.length) {
    return d.item_titles[0];
  }
  return '';
};

export const getModuleName = (log: AuditLog): string => {
  if (log.details?.module) {
    const m = log.details.module;
    // Normalize to readable name, then use the standard map if available
    const normalized = m.toLowerCase().replace(/ /g, '_');
    const mapped = getReadableResourceType(normalized);
    if (mapped !== normalized) return mapped;
    return m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, ' ');
  }
  return getReadableResourceType(log.resource_type);
};

export const getReadableResourceType = (resourceType: string): string => {
  const map: Record<string, string> = {
    contacts: 'Contacts', leads: 'Leads', deals: 'Deals',
    action_items: 'Action Items', auth: 'Authentication',
    user_roles: 'User Roles', profiles: 'Profiles',
    user_management: 'User Management',
    deal_stakeholders: 'Deals',
    page_permissions: 'Page Access',
    email_templates: 'Email Templates',
    notification_preferences: 'Notifications',
  };
  return map[resourceType] || resourceType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export const generateSummary = (log: AuditLog): string => {
  const name = getRecordName(log);
  const module = getModuleName(log);
  const d = log.details;

  switch (log.action) {
    case 'CREATE':
      return name ? `Created new ${module.replace(/s$/, '')} "${name}"` : `Created new ${module.replace(/s$/, '')} record`;
    case 'UPDATE': {
      const displayName = name || module.replace(/s$/, '');
      if (d?.field_changes) {
        const changes = filterNoiseFieldChanges(d.field_changes);
        const keys = Object.keys(changes);
        if (keys.length === 0) {
          if (d.updated_fields) {
            const updatedKeys = Object.keys(d.updated_fields).filter(k => !['id', 'created_at', 'updated_at', 'modified_at', 'modified_by', 'created_by'].includes(k));
            if (updatedKeys.length === 1) {
              return `Updated "${displayName}" — ${formatFieldName(updatedKeys[0])}: ${formatFieldValue(d.updated_fields[updatedKeys[0]])}`;
            }
            if (updatedKeys.length > 1) {
              return `Updated "${displayName}" — ${updatedKeys.length} fields: ${updatedKeys.map(formatFieldName).join(', ')}`;
            }
          }
          return `Updated ${module.replace(/s$/, '')} "${displayName}"`;
        }
        if (keys.length === 1) {
          const field = keys[0];
          const change = changes[field];
          const oldVal = change.old;
          const newVal = change.new;
          if (oldVal === null || oldVal === undefined || oldVal === '') {
            return `Updated "${displayName}" — ${formatFieldName(field)}: (unknown) → ${formatFieldValue(newVal)}`;
          }
          return `Updated "${displayName}" — ${formatFieldName(field)}: ${formatFieldValue(oldVal)} → ${formatFieldValue(newVal)}`;
        }
        return `Updated "${displayName}" — ${keys.length} fields changed`;
      }
      if (d?.updated_fields) {
        const updatedKeys = Object.keys(d.updated_fields).filter(k => !['id', 'created_at', 'updated_at', 'modified_at', 'modified_by', 'created_by'].includes(k));
        if (updatedKeys.length > 0) {
          return `Updated "${displayName}" — ${updatedKeys.map(formatFieldName).join(', ')}`;
        }
      }
      return `Updated ${module.replace(/s$/, '')} "${displayName}"`;
    }
    case 'DELETE':
      return name ? `Deleted ${module.replace(/s$/, '')} "${name}"` : `Deleted ${module.replace(/s$/, '')} record`;
    case 'BULK_CREATE':
      return `Bulk created ${d?.record_count || 'multiple'} ${module} records`;
    case 'BULK_UPDATE': {
      const bulkCount = d?.record_count ?? 'multiple';
      const targetStatus = d?.update_data?.status || d?.status;
      const titles = d?.update_data?.item_titles || d?.item_titles;
      if (targetStatus && titles?.length) {
        return `Marked ${bulkCount} ${module} as ${targetStatus}: ${titles.join(', ')}`;
      }
      if (targetStatus) {
        return `Marked ${bulkCount} ${module} as ${targetStatus}`;
      }
      return `Bulk updated ${bulkCount} ${module} records${titles?.length ? ': ' + titles.join(', ') : ''}`;
    }
    case 'BULK_DELETE':
      return `Bulk deleted ${d?.record_count || 'multiple'} ${module} records`;
    case 'SETTINGS_UPDATE':
      return `Updated ${module} settings`;
    case 'NOTE':
      return `Added note${name ? ` on ${module.replace(/s$/, '')}: "${d?.message?.substring(0, 40) || ''}"` : ''}`;
    case 'EMAIL':
      return `Logged email${name ? ` on ${module.replace(/s$/, '')}` : ''}${d?.message ? `: "${d.message.substring(0, 40)}"` : ''}`;
    case 'MEETING':
      return `Logged meeting${name ? ` on ${module.replace(/s$/, '')}` : ''}${d?.message ? `: "${d.message.substring(0, 40)}"` : ''}`;
    case 'CALL':
      return `Logged call${name ? ` on ${module.replace(/s$/, '')}` : ''}${d?.message ? `: "${d.message.substring(0, 40)}"` : ''}`;
    case 'SESSION_START':
      return 'Logged in';
    case 'SESSION_END':
      return 'Logged out';
    case 'user_login':
      return 'Logged in';
    case 'DATA_EXPORT':
      return `Exported ${d?.record_count || ''} ${d?.module || module} records as ${d?.export_type || 'CSV'}`;
    case 'DATA_IMPORT':
    case 'DATA_IMPORT_SUCCESS':
      return `Imported ${d?.record_count || ''} ${d?.module || module} records`;
    case 'DATA_IMPORT_FAILED':
      return `Import failed for ${d?.module || module}`;
    case 'PASSWORD_CHANGE':
      return 'Changed password';
    case 'ALL_SESSIONS_TERMINATED':
      return 'Terminated all sessions';
    case 'SESSION_TERMINATED':
      return 'Terminated a session';
    default:
      return log.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
};

export type ActivityBadgeColor = 'green' | 'blue' | 'red' | 'yellow' | 'purple' | 'gray' | 'orange';

export const getActivityBadgeColor = (action: string): ActivityBadgeColor => {
  if (action === 'CREATE' || action === 'BULK_CREATE') return 'green';
  if (action === 'UPDATE' || action === 'BULK_UPDATE') return 'blue';
  if (action === 'DELETE' || action === 'BULK_DELETE') return 'red';
  if (['NOTE', 'EMAIL', 'MEETING', 'CALL'].includes(action)) return 'purple';
  if (action.includes('EXPORT') || action.includes('IMPORT')) return 'orange';
  if (action.includes('SESSION') || action.includes('LOGIN') || action.includes('login') || action.includes('LOGOUT')) return 'gray';
  if (action.includes('PASSWORD') || action.includes('TERMINATED')) return 'yellow';
  return 'gray';
};

export const getActivityLabel = (action: string): string => {
  const map: Record<string, string> = {
    CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted',
    BULK_CREATE: 'Bulk Created', BULK_UPDATE: 'Bulk Updated', BULK_DELETE: 'Bulk Deleted',
    NOTE: 'Note', EMAIL: 'Email', MEETING: 'Meeting', CALL: 'Call',
    SESSION_START: 'Login', SESSION_END: 'Logout', user_login: 'Login',
    DATA_EXPORT: 'Export', DATA_IMPORT: 'Import',
    DATA_IMPORT_SUCCESS: 'Import', DATA_IMPORT_FAILED: 'Import Failed',
    PASSWORD_CHANGE: 'Security', ALL_SESSIONS_TERMINATED: 'Security',
    SESSION_TERMINATED: 'Security',
  };
  return map[action] || action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export type FilterCategory = 'all' | 'all_except_auth' | 'record_changes' | 'user_management' | 'authentication' | 'export' | 'activities';

export const filterByCategory = (logs: AuditLog[], category: FilterCategory): AuditLog[] => {
  if (category === 'all') return logs;
  if (category === 'all_except_auth') {
    return logs.filter(log => !['SESSION_START', 'SESSION_END', 'user_login'].includes(log.action));
  }
  return logs.filter(log => {
    switch (category) {
      case 'record_changes':
        return ['CREATE', 'UPDATE', 'DELETE', 'BULK_CREATE', 'BULK_UPDATE', 'BULK_DELETE'].includes(log.action);
      case 'user_management':
        return ['USER_CREATED', 'USER_DELETED', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'ROLE_CHANGE', 'PASSWORD_RESET', 'PASSWORD_CHANGE', 'ADMIN_ACTION', 'USER_ROLE_UPDATED', 'USER_STATUS_CHANGED', 'NEW_USER_REGISTERED', 'ALL_SESSIONS_TERMINATED', 'SESSION_TERMINATED'].includes(log.action) ||
          log.resource_type === 'user_roles' || log.resource_type === 'profiles' || log.resource_type === 'user_management';
      case 'authentication':
        return ['SESSION_START', 'SESSION_END', 'user_login'].includes(log.action);
      case 'export':
        return log.action.includes('EXPORT') || log.action.includes('IMPORT');
      case 'activities':
        return ['NOTE', 'EMAIL', 'MEETING', 'CALL'].includes(log.action);
      default:
        return true;
    }
  });
};

export const getDatePresets = () => [
  { label: 'Today', from: new Date(new Date().setHours(0, 0, 0, 0)), to: new Date() },
  { label: 'Last 7 days', from: subDays(new Date(), 7), to: new Date() },
  { label: 'Last 30 days', from: subDays(new Date(), 30), to: new Date() },
  { label: 'This month', from: startOfMonth(new Date()), to: new Date() },
];

export const getStatsFromLogs = (logs: AuditLog[]) => {
  const todayCount = logs.filter(l => isToday(new Date(l.created_at))).length;
  const weekCount = logs.filter(l => isThisWeek(new Date(l.created_at))).length;

  const byModule: Record<string, number> = {};
  const byUser: Record<string, number> = {};

  logs.forEach(log => {
    const mod = getModuleName(log);
    byModule[mod] = (byModule[mod] || 0) + 1;
    if (log.user_id) {
      byUser[log.user_id] = (byUser[log.user_id] || 0) + 1;
    }
  });

  return { todayCount, weekCount, byModule, byUser, total: logs.length };
};
