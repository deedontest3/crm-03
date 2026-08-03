
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useSecurityAudit } from "@/hooks/useSecurityAudit";
import { useUserRole } from "@/hooks/useUserRole";

interface UserModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Roles the client may request. `super_admin` is intentionally omitted from
// the default option list — only an existing super admin may grant it, and
// even then it's a deliberate second choice in the dropdown. The server-side
// `user-admin` function is the authoritative gate; this list only shapes what
// the UI offers so a normal admin can't accidentally (or trivially) promote
// somebody past their own privilege level.
type GrantableRole = 'user' | 'sales_head' | 'admin' | 'super_admin';

const ROLE_LABELS: Record<GrantableRole, string> = {
  user: 'User',
  sales_head: 'Sales Head',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

const UserModal = ({ open, onClose, onSuccess }: UserModalProps) => {
  const { isSuperAdmin, isAdminOrAbove } = useUserRole();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<GrantableRole>('user');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { logSecurityEvent } = useSecurityAudit();

  // Roles the current caller is allowed to grant. Super admins may grant any
  // role including super_admin; regular admins are limited to non-elevated
  // roles; anyone else gets nothing (the modal shouldn't be reachable but we
  // fail closed just in case).
  const grantableRoles = useMemo<GrantableRole[]>(() => {
    if (isSuperAdmin) return ['user', 'sales_head', 'admin', 'super_admin'];
    if (isAdminOrAbove) return ['user', 'sales_head'];
    return [];
  }, [isSuperAdmin, isAdminOrAbove]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      toast({ title: "Error", description: "Password is required", variant: "destructive" });
      return;
    }

    if (password.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters long", variant: "destructive" });
      return;
    }

    // Client-side guard so a tampered <Select> value can't bypass the
    // grantable-roles list. The server-side `user-admin` function remains
    // the real gate.
    if (!grantableRoles.includes(role)) {
      toast({
        title: "Not allowed",
        description: "You don't have permission to grant that role.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.functions.invoke('user-admin', {
        method: 'POST',
        body: { email, displayName, role, password },
      });

      if (error) throw error;

      logSecurityEvent('USER_CREATED', 'users', undefined, {
        email,
        role,
        display_name: displayName,
      });

      toast({ title: "Success", description: "User created successfully" });

      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error creating user:', error);
      toast({ title: "Error", description: "Failed to create user", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setDisplayName('');
    setPassword('');
    setRole('user');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Full Name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password (min 6 characters)"
              required
              minLength={6}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as GrantableRole)}
              disabled={grantableRoles.length === 0}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {grantableRoles.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {grantableRoles.length === 0 && (
              <p className="text-xs text-destructive">
                You don't have permission to create users.
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || grantableRoles.length === 0}>
              {loading ? 'Creating...' : 'Create User'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default UserModal;
