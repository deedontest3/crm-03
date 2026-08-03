import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Whitelist of client-emittable audit actions. The server RPC stamps
 * `user_id` from `auth.uid()`, but it accepts an arbitrary `p_action`
 * string — without this gate the client could spoof any action label
 * (e.g. "ADMIN_LOGIN", "PASSWORD_RESET") and pollute the audit trail.
 *
 * Add a new value here when introducing a new client-side event; anything
 * not listed is silently dropped.
 */
const ALLOWED_ACTIONS = new Set<string>([
  'SESSION_START',
  'SESSION_ACTIVE',
  'SESSION_INACTIVE',
  'SESSION_END',
  'PAGE_VIEW',
  'PERMISSION_DENIED',
  'PROFILE_UPDATE',
  'SETTINGS_UPDATE',
]);

const ALLOWED_RESOURCE_TYPES = new Set<string>([
  'auth',
  'profile',
  'route',
  'settings',
]);

const ALLOWED_DATA_OPERATIONS = new Set<string>(['INSERT', 'UPDATE', 'DELETE']);

const MAX_RESOURCE_ID_LEN = 128;
const MAX_DETAILS_BYTES = 4 * 1024; // 4 KB serialized cap

const trimStr = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
};

const sanitizeDetails = (details: unknown): unknown => {
  if (details == null || typeof details !== 'object') return details;
  try {
    const json = JSON.stringify(details);
    if (json.length <= MAX_DETAILS_BYTES) return details;
    return { _truncated: true, _originalSize: json.length };
  } catch {
    return { _unserializable: true };
  }
};

export const useSecurityAudit = () => {
  const { user } = useAuth();

  const logSecurityEvent = useCallback(async (
    action: string,
    resourceType: string,
    resourceId?: string,
    details?: any
  ) => {
    try {
      if (!user) return;

      // Defense-in-depth: drop unknown actions/resource types client-side.
      if (!ALLOWED_ACTIONS.has(action)) {
        if (import.meta.env.DEV) {
          console.warn(`[security-audit] dropped unknown action: ${action}`);
        }
        return;
      }
      if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) {
        if (import.meta.env.DEV) {
          console.warn(`[security-audit] dropped unknown resource_type: ${resourceType}`);
        }
        return;
      }

      supabase.rpc('log_security_event', {
        p_action: action,
        p_resource_type: resourceType,
        p_resource_id: trimStr(resourceId, MAX_RESOURCE_ID_LEN),
        p_details: sanitizeDetails(details) as any,
      }).then(({ error }) => {
        if (error) console.error('Failed to log security event:', error);
      });
    } catch (error) {
      console.error('Security audit logging error:', error);
    }
  }, [user]);

  const logDataAccess = useCallback(async (
    tableName: string,
    operation: string,
    recordId?: string
  ) => {
    try {
      if (!user) return;
      // Only log mutations.
      if (!ALLOWED_DATA_OPERATIONS.has(operation)) return;

      supabase.rpc('log_data_access', {
        p_table_name: trimStr(tableName, 64) ?? 'unknown',
        p_operation: operation,
        p_record_id: trimStr(recordId, MAX_RESOURCE_ID_LEN),
      }).then(({ error }) => {
        if (error) console.error('Failed to log data access:', error);
      });
    } catch (error) {
      console.error('Data access logging error:', error);
    }
  }, [user]);

  return { logSecurityEvent, logDataAccess };
};
