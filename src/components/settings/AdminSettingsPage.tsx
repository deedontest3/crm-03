import { useState, lazy, Suspense, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Lock, History, Activity, BarChart3, Database, ShieldAlert as ShieldAlertIcon, MailWarning, Ban, DollarSign, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/hooks/useUserRole';
import { ShieldAlert } from "lucide-react";
import SettingsCard from './shared/SettingsCard';
import SettingsLoadingSkeleton from './shared/SettingsLoadingSkeleton';
import { AppLoader } from "@/components/ui/loader";

// Lazy load admin section components
const UserManagement = lazy(() => import('@/components/UserManagement'));
const PageAccessSettings = lazy(() => import('@/components/settings/PageAccessSettings'));
const AuditLogsSettings = lazy(() => import('@/components/settings/AuditLogsSettings'));
const BackupRestoreSettings = lazy(() => import('@/components/settings/BackupRestoreSettings'));
const CurrencyConverterCard = lazy(() => import('@/components/settings/CurrencyConverterCard'));
const SuppressionListSettings = lazy(() => import('@/components/settings/SuppressionListSettings'));
const SendCapSettings = lazy(() => import('@/components/settings/SendCapSettings'));
const DatabaseCleanupPanel = lazy(() => import('@/components/settings/cleanup/DatabaseCleanupPanel'));

const adminTabs = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'access', label: 'Access', icon: Lock },
  { id: 'logs', label: 'Logs', icon: History },
  { id: 'system', label: 'System', icon: Activity },
  { id: 'cleanup', label: 'Cleanup', icon: Sparkles },
  { id: 'currency', label: 'Currency', icon: DollarSign },
  { id: 'compliance', label: 'Compliance', icon: Ban },
  { id: 'reports', label: 'Reports', icon: BarChart3 }
];

interface AdminSettingsPageProps {
  defaultSection?: string | null;
}

const AdminSettingsPage = ({ defaultSection }: AdminSettingsPageProps) => {
  const { isSuperAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();

  const getTabFromSection = (section: string | null) => {
    if (!section) return 'users';
    const sectionToTab: Record<string, string> = {
      'users': 'users',
      'page-access': 'access',
      'audit-logs': 'logs',
      'backup': 'system',
      'system-status': 'system',
      'currency': 'currency',
      'cleanup': 'cleanup',
      'suppression': 'compliance',
      'send-caps': 'compliance',
      'compliance': 'compliance',
    };
    return sectionToTab[section] || 'users';
  };

  const [activeTab, setActiveTab] = useState(() => getTabFromSection(defaultSection));

  useEffect(() => {
    if (defaultSection) {
      setActiveTab(getTabFromSection(defaultSection));
    }
  }, [defaultSection]);

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <AppLoader variant="inline" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Card>
        <CardContent className="py-16">
          <div className="flex flex-col items-center justify-center text-center">
            <ShieldAlert className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold">Access Denied</h3>
            <p className="text-muted-foreground mt-2 max-w-md">
              Only <strong>Super Admins</strong> can access administration settings.
              Contact your system administrator if you need access.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="sticky top-0 z-10 bg-background pb-2 border-b border-border">
          <TabsList className="grid w-full grid-cols-8 max-w-4xl">
            {adminTabs.map(tab => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="sr-only sm:not-sr-only">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="users" className="mt-6 space-y-6">
          <Suspense fallback={<SettingsLoadingSkeleton />}>
            <UserManagement />
          </Suspense>
        </TabsContent>

        <TabsContent value="access" className="mt-6 space-y-6">
          <SettingsCard icon={Lock} title="Page Access Control" description="Configure which roles can access each page">
            <Suspense fallback={<SettingsLoadingSkeleton />}>
              <PageAccessSettings />
            </Suspense>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="logs" className="mt-6 space-y-6">
          <SettingsCard
            icon={MailWarning}
            title="Email Reply Skip Audit"
            description="Every inbound reply rejected by the cross-thread safety guards, with the reason it was blocked."
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Inspect skipped replies, deep-link from a manual re-sync, and download a PDF report.
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate('/settings/email-skip-audit')}>
                Open audit log
              </Button>
            </div>
          </SettingsCard>
          <Suspense fallback={<SettingsLoadingSkeleton />}>
            <AuditLogsSettings />
          </Suspense>
        </TabsContent>

        <TabsContent value="system" className="mt-6 space-y-4">
          <SettingsCard icon={Database} title="Data Backup & Restore" description="Export data, manage backups, and restore from previous snapshots">
            <Suspense fallback={<SettingsLoadingSkeleton />}>
              <BackupRestoreSettings />
            </Suspense>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="cleanup" className="mt-6 space-y-4">
          <Suspense fallback={<SettingsLoadingSkeleton />}>
            <DatabaseCleanupPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="currency" className="mt-6 space-y-4">
          <Suspense fallback={<SettingsLoadingSkeleton />}>
            <CurrencyConverterCard />
          </Suspense>
        </TabsContent>

        <TabsContent value="compliance" className="mt-6 space-y-6">
          <Suspense fallback={<SettingsLoadingSkeleton />}>
            <SuppressionListSettings />
          </Suspense>
          <Suspense fallback={<SettingsLoadingSkeleton />}>
            <SendCapSettings />
          </Suspense>
        </TabsContent>

        <TabsContent value="reports" className="mt-6 space-y-6">
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Scheduled reports coming soon</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminSettingsPage;
