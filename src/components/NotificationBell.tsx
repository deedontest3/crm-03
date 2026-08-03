import { useState, useRef, useEffect } from 'react';
import { Bell, X, MoreVertical, Trash2, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRecentNotifications } from '@/hooks/useRecentNotifications';
import { useNotifications } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AppLoader } from '@/components/ui/loader';
import {
  getNotificationDestination,
  getNotificationIcon,
  getNotificationSeverity,
  getNotificationTypeLabel,
  getSeverityBadgeClasses,
  type NotificationRecord,
} from '@/lib/notificationTypes';

interface NotificationBellProps {
  placement?: 'up' | 'down';
  size?: 'small' | 'large';
}

export const NotificationBell = ({ placement = 'down', size = 'large' }: NotificationBellProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const { notifications, unreadCount, loading } = useRecentNotifications(10);
  // Reuse mutations from the main hook without re-running the paginated query
  // (default filters are 'all'/'all'/'all'; cache is shared with the page).
  const { markAsRead, markAllAsRead, deleteNotification } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Close on route change
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  const visible = tab === 'unread' ? notifications.filter((n) => n.status === 'unread') : notifications;

  const handleNotificationClick = async (notification: NotificationRecord) => {
    if (notification.status === 'unread') await markAsRead(notification.id);
    navigate(getNotificationDestination(notification));
    setIsOpen(false);
  };

  return (
    <div className="relative z-50" ref={dropdownRef}>
      <Button
        variant="ghost"
        size={size === 'small' ? 'sm' : 'lg'}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={cn(
          'relative rounded-full p-0 hover:bg-muted transition-colors',
          size === 'small' ? 'h-9 w-9' : 'h-10 w-10',
        )}
        onClick={() => setIsOpen((v) => !v)}
      >
        <Bell className={cn('text-foreground', size === 'small' ? 'h-4 w-4' : 'h-5 w-5')} />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className={cn(
              'absolute rounded-full p-0 flex items-center justify-center font-semibold border-2 border-background shadow-sm',
              size === 'small' ? '-top-1 -right-1 h-4 min-w-4 px-1 text-[10px]' : '-top-1 -right-1 h-5 min-w-5 px-1 text-xs',
            )}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </Button>

      {isOpen && (
        <div
          className={cn(
            'absolute right-0 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl',
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
          role="dialog"
          aria-label="Notifications"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/40">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
              {unreadCount > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{unreadCount}</Badge>
              )}
            </h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); void markAllAsRead(); }} className="text-xs h-7">
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-7 w-7 p-0"
                aria-label="Close notifications"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-3 pt-2 pb-1 border-b border-border bg-background">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | 'unread')}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs h-6 px-3">All</TabsTrigger>
                <TabsTrigger value="unread" className="text-xs h-6 px-3">
                  Unread {unreadCount > 0 && <span className="ml-1 text-muted-foreground">({unreadCount})</span>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* List */}
          <ScrollArea className="max-h-96">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center p-6">
                <AppLoader variant="panel" label="Loading notifications…" className="min-h-0" />
              </div>
            ) : visible.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Bell className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm">
                  {tab === 'unread' ? "You're all caught up" : 'No notifications yet'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((notification) => {
                  const severity = getNotificationSeverity(notification.notification_type);
                  return (
                    <li
                      key={notification.id}
                      className={cn(
                        'p-3 hover:bg-muted/50 transition-colors relative group',
                        notification.status === 'unread' && 'bg-primary/5 border-l-2 border-l-primary',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left"
                          onClick={() => handleNotificationClick(notification)}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="text-base leading-none mt-0.5">
                              {getNotificationIcon(notification.notification_type)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className={cn(
                                'text-sm text-foreground leading-snug line-clamp-3',
                                notification.status === 'unread' && 'font-semibold',
                              )}>
                                {notification.message}
                              </p>
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <p className="text-[11px] text-muted-foreground">
                                  {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                                </p>
                                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4', getSeverityBadgeClasses(severity))}>
                                  {getNotificationTypeLabel(notification.notification_type)}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity"
                              aria-label="Notification actions"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {notification.status === 'unread' && (
                              <DropdownMenuItem onClick={() => markAsRead(notification.id)}>
                                Mark as read
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => deleteNotification(notification.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>

          {/* Footer */}
          <div className="p-2 border-t border-border text-center bg-muted/40">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs w-full"
              onClick={() => {
                setIsOpen(false);
                navigate('/notifications');
              }}
            >
              View all notifications
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
