import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useUnreadNotificationCount } from '@/hooks/useUnreadNotificationCount';
import type { NotificationRecord } from '@/lib/notificationTypes';

export interface NotificationFilters {
  status?: 'all' | 'unread' | 'read';
  type?: string; // 'all' | notification_type
  dateRange?: 'all' | 'today' | '7d' | '30d';
}

const ITEMS_PER_PAGE = 50;

export const useNotifications = (filters: NotificationFilters = {}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const unreadCount = useUnreadNotificationCount();

  const status = filters.status ?? 'all';
  const type = filters.type ?? 'all';
  const dateRange = filters.dateRange ?? 'all';

  const sinceIso = useMemo(() => {
    if (dateRange === 'all') return null;
    const now = new Date();
    const since = new Date(now);
    if (dateRange === 'today') since.setHours(0, 0, 0, 0);
    else if (dateRange === '7d') since.setDate(now.getDate() - 7);
    else if (dateRange === '30d') since.setDate(now.getDate() - 30);
    return since.toISOString();
  }, [dateRange]);

  const queryKey = ['notifications', user?.id, currentPage, status, type, dateRange];

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    enabled: !!user,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!user) return { notifications: [], total: 0 };

      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE - 1;

      let q = supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id);

      if (status !== 'all') q = q.eq('status', status);
      if (type !== 'all') q = q.eq('notification_type', type);
      if (sinceIso) q = q.gte('created_at', sinceIso);

      const { data: rows, count, error } = await q
        .order('created_at', { ascending: false })
        .range(startIndex, endIndex);

      if (error) throw error;

      const typed: NotificationRecord[] = (rows || []).map((item) => ({
        ...item,
        status: item.status as 'read' | 'unread',
      }));

      return { notifications: typed, total: count || 0 };
    },
  });

  const notifications = data?.notifications || [];
  const totalNotifications = data?.total || 0;

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(totalNotifications / ITEMS_PER_PAGE));
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalNotifications]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['notifications-recent', user?.id] });
  }, [queryClient, user?.id]);

  const markAsRead = useCallback(async (notificationId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('notifications')
      .update({ status: 'read' })
      .eq('id', notificationId)
      .eq('user_id', user.id);
    if (error) {
      console.error('Error marking notification as read:', error);
      return;
    }
    invalidate();
  }, [user, invalidate]);

  const markAsUnread = useCallback(async (notificationId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('notifications')
      .update({ status: 'unread' })
      .eq('id', notificationId)
      .eq('user_id', user.id);
    if (error) return;
    invalidate();
  }, [user, invalidate]);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    const { error } = await supabase
      .from('notifications')
      .update({ status: 'read' })
      .eq('user_id', user.id)
      .eq('status', 'unread');
    if (error) {
      toast({ title: 'Error', description: 'Failed to mark notifications as read', variant: 'destructive' });
      return;
    }
    invalidate();
    toast({ title: 'Success', description: 'All notifications marked as read' });
  }, [user, invalidate, toast]);

  const markManyAsRead = useCallback(async (ids: string[]) => {
    if (!user || ids.length === 0) return;
    const { error } = await supabase
      .from('notifications')
      .update({ status: 'read' })
      .in('id', ids)
      .eq('user_id', user.id);
    if (error) return;
    invalidate();
  }, [user, invalidate]);

  const deleteNotification = useCallback(async (notificationId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', user.id);
    if (error) {
      toast({ title: 'Error', description: 'Failed to delete notification', variant: 'destructive' });
      return;
    }
    invalidate();
    toast({ title: 'Deleted', description: 'Notification removed' });
  }, [user, invalidate, toast]);

  const deleteMany = useCallback(async (ids: string[]) => {
    if (!user || ids.length === 0) return;
    const { error } = await supabase
      .from('notifications')
      .delete()
      .in('id', ids)
      .eq('user_id', user.id);
    if (error) {
      toast({ title: 'Error', description: 'Failed to delete notifications', variant: 'destructive' });
      return;
    }
    invalidate();
    toast({ title: 'Deleted', description: `${ids.length} notification${ids.length === 1 ? '' : 's'} removed` });
  }, [user, invalidate, toast]);

  /**
   * Filter-aware clear: deletes ONLY the notifications matching the current
   * filters (not the entire mailbox). Matches what the user is actually seeing.
   */
  const clearFiltered = useCallback(async () => {
    if (!user) return;
    let q = supabase.from('notifications').delete().eq('user_id', user.id);
    if (status !== 'all') q = q.eq('status', status);
    if (type !== 'all') q = q.eq('notification_type', type);
    if (sinceIso) q = q.gte('created_at', sinceIso);
    const { error } = await q;
    if (error) {
      toast({ title: 'Error', description: 'Failed to clear notifications', variant: 'destructive' });
      return;
    }
    setCurrentPage(1);
    invalidate();
    toast({ title: 'Cleared', description: 'Matching notifications removed' });
  }, [user, status, type, sinceIso, invalidate, toast]);

  const fetchNotifications = (page: number = 1) => setCurrentPage(Math.max(1, page));

  return {
    notifications,
    unreadCount,
    loading: isLoading,
    fetching: isFetching,
    currentPage,
    totalNotifications,
    itemsPerPage: ITEMS_PER_PAGE,
    markAsRead,
    markAsUnread,
    markAllAsRead,
    markManyAsRead,
    deleteNotification,
    deleteMany,
    clearFiltered,
    fetchNotifications,
    setCurrentPage,
  };
};
