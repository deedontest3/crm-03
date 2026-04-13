
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Shield, User } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useSecurityAudit } from "@/hooks/useSecurityAudit";

interface User {
  id: string;
  email: string;
  user_metadata: {
    full_name?: string;
  };
  role?: string;
}

interface ChangeRoleModalProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  onSuccess: () => void;
}

const ChangeRoleModal = ({ open, onClose, user, onSuccess }: ChangeRoleModalProps) => {
  const [selectedRole, setSelectedRole] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { isAdmin } = useUserRole();
  const { logSecurityEvent } = useSecurityAudit();

  useEffect(() => {
    if (user) {
      setSelectedRole(user.role || 'user');
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedRole) return;

    // Check if current user is admin
    if (!isAdmin) {
      toast({
        title: "Access Denied",
        description: "Only Admins can change user roles.",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);

    try {
      toast({
        title: "Updating Role",
        description: "Changing user role...",
      });

      const { data, error } = await supabase.functions.invoke('user-admin', {
        method: 'POST',
        body: {
          action: 'change-role',
          userId: user.id,
          newRole: selectedRole
        }
      });

      if (error) throw error;

      if (data?.success) {
        logSecurityEvent('ROLE_CHANGE', 'user_roles', user.id, {
          email: user.email,
          old_role: user.role || 'user',
          new_role: selectedRole
        });
        
        toast({
          title: "Success",
          description: `User role updated to ${selectedRole}`,
        });
        
        onSuccess();
        onClose();
      } else {
        throw new Error(data?.error || "Failed to update user role");
      }
    } catch (error: any) {
      console.error('Error updating role:', error);
      
      // Handle specific admin restriction error
      if (error.message?.includes('Only Admins can change user roles')) {
        toast({
          title: "Access Denied",
          description: "Only Admins can change user roles.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to update user role",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
      setSelectedRole('');
    }
  };

  if (!user) return null;

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <Shield className="h-4 w-4" />;
      case 'user':
        return <User className="h-4 w-4" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Change User Role</DialogTitle>
        </DialogHeader>
        
        {!isAdmin && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 mb-4">
            <p className="text-sm text-destructive">
              ⚠️ Only Admins can change user roles. You don't have permission to perform this action.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user">User</Label>
            <div className="p-3 bg-muted rounded-md">
              <p className="font-medium">{user.user_metadata?.full_name || user.email}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select 
              value={selectedRole} 
              onValueChange={setSelectedRole} 
              disabled={loading || !isAdmin}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    User
                  </div>
                </SelectItem>
                <SelectItem value="admin">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Admin
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted p-3 rounded-md">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              {getRoleIcon(selectedRole)}
              {selectedRole === 'admin' ? 'Admin' : 'User'} Permissions
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {selectedRole === 'admin' ? (
                <>
                  <li>• Full access to all modules</li>
                  <li>• Can manage users and settings</li>
                  <li>• Can update and delete all records</li>
                  <li>• Access to audit logs</li>
                </>
              ) : (
                <>
                  <li>• Can view all records</li>
                  <li>• Can add new content</li>
                  <li>• Can only edit their own records</li>
                  <li>• No access to user management</li>
                </>
              )}
            </ul>
          </div>
          
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading || !selectedRole || !isAdmin}
            >
              {loading ? 'Updating...' : 'Update Role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangeRoleModal;
