import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUnreadNotificationCount } from '@/hooks/useUnreadNotificationCount';
import type { NotificationRecord } from '@/lib/notificationTypes';

/**
 * Lightweight hook for the NotificationBell dropdown. Always returns the most
 * recent notifications regardless of the filters selected on the /notifications
 * page — bell and page have independent caches and never interfere.
 */
export const useRecentNotifications = (limit = 8) => {
  const { user } = useAuth();
  // Reuses the shared realtime subscription + unread count.
  const unreadCount = useUnreadNotificationCount();

  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications-recent', user?.id, limit],
    enabled: !!user,
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!user) return [] as NotificationRecord[];
      const { data: rows, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return [] as NotificationRecord[];
      return (rows || []).map((r) => ({
        ...r,
        status: r.status as 'read' | 'unread',
      })) as NotificationRecord[];
    },
  });

  return { notifications: data, unreadCount, loading: isLoading };
};
