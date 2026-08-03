import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Key, Check, X, Eye, EyeOff } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { useSecurityAudit } from '@/hooks/useSecurityAudit';
import { toast } from 'sonner';
import { AppLoader } from "@/components/ui/loader";

interface PasswordChangeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
}

interface PasswordRequirement {
  label: string;
  met: boolean;
}

const PasswordChangeModal = ({ open, onOpenChange, userId }: PasswordChangeModalProps) => {
  const { logSecurityEvent } = useSecurityAudit();
  const [isChanging, setIsChanging] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    newPassword: '',
    confirmPassword: ''
  });

  const passwordRequirements: PasswordRequirement[] = useMemo(() => [
    { label: 'At least 8 characters', met: passwordData.newPassword.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(passwordData.newPassword) },
    { label: 'One lowercase letter', met: /[a-z]/.test(passwordData.newPassword) },
    { label: 'One number', met: /\d/.test(passwordData.newPassword) },
    { label: 'One special character', met: /[!@#$%^&*(),.?":{}|<>]/.test(passwordData.newPassword) }
  ], [passwordData.newPassword]);

  const allRequirementsMet = passwordRequirements.every(req => req.met);
  const passwordsMatch = passwordData.newPassword === passwordData.confirmPassword && passwordData.confirmPassword.length > 0;
  const passwordStrength = (passwordRequirements.filter(req => req.met).length / passwordRequirements.length) * 100;

  const handleClose = () => {
    onOpenChange(false);
    setPasswordData({ newPassword: '', confirmPassword: '' });
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allRequirementsMet || !passwordsMatch) return;

    setIsChanging(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword
      });
      if (error) throw error;

      await logSecurityEvent('PASSWORD_CHANGE', 'auth', userId, {
        changed_at: new Date().toISOString()
      });

      handleClose();
      toast.success('Password changed successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update password');
    } finally {
      setIsChanging(false);
    }
  };

  const getStrengthLabel = () => {
    if (passwordStrength < 40) return { label: 'Weak', className: 'text-destructive' };
    if (passwordStrength < 80) return { label: 'Medium', className: 'text-yellow-600' };
    return { label: 'Strong', className: 'text-green-600' };
  };

  const strength = getStrengthLabel();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />Change Password
          </DialogTitle>
          <DialogDescription>Create a strong password that meets all requirements</DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="newPassword" className="text-xs">New Password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={passwordData.newPassword}
                onChange={e => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                placeholder="Enter new password"
                className="h-9 pr-10"
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-9 w-9 px-2"
                onClick={() => setShowNewPassword(!showNewPassword)}
                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            
            {passwordData.newPassword.length > 0 && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Strength</span>
                  <span className={`font-medium ${strength.className}`}>{strength.label}</span>
                </div>
                <Progress value={passwordStrength} className="h-1.5" />
              </div>
            )}
          </div>
          
          {passwordData.newPassword.length > 0 && (
            <div className="space-y-1.5 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs font-medium text-muted-foreground mb-2">Requirements:</p>
              <div className="grid grid-cols-2 gap-1">
                {passwordRequirements.map((req, index) => (
                  <div key={index} className="flex items-center gap-1.5 text-xs">
                    {req.met ? <Check className="h-3 w-3 text-green-500" /> : <X className="h-3 w-3 text-muted-foreground" />}
                    <span className={req.met ? 'text-foreground' : 'text-muted-foreground'}>{req.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword" className="text-xs">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={passwordData.confirmPassword}
                onChange={e => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                placeholder="Confirm new password"
                className="h-9 pr-10"
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-9 w-9 px-2"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {passwordData.confirmPassword.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs mt-1">
                {passwordsMatch ? (
                  <><Check className="h-3 w-3 text-green-500" /><span className="text-green-600">Passwords match</span></>
                ) : (
                  <><X className="h-3 w-3 text-destructive" /><span className="text-destructive">Passwords do not match</span></>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isChanging || !allRequirementsMet || !passwordsMatch}>
              {isChanging ? <><AppLoader variant="inline" className="mr-2" />Updating...</> : "Update Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default PasswordChangeModal;
