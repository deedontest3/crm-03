import { usePermissions } from '@/contexts/PermissionsContext';

/**
 * Thin wrapper over usePermissions for legacy call sites.
 * NOTE: `isAdmin` is now strict (admin role only). For "admin or super admin"
 * checks use `isAdminOrAbove`. Administration UI should use `isSuperAdmin`.
 */
export const useUserRole = () => {
  const {
    userRole,
    isSuperAdmin,
    isAdmin,
    isSalesHead,
    isAdminOrAbove,
    loading,
    refreshPermissions,
  } = usePermissions();

  const canEdit = isAdminOrAbove || isSalesHead;
  const canDelete = isAdminOrAbove;
  // User & role management belongs to Super Admin only.
  const canManageUsers = isSuperAdmin;
  const canAccessSettings = isSuperAdmin;

  return {
    userRole,
    isSuperAdmin,
    isAdmin,
    isSalesHead,
    isAdminOrAbove,
    isManager: false,
    canEdit,
    canDelete,
    canManageUsers,
    canAccessSettings,
    loading,
    refreshRole: refreshPermissions,
  };
};
