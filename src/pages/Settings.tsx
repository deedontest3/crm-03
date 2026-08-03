import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { User, Shield, Mail } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePermissions } from "@/contexts/PermissionsContext";
import { AppLoader } from "@/components/ui/loader";

// Lazy load heavy settings pages
const AccountSettingsPage = lazy(() => import("@/components/settings/AccountSettingsPage"));
const AdminSettingsPage = lazy(() => import("@/components/settings/AdminSettingsPage"));
const EmailCenterPage = lazy(() => import("@/components/settings/EmailCenterPage"));

// Unified panel loader for lazy settings sections
const SettingsContentSkeleton = () => (
  <AppLoader variant="panel" label="Loading settings…" />
);

interface SettingsTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  superAdminOnly?: boolean;
}

const tabs: SettingsTab[] = [
  {
    id: "account",
    label: "My Account",
    icon: User,
  },
  {
    id: "admin",
    label: "Administration",
    icon: Shield,
    superAdminOnly: true,
  },
  {
    id: "email",
    label: "Email Center",
    icon: Mail,
  },
];

const Settings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    return searchParams.get('tab') || 'account';
  });
  const { isSuperAdmin } = usePermissions();

  const visibleTabs = tabs.filter(tab => !tab.superAdminOnly || isSuperAdmin);

  // Sync tab with URL changes (e.g., browser navigation)
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && tabFromUrl !== activeTab && visibleTabs.some(t => t.id === tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams, visibleTabs]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    const section = searchParams.get('section');
    if (section) {
      setSearchParams({ tab: tabId, section });
    } else {
      setSearchParams({ tab: tabId });
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, currentIndex: number) => {
    const tabCount = visibleTabs.length;
    let newIndex = currentIndex;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        newIndex = currentIndex === 0 ? tabCount - 1 : currentIndex - 1;
        break;
      case 'ArrowRight':
        e.preventDefault();
        newIndex = currentIndex === tabCount - 1 ? 0 : currentIndex + 1;
        break;
      case 'Home':
        e.preventDefault();
        newIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        newIndex = tabCount - 1;
        break;
      default:
        return;
    }

    const newTab = visibleTabs[newIndex];
    setActiveTab(newTab.id);
    
    // Focus the new tab button
    const tabElement = document.getElementById(`tab-${newTab.id}`);
    tabElement?.focus();
  }, [visibleTabs]);

  // Redirect to account tab if not super admin and on admin tab
  useEffect(() => {
    if (!isSuperAdmin && activeTab === 'admin') {
      setActiveTab('account');
    }
  }, [isSuperAdmin, activeTab]);

  const renderContent = () => {
    const section = searchParams.get('section');
    switch (activeTab) {
      case "account":
        return <AccountSettingsPage />;
      case "admin":
        return <AdminSettingsPage defaultSection={section} />;
      case "email":
        return <EmailCenterPage defaultTab={section} />;
      default:
        return <AccountSettingsPage />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Tab Navigation */}
      <div className="flex-shrink-0 border-b bg-background h-16 flex items-end">
        <div className="px-6">
          <nav className="flex gap-1" role="tablist" aria-label="Settings sections">
            {visibleTabs.map((tab, index) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handleTabChange(tab.id)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sr-only sm:hidden">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Content Area */}
      <ScrollArea className="flex-1">
        <div 
          className="p-6"
          id={`tabpanel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={0}
        >
          <Suspense fallback={<SettingsContentSkeleton />}>
            {renderContent()}
          </Suspense>
        </div>
      </ScrollArea>
    </div>
  );
};

export default Settings;
