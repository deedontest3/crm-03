import { Bell, CheckCheck, Trash2, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useNotifications } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const Notifications = () => {
  const { 
    notifications, 
    unreadCount, 
    markAsRead, 
    markAllAsRead, 
    deleteNotification, 
    loading,
    currentPage,
    totalNotifications,
    itemsPerPage,
    fetchNotifications,
    setCurrentPage
  } = useNotifications();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const totalPages = Math.ceil(totalNotifications / itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchNotifications(page);
  };

  useEffect(() => {
    fetchNotifications(1);
  }, []);

  const handleNotificationClick = async (notification: any) => {
    if (notification.status === 'unread') {
      await markAsRead(notification.id);
    }

    // If we have an action_item_id, navigate to action items page with highlight
    if (notification.action_item_id) {
      navigate(`/action-items?highlight=${notification.action_item_id}`);
      return;
    }

    // Fallback navigation based on module_type
    if (notification.module_type === 'deals' && notification.module_id) {
      navigate(`/deals?highlight=${notification.module_id}`);
    } else if (notification.module_type === 'leads' && notification.module_id) {
      navigate(`/deals?highlight=${notification.module_id}`);
    } else if (notification.module_type === 'contacts' && notification.module_id) {
      navigate(`/contacts?highlight=${notification.module_id}`);
    } else if (notification.lead_id) {
      navigate(`/deals?highlight=${notification.lead_id}`);
    } else if (notification.notification_type === 'action_item') {
      navigate('/action-items');
    } else if (notification.notification_type === 'deal_update') {
      navigate('/deals');
    } else if (notification.notification_type === 'lead_update') {
      navigate('/deals');
    } else {
      navigate('/action-items');
    }
  };

  const handleMarkAllRead = async () => {
    await markAllAsRead();
  };

  const handleClearAll = async () => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "All notifications cleared"
      });
      fetchNotifications(1);
    } catch (error) {
      console.error('Error clearing notifications:', error);
      toast({
        title: "Error",
        description: "Failed to clear notifications",
        variant: "destructive"
      });
    }
  };

  const handleDeleteNotification = async (notificationId: string) => {
    await deleteNotification(notificationId);
  };

  const getNotificationIcon = (notification: any) => {
    const message = notification.message || '';
    const type = notification.notification_type;
    
    // Check for emoji prefixes first (from trigger)
    if (message.includes('🔴')) return '🔴';
    if (message.includes('✅')) return '✅';
    if (message.includes('🗑️')) return '🗑️';
    if (message.includes('📊')) return '📊';
    if (message.includes('🔄')) return '🔄';
    
    // Check by notification type first
    if (type === 'deal_update') {
      if (message.toLowerCase().includes('deleted')) return '🗑️';
      if (message.toLowerCase().includes('stage')) return '📊';
      return '💼';
    }
    if (type === 'lead_update') {
      if (message.toLowerCase().includes('deleted')) return '🗑️';
      if (message.toLowerCase().includes('status')) return '🔄';
      return '👤';
    }
    
    // Action item notifications
    if (message.toLowerCase().includes('completed')) return '✅';
    if (message.toLowerCase().includes('deleted')) return '🗑️';
    if (message.toLowerCase().includes('assigned to you')) return '📋';
    if (message.toLowerCase().includes('reassigned')) return '🔄';
    if (message.toLowerCase().includes('priority') || message.toLowerCase().includes('high')) return '🔴';
    if (message.toLowerCase().includes('due date')) return '📅';
    
    // Fallback
    return '🔔';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading notifications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header - fixed height matching sidebar */}
      <div className="flex-shrink-0 h-16 border-b bg-background px-6 flex items-center">
        <div className="flex items-center justify-between w-full">
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
          </div>
          
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllRead}
                className="flex items-center gap-2"
              >
                <CheckCheck className="h-4 w-4" />
                Mark All Read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                className="flex items-center gap-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Clear All
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-auto">
        {notifications.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <Bell className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-semibold mb-2">No notifications yet</h3>
              <p className="text-sm">You'll see updates about action items and leads here</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "px-6 py-4 hover:bg-muted/50 cursor-pointer transition-colors relative group",
                  notification.status === 'unread' && "bg-blue-50/50 border-l-4 border-l-blue-500"
                )}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-4">
                      <span className="text-2xl mt-1 flex-shrink-0">
                        {getNotificationIcon(notification)}
                      </span>
                      <div className="flex-1">
                        <p className={cn(
                          "text-sm text-foreground leading-relaxed mb-3",
                          notification.status === 'unread' && "font-semibold"
                        )}>
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-3">
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </p>
                          {notification.status === 'unread' && (
                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                              New
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs capitalize">
                            {notification.notification_type.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {notification.status === 'unread' && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead(notification.id);
                          }}
                        >
                          Mark as read
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNotification(notification.id);
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex-shrink-0 border-t bg-background px-6 py-3">
          <Pagination>
            <PaginationContent>
              {currentPage > 1 && (
                <PaginationItem>
                  <PaginationPrevious 
                    onClick={() => handlePageChange(currentPage - 1)}
                    className="cursor-pointer"
                  />
                </PaginationItem>
              )}
              
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
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
                  <PaginationNext 
                    onClick={() => handlePageChange(currentPage + 1)}
                    className="cursor-pointer"
                  />
                </PaginationItem>
              )}
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
};

export default Notifications;
