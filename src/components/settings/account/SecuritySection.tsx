import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Key, Monitor, Smartphone, Clock, LogOut, RefreshCw, Shield } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import PasswordChangeModal from '../PasswordChangeModal';
import { TerminateSessionDialog, TerminateAllSessionsDialog } from '../SessionDialogs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { AppLoader } from "@/components/ui/loader";

interface Session {
  id: string;
  session_token: string;
  user_agent: string | null;
  device_info: { browser?: string; os?: string } | null;
  last_active_at: string;
  created_at?: string;
  is_current?: boolean;
}

interface SecuritySectionProps {
  userId: string;
}

// Get browser session ID (same logic as useAuth)
const getBrowserSessionId = (): string => {
  const storageKey = 'browser_session_id';
  try {
    return localStorage.getItem(storageKey) || '';
  } catch {
    return '';
  }
};

const SecuritySection = ({ userId }: SecuritySectionProps) => {
  const { signOut } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentBrowserSessionId, setCurrentBrowserSessionId] = useState<string>('');
  
  // Dialog states
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);
  const [showTerminateAllDialog, setShowTerminateAllDialog] = useState(false);
  const [showSignOutCurrentDialog, setShowSignOutCurrentDialog] = useState(false);
  const [sessionToTerminate, setSessionToTerminate] = useState<string | null>(null);

  const fetchSessions = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const browserSessionId = getBrowserSessionId();
      setCurrentBrowserSessionId(browserSessionId);

      const { data, error } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('last_active_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('last_active_at', { ascending: false });

      if (error) throw error;

      setSessions((data || []).map(s => ({
        id: s.id,
        session_token: s.session_token,
        user_agent: s.user_agent,
        device_info: s.device_info as { browser?: string; os?: string } | null,
        last_active_at: s.last_active_at,
        created_at: s.created_at,
        is_current: s.session_token === browserSessionId
      })));
    } catch (error) {
      console.error('Error fetching sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [userId]);

  const handleTerminateClick = (sessionId: string) => {
    setSessionToTerminate(sessionId);
    setShowTerminateDialog(true);
  };

  const confirmTerminateSession = async () => {
    if (!sessionToTerminate) return;
    try {
      await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('id', sessionToTerminate);
      toast.success('Session terminated');
      fetchSessions();
    } catch (error) {
      toast.error('Failed to terminate session');
    } finally {
      setShowTerminateDialog(false);
      setSessionToTerminate(null);
    }
  };

  const confirmTerminateAllOthers = async () => {
    try {
      // Actually revoke the refresh tokens for this user's other devices, not
      // just flip the bookkeeping flag. Without this, a lost/stolen device's
      // session keeps working until it naturally expires.
      const { error: revokeError } = await supabase.auth.signOut({ scope: 'others' });
      if (revokeError) throw revokeError;

      await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('user_id', userId)
        .neq('session_token', currentBrowserSessionId);
      toast.success('All other sessions signed out');
      fetchSessions();
    } catch (error) {
      toast.error('Failed to terminate sessions');
    } finally {
      setShowTerminateAllDialog(false);
    }
  };

  const handleSignOutCurrent = async () => {
    setShowSignOutCurrentDialog(false);
    await signOut();
  };

  const parseUserAgent = (ua: string | null) => {
    if (!ua) return { browser: 'Unknown', os: 'Unknown' };
    let browser = 'Unknown', os = 'Unknown';
    if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg')) browser = 'Edge';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    return { browser, os };
  };

  const getDeviceIcon = (ua: string | null) => {
    if (ua?.toLowerCase().includes('mobile') || ua?.toLowerCase().includes('android') || ua?.toLowerCase().includes('iphone')) {
      return <Smartphone className="h-4 w-4" />;
    }
    return <Monitor className="h-4 w-4" />;
  };

  const otherSessionsCount = sessions.filter(s => !s.is_current).length;
  const currentSession = sessions.find(s => s.is_current);

  return (
    <>
      <div className="space-y-4">
        {/* Password */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" />
              Password
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Change your password to keep your account secure</p>
              <Button variant="outline" size="sm" onClick={() => setShowPasswordModal(true)}>
                Change Password
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Active Sessions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Active Sessions</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sessions.length} device{sessions.length !== 1 ? 's' : ''} logged in
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" onClick={fetchSessions} disabled={loading} className="h-8 w-8">
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                {otherSessionsCount > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowTerminateAllDialog(true)} 
                    className="h-8 text-xs"
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1" />
                    Sign Out Others
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-6">
                <AppLoader variant="inline" />
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">
                No active sessions. Sessions will appear when you log in.
              </p>
            ) : (
              <div className="space-y-2">
                {/* Current Session - Highlighted */}
                {currentSession && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border-2 border-primary/20">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Shield className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {(currentSession.device_info || parseUserAgent(currentSession.user_agent)).browser} · {(currentSession.device_info || parseUserAgent(currentSession.user_agent)).os}
                          </span>
                          <Badge variant="default" className="text-xs h-5 bg-primary">
                            This Device
                          </Badge>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Active now
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => setShowSignOutCurrentDialog(true)}
                    >
                      <LogOut className="h-3.5 w-3.5 mr-1" />
                      Sign Out
                    </Button>
                  </div>
                )}

                {/* Other Sessions */}
                {sessions.filter(s => !s.is_current).map((session) => {
                  const { browser, os } = session.device_info || parseUserAgent(session.user_agent);
                  return (
                    <div key={session.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-background rounded-lg">
                          {getDeviceIcon(session.user_agent)}
                        </div>
                        <div>
                          <span className="text-sm font-medium">{browser} · {os}</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(new Date(session.last_active_at), 'MMM d, h:mm a')}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleTerminateClick(session.id)}
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <PasswordChangeModal open={showPasswordModal} onOpenChange={setShowPasswordModal} />
      
      {/* Terminate Single Session Dialog */}
      <TerminateSessionDialog
        open={showTerminateDialog}
        onOpenChange={setShowTerminateDialog}
        onConfirm={confirmTerminateSession}
      />

      {/* Terminate All Other Sessions Dialog */}
      <TerminateAllSessionsDialog
        open={showTerminateAllDialog}
        onOpenChange={setShowTerminateAllDialog}
        onConfirm={confirmTerminateAllOthers}
      />

      {/* Sign Out Current Session Dialog */}
      <AlertDialog open={showSignOutCurrentDialog} onOpenChange={setShowSignOutCurrentDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign Out of This Device?</AlertDialogTitle>
            <AlertDialogDescription>
              You will be logged out and redirected to the login page. You'll need to sign in again to access your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSignOutCurrent} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SecuritySection;
