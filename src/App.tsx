
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/contexts/PermissionsContext";
import SecurityEnhancedApp from "@/components/SecurityEnhancedApp";
import { AppSidebar } from "@/components/AppSidebar";
import { lazy, Suspense, useEffect, useState } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AppLoader } from "@/components/ui/loader";
import { ShieldAlert } from "lucide-react";

// Eager: most-common landing pages
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import CampaignDetail from "./pages/CampaignDetail";

// Lazy: everything else (huge code-split win)
const Accounts = lazy(() => import("./pages/Accounts"));
const Contacts = lazy(() => import("./pages/Contacts"));
const DealsPage = lazy(() => import("./pages/DealsPage"));

const Campaigns = lazy(() => import("./pages/Campaigns"));
const ActionItems = lazy(() => import("./pages/ActionItems"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Notifications = lazy(() => import("./pages/Notifications"));
const EmailSkipAuditLog = lazy(() => import("./pages/EmailSkipAuditLog"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <AppLoader variant="page" label="Loading workspace…" />
);

const RouteDiagnostics = () => {
  const location = useLocation();

  useEffect(() => {
    console.info("[route] location changed", {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location]);

  return null;
};

const AppCrashedFallback = ({ onRetry }: { onRetry: () => void }) => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The preview hit a runtime error on <span className="font-medium text-foreground">{location.pathname}</span>.
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={onRetry}>Retry preview</Button>
          <Button variant="outline" onClick={() => navigate("/auth", { replace: true })}>Go to sign in</Button>
        </div>
      </div>
    </div>
  );
};

const GlobalAppCrashedFallback = ({ onRetry }: { onRetry: () => void }) => {
  const handleReload = () => window.location.reload();
  const handleGoToAuth = () => window.location.assign("/auth");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The app hit a runtime error before the page could finish rendering.
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={onRetry}>Retry render</Button>
          <Button variant="outline" onClick={handleReload}>Reload app</Button>
          <Button variant="ghost" onClick={handleGoToAuth}>Go to sign in</Button>
        </div>
      </div>
    </div>
  );
};

// Layout Component for all pages with fixed sidebar
const FixedSidebarLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false); // Start collapsed
  const location = useLocation();
  
  // These routes need overflow-hidden so they can control their own scrolling
  const controlledScrollRoutes = ['/action-items', '/contacts', '/deals', '/settings', '/notifications', '/', '/accounts', '/campaigns'];
  const needsControlledScroll = controlledScrollRoutes.includes(location.pathname) || location.pathname.startsWith('/campaigns/');
  
  return (
    <div className="h-screen flex w-full overflow-hidden">
      <div className="fixed top-0 left-0 z-50 h-full">
        <AppSidebar isFixed={true} isOpen={sidebarOpen} onToggle={setSidebarOpen} />
      </div>
      <main 
        className="flex-1 bg-background h-screen overflow-hidden"
        style={{ 
          marginLeft: sidebarOpen ? '200px' : '64px',
          transition: 'margin-left 300ms ease-in-out',
          width: `calc(100vw - ${sidebarOpen ? '200px' : '64px'})`
        }}
      >
        <div className={`w-full h-full min-h-0 ${needsControlledScroll ? 'overflow-hidden' : 'overflow-auto'}`}>
          <Suspense fallback={<RouteFallback />}>
            <div key={location.pathname} className="animate-page-enter h-full w-full">
              {children}
            </div>
          </Suspense>
        </div>
      </main>
    </div>
  );
};

// Page Access Guard — checks role-based page permissions from page_permissions table
const PageAccessGuard = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { loading, hasPageAccess, isSuperAdmin } = usePermissions();

  if (loading) {
    return <RouteFallback />;
  }

  // Only super admins bypass page_permissions on /settings so they can re-enable
  // disabled pages. Regular admins go through the configurable check like
  // everyone else — the previous hardcoded `isAdmin` bypass made the Page
  // Access settings UI silently ineffective for the admin role.
  const route = location.pathname;
  const isSettings = route === '/settings' || route.startsWith('/settings/');
  if (isSettings && isSuperAdmin) {
    return <>{children}</>;
  }



  if (!hasPageAccess(route)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-foreground">Access Restricted</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your role doesn't have permission to view this page. Contact an administrator if you need access.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <AppLoader variant="page" label="Restoring your workspace…" />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <FixedSidebarLayout>
      <PageAccessGuard>{children}</PageAccessGuard>
    </FixedSidebarLayout>
  );
};

// Auth Route Component (redirects if already authenticated)
const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <AppLoader variant="page" label="Preparing sign in…" />;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const RoutedApp = () => {
  const location = useLocation();

  return (
    <AppErrorBoundary resetKeys={[location.pathname]} fallback={(reset) => <AppCrashedFallback onRetry={reset} />}>
      <RouteDiagnostics />
      <Routes>
        <Route path="/auth" element={<AuthRoute><Auth /></AuthRoute>} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/accounts" element={<ProtectedRoute><Accounts /></ProtectedRoute>} />
        <Route path="/contacts" element={<ProtectedRoute><Contacts /></ProtectedRoute>} />
        <Route path="/deals" element={<ProtectedRoute><DealsPage /></ProtectedRoute>} />
        
        <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
        <Route path="/campaigns/:id" element={<ProtectedRoute><CampaignDetail /></ProtectedRoute>} />
        <Route path="/action-items" element={<ProtectedRoute><ActionItems /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/settings/email-skip-audit" element={<ProtectedRoute><EmailSkipAuditLog /></ProtectedRoute>} />
        <Route path="*" element={<ProtectedRoute><NotFound /></ProtectedRoute>} />
      </Routes>
    </AppErrorBoundary>
  );
};

const AppRouter = () => (
  <BrowserRouter>
    <RoutedApp />
  </BrowserRouter>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AppErrorBoundary fallback={(reset) => <GlobalAppCrashedFallback onRetry={reset} />}>
      <SecurityEnhancedApp>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <AppRouter />
        </TooltipProvider>
      </SecurityEnhancedApp>
    </AppErrorBoundary>
  </QueryClientProvider>
);

export default App;
