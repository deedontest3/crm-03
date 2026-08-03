import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { RealtimeChannel } from '@supabase/supabase-js';

type SubscriptionEntry = {
  channel: RealtimeChannel;
  consumers: number;
};

const activeNotificationSubscriptions = new Map<string, SubscriptionEntry>();

/**
 * Lightweight hook for the sidebar bell + NotificationBell badge.
 * Single HEAD count query (cached + shared) + one realtime channel per user
 * with coalesced invalidation to avoid refetch storms during bulk inserts.
 */
export const useUnreadNotificationCount = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications-unread', user?.id],
    enabled: !!user,
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'unread');
      if (error) return 0;
      return count || 0;
    },
  });

  useEffect(() => {
    if (!user) return;

    const scheduleInvalidate = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        queryClient.invalidateQueries({ queryKey: ['notifications-unread', user.id] });
        queryClient.invalidateQueries({ queryKey: ['notifications-recent', user.id] });
        queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
      }, 250);
    };

    const existing = activeNotificationSubscriptions.get(user.id);
    if (existing) {
      existing.consumers += 1;
      return () => {
        existing.consumers -= 1;
        if (existing.consumers <= 0) {
          activeNotificationSubscriptions.delete(user.id);
          supabase.removeChannel(existing.channel);
        }
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
      };
    }

    const channel = supabase
      .channel(`notif-shared-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => scheduleInvalidate(),
      )
      .subscribe();

    activeNotificationSubscriptions.set(user.id, { channel, consumers: 1 });

    return () => {
      const entry = activeNotificationSubscriptions.get(user.id);
      if (entry) {
        entry.consumers -= 1;
        if (entry.consumers <= 0) {
          activeNotificationSubscriptions.delete(user.id);
          supabase.removeChannel(entry.channel);
        }
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [user, queryClient]);

  return unreadCount;
};
