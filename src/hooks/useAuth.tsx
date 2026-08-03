
import { useState, useEffect, createContext, useContext } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

// Enhanced cleanup for Safari compatibility
const cleanupAuthState = () => {
  try {
    // Safari-safe localStorage cleanup
    if (typeof Storage !== 'undefined' && typeof localStorage !== 'undefined') {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('supabase.auth.') || key.includes('sb-')) {
          try {
            localStorage.removeItem(key);
          } catch (e) {
            console.warn('Failed to remove localStorage key:', key, e);
          }
        }
      });
    }
    
    // Safari-safe sessionStorage cleanup
    if (typeof Storage !== 'undefined' && typeof sessionStorage !== 'undefined') {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith('supabase.auth.') || key.includes('sb-')) {
          try {
            sessionStorage.removeItem(key);
          } catch (e) {
            console.warn('Failed to remove sessionStorage key:', key, e);
          }
        }
      });
    }
  } catch (error) {
    console.warn('Error during auth state cleanup:', error);
  }
};

// ---- Session tracking helpers ----
const BROWSER_SESSION_KEY = 'browser_session_id';

const getOrCreateBrowserSessionId = (): string => {
  try {
    let id = localStorage.getItem(BROWSER_SESSION_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(BROWSER_SESSION_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
};

const parseUA = (ua: string) => {
  let browser = 'Unknown', os = 'Unknown';
  if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';
  return { browser, os };
};

const registerSession = async (userId: string) => {
  try {
    const token = getOrCreateBrowserSessionId();
    if (!token) return;
    const ua = navigator.userAgent;
    await supabase.from('user_sessions').upsert(
      {
        user_id: userId,
        session_token: token,
        user_agent: ua,
        device_info: parseUA(ua),
        is_active: true,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,session_token' }
    );
  } catch (e) {
    console.warn('[auth] registerSession failed', e);
  }
};

const touchSession = async (userId: string) => {
  try {
    const token = localStorage.getItem(BROWSER_SESSION_KEY);
    if (!token) return;
    await supabase
      .from('user_sessions')
      .update({ last_active_at: new Date().toISOString(), is_active: true })
      .eq('user_id', userId)
      .eq('session_token', token);
  } catch {
    /* noop */
  }
};

const deactivateCurrentSession = async (userId: string) => {
  try {
    const token = localStorage.getItem(BROWSER_SESSION_KEY);
    if (!token) return;
    await supabase
      .from('user_sessions')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('session_token', token);
  } catch {
    /* noop */
  }
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      
      // Force a fresh session to get updated user metadata
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      
      setUser(user);
      setSession(session);
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  };

  useEffect(() => {
    let mounted = true;
    let sessionFetched = false;

    // Set up auth state listener first
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        console.info("[auth] state change", {
          event,
          hasSession: !!session,
          path: window.location.pathname,
        });

        // Safari-compatible session handling
        if (session) {
          setSession(session);
          setUser(session.user);
        } else {
          setSession(null);
          setUser(null);
        }

        // Track this browser as an active session
        if (session?.user?.id) {
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            setTimeout(() => registerSession(session.user.id), 0);
          } else if (event === 'TOKEN_REFRESHED') {
            setTimeout(() => touchSession(session.user.id), 0);
          }
        }

        if (event === 'SIGNED_OUT') {
          cleanupAuthState();
        }

        setLoading(false);
        sessionFetched = true;
      }
    );

    // Get initial session immediately (no artificial delay)
    const getInitialSession = async () => {
      if (!mounted || sessionFetched) return;
      
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        if (error) {
          console.error('Error getting session:', error);
          cleanupAuthState();
          setSession(null);
          setUser(null);
        } else if (session && !sessionFetched) {
          setSession(session);
          setUser(session.user);
          setTimeout(() => registerSession(session.user.id), 0);
        } else if (!session) {
          setSession(null);
          setUser(null);
        }
      } catch (error) {
        if (!mounted) return;
        console.error('Session retrieval failed:', error);
        cleanupAuthState();
        setSession(null);
        setUser(null);
      } finally {
        if (mounted && !sessionFetched) {
          setLoading(false);
        }
      }
    };

    getInitialSession();

    // Safety net: never let the auth gate hang forever. If neither the
    // listener nor getSession() resolves within 5s (slow network, broken
    // Supabase response, etc.), force loading=false so the app shell can
    // render and route the user to /auth instead of an infinite spinner.
    const safetyTimer = setTimeout(() => {
      if (mounted && !sessionFetched) {
        console.warn('[auth] session restore timed out after 5s — releasing loading state');
        setLoading(false);
      }
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []); // Empty dependency array to prevent re-running

  // Heartbeat: keep current session row fresh while signed in
  useEffect(() => {
    if (!user?.id) return;
    const ping = () => touchSession(user.id);
    const interval = window.setInterval(ping, 2 * 60 * 1000); // every 2 min
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.id]);

  const signOut = async () => {
    try {
      if (user?.id) {
        await deactivateCurrentSession(user.id);
      }
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        console.warn('Sign out error:', error);
      }
      try { localStorage.removeItem(BROWSER_SESSION_KEY); } catch { /* noop */ }
      cleanupAuthState();
      setSession(null);
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
      cleanupAuthState();
      setSession(null);
      setUser(null);
    }
  };

  const value = {
    user,
    session,
    loading,
    signOut,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
