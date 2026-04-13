import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { startOfWeek } from "date-fns";
import { ModuleFilter } from "./AuditLogFilters";

interface AuditLogStatsProps {
  total: number;
  todayCount: number;
  weekCount: number;
  byModule: Record<string, number>;
  byUser: Record<string, number>;
  userNames: Record<string, string>;
  onDatePreset?: (from: Date | undefined, to: Date | undefined) => void;
  onModuleFilter?: (mod: ModuleFilter) => void;
  activeModuleFilter?: ModuleFilter;
  dateFrom?: Date;
  dateTo?: Date;
}

const moduleDisplayToFilter: Record<string, ModuleFilter> = {
  'Contacts': 'contacts',
  'Deals': 'deals',
  'Leads': 'leads',
  'Action Items': 'action_items',
  'Action items': 'action_items',
  'Action_items': 'action_items',
  'Accounts': 'accounts',
};

export const AuditLogStats = ({ total, todayCount, weekCount, byModule, onDatePreset, onModuleFilter, activeModuleFilter, dateFrom, dateTo }: AuditLogStatsProps) => {
  const hiddenModules = ['Campaigns'];
  const topModules = Object.entries(byModule)
    .filter(([mod]) => !hiddenModules.includes(mod))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const isTodayActive = (() => {
    if (!dateFrom || !dateTo) return false;
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    return dateFrom.getTime() === todayStart.getTime() && dateTo.toDateString() === now.toDateString();
  })();

  const isWeekActive = (() => {
    if (!dateFrom || !dateTo) return false;
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    return dateFrom.toDateString() === weekStart.toDateString() && dateTo.toDateString() === now.toDateString() && !isTodayActive;
  })();

  const handleToday = () => {
    if (!onDatePreset) return;
    if (isTodayActive) { onDatePreset(undefined, undefined); return; }
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    onDatePreset(start, now);
  };

  const handleThisWeek = () => {
    if (!onDatePreset) return;
    if (isWeekActive) { onDatePreset(undefined, undefined); return; }
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    onDatePreset(weekStart, now);
  };

  const handleModuleClick = (mod: string) => {
    if (!onModuleFilter) return;
    const filter = moduleDisplayToFilter[mod] || mod.toLowerCase().replace(/ /g, '_') as ModuleFilter;
    onModuleFilter(activeModuleFilter === filter ? 'all' : filter);
  };

  const clearDateFilter = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDatePreset?.(undefined, undefined);
  };

  const clearModuleFilter = (e: React.MouseEvent) => {
    e.stopPropagation();
    onModuleFilter?.('all');
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <Badge variant="secondary" className="gap-1.5 text-xs font-medium py-1">
        Total <span className="font-bold">{total}</span>
      </Badge>
      <Badge
        className={`gap-1.5 text-xs font-medium py-1 border-0 cursor-pointer hover:opacity-80 transition-all ${isTodayActive ? 'ring-2 ring-emerald-500 bg-emerald-200 text-emerald-900 dark:bg-emerald-800/50 dark:text-emerald-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'}`}
        onClick={handleToday}
      >
        Today <span className="font-bold">{todayCount}</span>
        {isTodayActive && (
          <X className="h-3 w-3 ml-0.5 hover:text-destructive" onClick={clearDateFilter} />
        )}
      </Badge>
      <Badge
        className={`gap-1.5 text-xs font-medium py-1 border-0 cursor-pointer hover:opacity-80 transition-all ${isWeekActive ? 'ring-2 ring-blue-500 bg-blue-200 text-blue-900 dark:bg-blue-800/50 dark:text-blue-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'}`}
        onClick={handleThisWeek}
      >
        This Week <span className="font-bold">{weekCount}</span>
        {isWeekActive && (
          <X className="h-3 w-3 ml-0.5 hover:text-destructive" onClick={clearDateFilter} />
        )}
      </Badge>
      <span className="text-muted-foreground text-xs">|</span>
      {topModules.map(([mod, count]) => {
        const filter = moduleDisplayToFilter[mod] || mod.toLowerCase().replace(/ /g, '_') as ModuleFilter;
        const isActive = activeModuleFilter === filter;
        return (
          <Badge
            key={mod}
            variant="outline"
            className={`gap-1.5 text-xs font-normal py-1 cursor-pointer hover:opacity-80 transition-all ${isActive ? 'ring-2 ring-primary bg-primary/10' : ''}`}
            onClick={() => handleModuleClick(mod)}
          >
            {mod} <span className="font-bold">{count}</span>
            {isActive && (
              <X className="h-3 w-3 ml-0.5 hover:text-destructive" onClick={clearModuleFilter} />
            )}
          </Badge>
        );
      })}
    </div>
  );
};
