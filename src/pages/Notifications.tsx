import { Bell, CheckCheck, Trash2, MoreVertical, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useNotifications, NotificationFilters } from '@/hooks/useNotifications';
import { format, formatDistanceToNow } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLoader } from '@/components/ui/loader';
import {
  getDayGroupLabel,
  getNotificationDestination,
  getNotificationIcon,
  getNotificationSeverity,
  getNotificationTypeLabel,
  getSeverityBadgeClasses,
  NOTIFICATION_TYPES,
  type NotificationRecord,
} from '@/lib/notificationTypes';

type StatusFilter = NonNullable<NotificationFilters['status']>;
type DateRangeFilter = NonNullable<NotificationFilters['dateRange']>;

const STATUS_VALUES: StatusFilter[] = ['all', 'unread', 'read'];
const DATE_VALUES: DateRangeFilter[] = ['all', 'today', '7d', '30d'];

const Notifications = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Filters live in URL so refresh/back preserves state.
  const filters: Required<NotificationFilters> = useMemo(() => {
    const status = searchParams.get('status');
    const type = searchParams.get('type') ?? 'all';
    const dateRange = searchParams.get('range');
    return {
      status: (STATUS_VALUES.includes(status as StatusFilter) ? status : 'all') as StatusFilter,
      type,
      dateRange: (DATE_VALUES.includes(dateRange as DateRangeFilter) ? dateRange : 'all') as DateRangeFilter,
    };
  }, [searchParams]);

  const updateFilter = useCallback((patch: Partial<Required<NotificationFilters>>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const merged = { ...filters, ...patch };
      if (merged.status === 'all') next.delete('status'); else next.set('status', merged.status);
      if (merged.type === 'all') next.delete('type'); else next.set('type', merged.type);
      if (merged.dateRange === 'all') next.delete('range'); else next.set('range', merged.dateRange);
      next.delete('page');
      return next;
    }, { replace: true });
  }, [filters, setSearchParams]);

  const {
    notifications,
    unreadCount,
    markAsRead,
    markAsUnread,
    markAllAsRead,
    markManyAsRead,
    deleteNotification,
    deleteMany,
    clearFiltered,
    loading,
    fetching,
    currentPage,
    totalNotifications,
    itemsPerPage,
    fetchNotifications,
    setCurrentPage,
  } = useNotifications(filters);

  const totalPages = Math.max(1, Math.ceil(totalNotifications / itemsPerPage));
  const filtersActive = filters.status !== 'all' || filters.type !== 'all' || filters.dateRange !== 'all';

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => setSelectedIds(new Set()), [currentPage, filters.status, filters.type, filters.dateRange]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const allSelected = notifications.length > 0 && selectedIds.size === notifications.length;
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(notifications.map((n) => n.id)));

  // Live-tick relative timestamps
  const [, forceRender] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceRender((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const handlePageChange = (page: number) => {
    fetchNotifications(Math.min(Math.max(1, page), totalPages));
  };

  const handleNotificationClick = async (n: NotificationRecord) => {
    if (n.status === 'unread') await markAsRead(n.id);
    navigate(getNotificationDestination(n));
  };

  // Group by day for the list rendering
  const grouped = useMemo(() => {
    const groups = new Map<string, NotificationRecord[]>();
    for (const n of notifications) {
      const key = getDayGroupLabel(new Date(n.created_at));
      const list = groups.get(key) ?? [];
      list.push(n);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  }, [notifications]);

  const isTrulyEmpty = !filtersActive && totalNotifications === 0;

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b bg-background px-6 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="rounded-full">
                  {unreadCount} unread
                </Badge>
              )}
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages} • {totalNotifications} total
              </span>
              {fetching && !loading && <AppLoader variant="inline" label="Refreshing notifications" />}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filters.status} onValueChange={(v) => updateFilter({ status: v as StatusFilter })}>
                <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="unread">Unread</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filters.type} onValueChange={(v) => updateFilter({ type: v })}>
                <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {NOTIFICATION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filters.dateRange} onValueChange={(v) => updateFilter({ dateRange: v as DateRangeFilter })}>
                <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={() => updateFilter({ status: 'all', type: 'all', dateRange: 'all' })} className="h-8">
                  <X className="h-3.5 w-3.5 mr-1" /> Reset
                </Button>
              )}

              {unreadCount > 0 && (
                <Button variant="outline" size="sm" onClick={() => markAllAsRead()} disabled={fetching} className="flex items-center gap-2">
                  <CheckCheck className="h-4 w-4" />
                  Mark all read
                </Button>
              )}
              {totalNotifications > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="flex items-center gap-2 text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                      {filtersActive ? 'Clear filtered' : 'Clear all'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {filtersActive ? 'Clear filtered notifications?' : 'Clear all notifications?'}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {filtersActive
                          ? `This permanently deletes the ${totalNotifications} notification${totalNotifications === 1 ? '' : 's'} matching your current filters.`
                          : 'This permanently deletes every notification for your account.'} This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => clearFiltered()}>
                        {filtersActive ? 'Clear filtered' : 'Clear all'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => { void markManyAsRead(Array.from(selectedIds)); setSelectedIds(new Set()); }}>
                <CheckCheck className="h-4 w-4 mr-1" /> Mark read
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => { void deleteMany(Array.from(selectedIds)); setSelectedIds(new Set()); }}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </Button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full min-h-[240px]">
              <AppLoader variant="panel" label="Loading notifications…" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-muted-foreground max-w-sm">
                <Bell className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
                {isTrulyEmpty ? (
                  <>
                    <h3 className="text-lg font-semibold mb-2">You have no notifications</h3>
                    <p className="text-sm">When something happens in your workspace — a deal update, a reminder, a campaign reply — it'll show up here.</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-semibold mb-2">No notifications match these filters</h3>
                    <p className="text-sm mb-3">Try changing or resetting the filters above.</p>
                    <Button variant="outline" size="sm" onClick={() => updateFilter({ status: 'all', type: 'all', dateRange: 'all' })}>
                      Reset filters
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* Select-all row */}
              <div className="flex items-center gap-3 px-6 py-2 border-b bg-muted/30 text-xs text-muted-foreground">
                <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all on this page" />
                <span>Select all on this page</span>
              </div>

              {grouped.map(([groupLabel, items]) => (
                <div key={groupLabel}>
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-6 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b">
                    {groupLabel}
                  </div>
                  <ul className="divide-y divide-border">
                    {items.map((n) => {
                      const severity = getNotificationSeverity(n.notification_type);
                      const created = new Date(n.created_at);
                      const isSelected = selectedIds.has(n.id);
                      return (
                        <li
                          key={n.id}
                          className={cn(
                            'px-6 py-4 hover:bg-muted/50 transition-colors relative group',
                            n.status === 'unread' && 'bg-primary/5 border-l-4 border-l-primary',
                            isSelected && 'bg-primary/10',
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(n.id)}
                              aria-label="Select notification"
                              className="mt-1"
                            />

                            <button
                              type="button"
                              className="flex-1 min-w-0 text-left"
                              onClick={() => handleNotificationClick(n)}
                            >
                              <div className="flex items-start gap-4">
                                <span className="text-2xl mt-1 flex-shrink-0" aria-hidden>
                                  {getNotificationIcon(n.notification_type)}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className={cn('text-sm text-foreground leading-relaxed mb-2', n.status === 'unread' && 'font-semibold')}>
                                    {n.message}
                                  </p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-xs text-muted-foreground">
                                          {formatDistanceToNow(created, { addSuffix: true })}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>{format(created, 'PPpp')}</TooltipContent>
                                    </Tooltip>
                                    {n.status === 'unread' && (
                                      <Badge variant="secondary" className="text-xs">New</Badge>
                                    )}
                                    <Badge variant="outline" className={cn('text-xs', getSeverityBadgeClasses(severity))}>
                                      {getNotificationTypeLabel(n.notification_type)}
                                    </Badge>
                                    {n.module_type && (
                                      <Badge variant="outline" className="text-xs capitalize">{n.module_type}</Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity"
                                  aria-label="Notification actions"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {n.status === 'unread' ? (
                                  <DropdownMenuItem onClick={() => markAsRead(n.id)}>
                                    Mark as read
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => markAsUnread(n.id)}>
                                    Mark as unread
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem
                                      onSelect={(e) => e.preventDefault()}
                                      className="text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete this notification?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteNotification(n.id)}>Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex-shrink-0 border-t bg-background px-6 py-3">
            <Pagination>
              <PaginationContent>
                {currentPage > 1 && (
                  <PaginationItem>
                    <PaginationPrevious onClick={() => handlePageChange(currentPage - 1)} className="cursor-pointer" />
                  </PaginationItem>
                )}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;
                  return (
                    <PaginationItem key={pageNum}>
                      <PaginationLink
                        onClick={() => handlePageChange(pageNum)}
                        isActive={currentPage === pageNum}
                        className="cursor-pointer"
                      >
                        {pageNum}
                      </PaginationLink>
                    </PaginationItem>
                  );
                })}
                {currentPage < totalPages && (
                  <PaginationItem>
                    <PaginationNext onClick={() => handlePageChange(currentPage + 1)} className="cursor-pointer" />
                  </PaginationItem>
                )}
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

export default Notifications;
