
import { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { MoreHorizontal, Plus, RefreshCw, Shield, ShieldAlert, User, Key } from "lucide-react";
import { format } from "date-fns";
import UserModal from "./UserModal";
import EditUserModal from "./EditUserModal";
import ChangeRoleModal from "./ChangeRoleModal";
import DeleteUserDialog from "./DeleteUserDialog";
import SetPasswordModal from "./SetPasswordModal";
import { useSecurityAudit } from "@/hooks/useSecurityAudit";

interface UserData {
  id: string;
  email: string;
  user_metadata: {
    full_name?: string;
  };
  created_at: string;
  last_sign_in_at: string | null;
  banned_until?: string | null;
  role?: string;
}

const UserManagement = () => {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSetPasswordModal, setShowSetPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const { toast } = useToast();
  const { refreshUser } = useAuth();
  const { isAdmin, loading: roleLoading, userRole } = useUserRole();
  const { logSecurityEvent } = useSecurityAudit();

  console.log('UserManagement - Current user role:', userRole, 'isAdmin:', isAdmin, 'loading:', roleLoading);

  const fetchUsers = useCallback(async () => {
    try {
      console.log('Fetching users with role validation...');
      
      const { data, error } = await supabase.functions.invoke('user-admin', {
        method: 'GET'
      });
      
      console.log('Function response:', { data, error });
      
      if (error) {
        console.error('Error fetching users:', error);
        throw error;
      }
      
      // Fetch roles for all users
      const userIds = data.users?.map((user: any) => user.id) || [];
      
      let userRoles: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: rolesData } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in('user_id', userIds);
        
        if (rolesData) {
          userRoles = rolesData.reduce((acc: Record<string, string>, item: any) => {
            acc[item.user_id] = item.role;
            return acc;
          }, {});
        }
      }
      
      // Combine user data with roles
      const usersWithRoles = data.users?.map((user: any) => ({
        ...user,
        role: userRoles[user.id] || 'user'
      })) || [];
      
      console.log('Users fetched successfully:', usersWithRoles.length);
      setUsers(usersWithRoles);
    } catch (error: any) {
      console.error('Error fetching users:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch users",
        variant: "destructive",
      });
    }
  }, [toast]);

  const syncAndRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      
      // Refresh session first
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        throw new Error("Failed to refresh session");
      }
      
      // Fetch latest users
      await fetchUsers();
      
      // Refresh current user data
      await refreshUser();
      
      toast({
        title: "Success",
        description: "User data synced successfully",
      });
    } catch (error: any) {
      toast({
        title: "Sync Error", 
        description: error.message || "Failed to sync data",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  }, [fetchUsers, refreshUser, toast]);

  const handleEditUser = useCallback((user: UserData) => {
    setSelectedUser(user);
    setShowEditModal(true);
  }, []);

  const handleChangeRole = useCallback((user: UserData) => {
    if (!isAdmin) {
      toast({
        title: "Access Denied",
        description: "Only Admins can change user roles.",
        variant: "destructive",
      });
      return;
    }
    setSelectedUser(user);
    setShowRoleModal(true);
  }, [isAdmin, toast]);

  const handleSetPassword = useCallback((user: UserData) => {
    if (!isAdmin) {
      toast({
        title: "Access Denied",
        description: "Only Admins can reset user passwords.",
        variant: "destructive",
      });
      return;
    }
    setSelectedUser(user);
    setShowSetPasswordModal(true);
  }, [isAdmin, toast]);

  const handleToggleUserStatus = useCallback(async (user: UserData) => {
    if (!isAdmin) {
      toast({
        title: "Access Denied",
        description: "Only Admins can activate/deactivate users.",
        variant: "destructive",
      });
      return;
    }

    try {
      const action = user.banned_until ? 'activate' : 'deactivate';
      
      toast({
        title: "Processing",
        description: `${action === 'activate' ? 'Activating' : 'Deactivating'} user...`,
      });

      const { data, error } = await supabase.functions.invoke('user-admin', {
        method: 'PUT',
        body: {
          userId: user.id,
          action: action
        }
      });

      if (error) throw error;

      logSecurityEvent(
        action === 'activate' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        'user_management',
        user.id,
        { email: user.email, full_name: user.user_metadata?.full_name }
      );

      toast({
        title: "Success",
        description: `User ${action}d successfully`,
      });
      
      await fetchUsers();
      await refreshUser();
    } catch (error: any) {
      console.error('Error updating user status:', error);
      if (error.message?.includes('Only Admins can')) {
        toast({
          title: "Access Denied",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to update user status",
          variant: "destructive",
        });
      }
    }
  }, [fetchUsers, refreshUser, toast, isAdmin]);

  const handleDeleteUser = useCallback((user: UserData) => {
    if (!isAdmin) {
      toast({
        title: "Access Denied",
        description: "Only Admins can delete users.",
        variant: "destructive",
      });
      return;
    }
    setSelectedUser(user);
    setShowDeleteDialog(true);
  }, [isAdmin, toast]);

  const handleUserSuccess = useCallback(async () => {
    await fetchUsers();
    await refreshUser();
  }, [fetchUsers, refreshUser]);

  const getRoleBadgeVariant = useCallback((role: string) => {
    switch (role?.toLowerCase()) {
      case 'admin':
        return 'default';
      default:
        return 'outline';
    }
  }, []);

  const getRoleIcon = useCallback((role: string) => {
    switch (role?.toLowerCase()) {
      case 'admin':
        return <Shield className="h-3 w-3" />;
      default:
        return <User className="h-3 w-3" />;
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      // Wait for role to be loaded
      if (roleLoading) return;
      
      console.log('UserManagement useEffect - isAdmin:', isAdmin, 'roleLoading:', roleLoading);
      
      setLoading(true);
      if (isAdmin) {
        await fetchUsers();
      }
      setLoading(false);
    };
    
    loadData();
  }, [fetchUsers, isAdmin, roleLoading]);

  // Show loading while checking user role
  if (roleLoading) {
    console.log('UserManagement - Role loading...');
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            User Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isAdmin) {
    console.log('UserManagement - Access denied, isAdmin:', isAdmin);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            User Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">Access Denied</h3>
            <p className="text-muted-foreground">Only administrators can access user management.</p>
            <p className="text-xs text-muted-foreground mt-2">Current role: {userRole}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                User Management
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Manage user accounts, roles, and permissions with role-based access control
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={syncAndRefresh}
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Syncing...' : 'Sync & Refresh'}
              </Button>
              <Button size="sm" onClick={() => setShowAddModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Display Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Sign In</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.user_metadata?.full_name || user.email.split('@')[0]}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={getRoleBadgeVariant(user.role || 'user')} className="flex items-center gap-1 w-fit">
                      {getRoleIcon(user.role || 'user')}
                      {user.role || 'user'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.banned_until ? 'destructive' : 'default'}>
                      {user.banned_until ? 'Deactivated' : 'Active'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {format(new Date(user.created_at), 'M/d/yyyy')}
                  </TableCell>
                  <TableCell>
                    {user.last_sign_in_at 
                      ? format(new Date(user.last_sign_in_at), 'M/d/yyyy')
                      : 'Never'
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEditUser(user)}>
                          Edit Display Name
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleChangeRole(user)}
                          disabled={!isAdmin}
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          Change Role {!isAdmin && '(Admin Only)'}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleSetPassword(user)}
                          disabled={!isAdmin}
                        >
                          <Key className="h-4 w-4 mr-2" />
                          Set Password {!isAdmin && '(Admin Only)'}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleToggleUserStatus(user)}
                          disabled={!isAdmin}
                        >
                          {user.banned_until ? 'Activate' : 'Deactivate'} {!isAdmin && '(Admin Only)'}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDeleteUser(user)}
                          className="text-destructive"
                          disabled={!isAdmin}
                        >
                          Delete User {!isAdmin && '(Admin Only)'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {users.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No users found</p>
            </div>
          )}
        </CardContent>
      </Card>

      <UserModal 
        open={showAddModal} 
        onClose={() => setShowAddModal(false)}
        onSuccess={handleUserSuccess}
      />
      
      <EditUserModal 
        open={showEditModal} 
        onClose={() => setShowEditModal(false)}
        user={selectedUser}
        onSuccess={handleUserSuccess}
      />
      
      <ChangeRoleModal 
        open={showRoleModal} 
        onClose={() => setShowRoleModal(false)}
        user={selectedUser}
        onSuccess={handleUserSuccess}
      />
      
      <DeleteUserDialog 
        open={showDeleteDialog} 
        onClose={() => setShowDeleteDialog(false)}
        user={selectedUser}
        onSuccess={handleUserSuccess}
      />
      
      <SetPasswordModal 
        open={showSetPasswordModal} 
        onClose={() => setShowSetPasswordModal(false)}
        user={selectedUser}
        onSuccess={handleUserSuccess}
      />
    </>
  );
};

export default UserManagement;
