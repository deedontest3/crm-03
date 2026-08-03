import React, { createContext, useContext, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type AppRole = 'super_admin' | 'admin' | 'sales_head' | 'user';

interface PagePermission {
  id: string;
  page_name: string;
  route: string;
  admin_access: boolean;
  sales_head_access: boolean;
  user_access: boolean;
  super_admin_access: boolean;
}

interface PermissionsContextType {
  userRole: AppRole;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isSalesHead: boolean;
  /** True for admin OR super_admin. Use when an "admin-ish" view should include super admins. */
  isAdminOrAbove: boolean;
  /** @deprecated manager role no longer exists; kept as `false` for back-compat. */
  isManager: boolean;
  permissions: PagePermission[];
  loading: boolean;
  hasPageAccess: (route: string) => boolean;
  refreshPermissions: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export const usePermissions = () => {
  const context = useContext(PermissionsContext);
  if (!context) {
    throw new Error('usePermissions must be used within PermissionsProvider');
  }
  return context;
};

interface PermissionsProviderProps {
  children: React.ReactNode;
}

export const PermissionsProvider = ({ children }: PermissionsProviderProps) => {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: roleData, isLoading: roleLoading } = useQuery({
    queryKey: ['user-role', user?.id],
    queryFn: async () => {
      if (!user?.id) return { role: 'user' as AppRole };
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) {
        console.error('Error fetching user role:', error);
        return { role: 'user' as AppRole };
      }
      return { role: (data?.role as AppRole) || 'user' };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: permissionsData, isLoading: permissionsLoading } = useQuery({
    queryKey: ['page-permissions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('page_permissions').select('*');
      if (error) {
        console.error('Error fetching page permissions:', error);
        return [];
      }
      return (data || []) as unknown as PagePermission[];
    },
    enabled: !!user,
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('page-permissions-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'page_permissions' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['page-permissions'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_roles', filter: `user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['user-role', user.id] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  const userRole: AppRole = (roleData?.role as AppRole) || 'user';
  const permissions = permissionsData || [];

  const refreshPermissions = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['user-role', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['page-permissions'] }),
    ]);
  }, [queryClient, user?.id]);

  const hasPageAccess = useCallback(
    (route: string): boolean => {
      const normalizedRoute = route === '/' ? '/dashboard' : route.replace(/\/$/, '');
      let permission = permissions.find((p) => p.route === normalizedRoute);
      if (!permission) {
        const candidates = permissions
          .filter((p) => normalizedRoute === p.route || normalizedRoute.startsWith(p.route + '/'))
          .sort((a, b) => b.route.length - a.route.length);
        permission = candidates[0];
      }
      // Fail-closed: unknown route → only super_admin gets through.
      // Previously this returned `true` for every route lacking a row in
      // page_permissions, which silently granted full access to new pages
      // before an admin had a chance to lock them down.
      if (!permission) return userRole === 'super_admin';

      switch (userRole) {
        case 'super_admin':
          return permission.super_admin_access !== false;
        case 'admin':
          return permission.admin_access;
        case 'sales_head':
          return permission.sales_head_access !== false;
        case 'user':
        default:
          return permission.user_access;
      }
    },
    [permissions, userRole]
  );

  const isSuperAdmin = userRole === 'super_admin';
  const isAdmin = userRole === 'admin';
  const isSalesHead = userRole === 'sales_head';
  const isAdminOrAbove = isAdmin || isSuperAdmin;

  const loading = authLoading || ((roleLoading || permissionsLoading) && !roleData);

  const value = useMemo(
    () => ({
      userRole,
      isSuperAdmin,
      isAdmin,
      isSalesHead,
      isAdminOrAbove,
      isManager: false,
      permissions,
      loading,
      hasPageAccess,
      refreshPermissions,
    }),
    [userRole, isSuperAdmin, isAdmin, isSalesHead, isAdminOrAbove, permissions, loading, hasPageAccess, refreshPermissions]
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
};
