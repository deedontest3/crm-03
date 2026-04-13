import { useState, useEffect, lazy, Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, History, BarChart3 } from 'lucide-react';
import SettingsLoadingSkeleton from './shared/SettingsLoadingSkeleton';

const EmailTemplatesSettings = lazy(() => import('@/components/settings/EmailTemplatesSettings'));
const EmailHistorySettings = lazy(() => import('@/components/settings/EmailHistorySettings'));
const EmailAnalyticsDashboard = lazy(() => import('@/components/settings/EmailAnalyticsDashboard'));

interface EmailCenterPageProps {
  defaultTab?: string | null;
}

const validTabs = ['templates', 'history', 'analytics'];

const EmailCenterPage = ({ defaultTab }: EmailCenterPageProps) => {
  const [activeTab, setActiveTab] = useState(() => {
    if (defaultTab && validTabs.includes(defaultTab)) {
      return defaultTab;
    }
    return 'templates';
  });

  useEffect(() => {
    if (defaultTab && validTabs.includes(defaultTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  return (
    <div className="space-y-6 w-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="sticky top-0 z-10 bg-background pb-2 border-b border-border">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="templates" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Templates</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">History</span>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Analytics</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="templates" className="mt-6">
          <Suspense fallback={<SettingsLoadingSkeleton />}>
            <EmailTemplatesSettings />
          </Suspense>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Suspense fallback={<SettingsLoadingSkeleton />}>
            <EmailHistorySettings />
          </Suspense>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <Suspense fallback={<SettingsLoadingSkeleton rows={3} />}>
            <EmailAnalyticsDashboard />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EmailCenterPage;
