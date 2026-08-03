
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Shield, ShieldCheck, User, Briefcase } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useSecurityAudit } from "@/hooks/useSecurityAudit";

interface UserData {
  id: string;
  email: string;
  user_metadata: { full_name?: string };
  role?: string;
}

interface ChangeRoleModalProps {
  open: boolean;
  onClose: () => void;
  user: UserData | null;
  onSuccess: () => void;
}

const ROLE_META: Record<string, { label: string; icon: typeof User; blurb: string[] }> = {
  super_admin: {
    label: 'Super Admin',
    icon: ShieldCheck,
    blurb: [
      'Full access to every page in the app',
      'Only role that can open Administration',
      'Manages users, roles and page permissions',
      'Can view and purge audit logs',
    ],
  },
  admin: {
    label: 'Admin',
    icon: Shield,
    blurb: [
      'Full read/write across all CRM modules',
      'Can manage records and run campaigns',
      'Cannot access Administration or change roles',
    ],
  },
  sales_head: {
    label: 'Sales Head',
    icon: Briefcase,
    blurb: [
      'Manages Dashboard, Accounts, Contacts, Deals, Campaigns, Tasks',
      'Edits all sales records',
      'Cannot access Administration',
    ],
  },
  user: {
    label: 'User',
    icon: User,
    blurb: [
      'Views all records',
      'Adds new content',
      'Edits only their own records',
      'No access to user management',
    ],
  },
};

const ChangeRoleModal = ({ open, onClose, user, onSuccess }: ChangeRoleModalProps) => {
  const [selectedRole, setSelectedRole] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { isSuperAdmin } = useUserRole();
  const { logSecurityEvent } = useSecurityAudit();

  useEffect(() => {
    if (user) setSelectedRole(user.role || 'user');
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedRole) return;

    if (!isSuperAdmin) {
      toast({
        title: "Access Denied",
        description: "Only Super Admins can change user roles.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('user-admin', {
        method: 'POST',
        body: { action: 'change-role', userId: user.id, newRole: selectedRole },
      });
      if (error) throw error;
      if (data?.success) {
        logSecurityEvent('ROLE_CHANGE', 'user_roles', user.id, {
          email: user.email,
          old_role: user.role || 'user',
          new_role: selectedRole,
        });
        toast({ title: "Success", description: `User role updated to ${ROLE_META[selectedRole]?.label || selectedRole}` });
        onSuccess();
        onClose();
      } else {
        throw new Error(data?.error || "Failed to update user role");
      }
    } catch (error: any) {
      console.error('Error updating role:', error);
      toast({
        title: error.message?.includes('Super Admin') ? "Access Denied" : "Error",
        description: error.message || "Failed to update user role",
        variant: "destructive",
      });
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
  const meta = ROLE_META[selectedRole] || ROLE_META.user;
  const Icon = meta.icon;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Change User Role</DialogTitle>
        </DialogHeader>

        {!isSuperAdmin && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 mb-4">
            <p className="text-sm text-destructive">
              ⚠️ Only Super Admins can change user roles.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>User</Label>
            <div className="p-3 bg-muted rounded-md">
              <p className="font-medium">{user.user_metadata?.full_name || user.email}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select value={selectedRole} onValueChange={setSelectedRole} disabled={loading || !isSuperAdmin}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">
                  <div className="flex items-center gap-2"><User className="h-4 w-4" /> User</div>
                </SelectItem>
                <SelectItem value="sales_head">
                  <div className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Sales Head</div>
                </SelectItem>
                <SelectItem value="admin">
                  <div className="flex items-center gap-2"><Shield className="h-4 w-4" /> Admin</div>
                </SelectItem>
                <SelectItem value="super_admin">
                  <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Super Admin</div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted p-3 rounded-md">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Icon className="h-4 w-4" /> {meta.label} Permissions
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {meta.blurb.map((b) => <li key={b}>• {b}</li>)}
            </ul>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || !selectedRole || !isSuperAdmin}>
              {loading ? 'Updating...' : 'Update Role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangeRoleModal;
