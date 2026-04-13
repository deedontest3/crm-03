
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Eye, EyeOff } from "lucide-react";
import { useSecurityAudit } from "@/hooks/useSecurityAudit";

interface User {
  id: string;
  email: string;
  user_metadata: {
    full_name?: string;
  };
}

interface SetPasswordModalProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  onSuccess: () => void;
}

const SetPasswordModal = ({ open, onClose, user, onSuccess }: SetPasswordModalProps) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { logSecurityEvent } = useSecurityAudit();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);

    try {
      console.log('Setting new password for user:', user.id);
      
      toast({
        title: "Setting Password",
        description: "Please wait while we update the password...",
      });

      const { data, error } = await supabase.functions.invoke('user-admin', {
        method: 'POST',
        body: { 
          action: 'reset-password',
          userId: user.id,
          newPassword: newPassword
        }
      });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || "Failed to set new password");
      }

      if (data?.success) {
        console.log('Password set successfully:', data);
        
        logSecurityEvent('PASSWORD_RESET', 'users', user.id, {
          email: user.email,
          admin_initiated: true
        });
        
        toast({
          title: "Password Updated",
          description: `Password has been successfully updated for ${user.user_metadata?.full_name || user.email}`,
        });
        
        onSuccess();
        onClose();
        setNewPassword('');
        setConfirmPassword('');
      } else {
        throw new Error(data?.error || "Failed to set new password");
      }
      
    } catch (error: any) {
      console.error('Error setting password:', error);
      
      let errorMessage = "An unexpected error occurred while setting the password.";
      
      if (error.message?.includes("Failed to fetch")) {
        errorMessage = "Network error occurred. Please check your connection and try again.";
      } else if (error.message?.includes("Authentication")) {
        errorMessage = "Authentication error. Please refresh the page and try again.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Password Update Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Set New Password</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">User</Label>
            <Input
              id="email"
              value={`${user.user_metadata?.full_name || user.email} (${user.email})`}
              disabled
              className="bg-muted"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 6 characters)"
                required
                disabled={loading}
                minLength={6}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
              disabled={loading}
              minLength={6}
            />
          </div>
          
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Setting Password...' : 'Set Password'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SetPasswordModal;
