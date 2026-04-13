import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
// NOTE: We intentionally avoid the Radix Avatar primitive here because the preview
// occasionally fails to load its chunk (504/ERR_ABORTED), which breaks Kanban rendering.
// A lightweight initials avatar is sufficient for this UI.
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Pencil, Trash2, Briefcase, UserCircle, Building2, Clock, AlertCircle } from 'lucide-react';
import { format, differenceInDays, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAllUsers } from '@/hooks/useUserDisplayNames';
import { useModuleRecordNames } from '@/hooks/useModuleRecords';
import { ActionItem, ActionItemStatus, ActionItemPriority } from '@/hooks/useActionItems';

interface ActionItemsKanbanProps {
  actionItems: ActionItem[];
  onEdit: (actionItem: ActionItem) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ActionItemStatus) => void;
}

const statusColumns: {
  id: ActionItemStatus;
  label: string;
  color: string;
  bgColor: string;
  badgeBg: string;
}[] = [{
  id: 'Open',
  label: 'Open',
  color: 'text-blue-600',
  bgColor: 'bg-blue-100 dark:bg-blue-900/30',
  badgeBg: 'bg-blue-500 text-white'
}, {
  id: 'In Progress',
  label: 'In Progress',
  color: 'text-yellow-600',
  bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
  badgeBg: 'bg-yellow-500 text-white'
}, {
  id: 'Completed',
  label: 'Completed',
  color: 'text-green-600',
  bgColor: 'bg-green-100 dark:bg-green-900/30',
  badgeBg: 'bg-green-500 text-white'
}, {
  id: 'Cancelled',
  label: 'Cancelled',
  color: 'text-gray-500',
  bgColor: 'bg-gray-100 dark:bg-gray-800/50',
  badgeBg: 'bg-gray-500 text-white'
}];

const priorityConfig: Record<ActionItemPriority, {
  label: string;
  borderColor: string;
  badgeClass: string;
}> = {
  Low: {
    label: 'Low',
    borderColor: 'border-l-blue-500',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
  },
  Medium: {
    label: 'Medium',
    borderColor: 'border-l-yellow-500',
    badgeClass: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
  },
  High: {
    label: 'High',
    borderColor: 'border-l-red-500',
    badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
  }
};

const moduleIcons: Record<string, React.ElementType> = {
  accounts: Building2,
  contacts: UserCircle,
  deals: Briefcase
};

const moduleLabels: Record<string, string> = {
  accounts: 'Account',
  contacts: 'Contact',
  deals: 'Deal'
};

// Helper functions
const getInitials = (name: string): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

function InitialsAvatar({ name }: { name: string }) {
  return (
    <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-medium select-none">
      {getInitials(name)}
    </div>
  );
}

const getDueDateStyles = (dueDate: string): { text: string; className: string } => {
  const date = startOfDay(new Date(dueDate));
  const today = startOfDay(new Date());
  const diffDays = differenceInDays(date, today);
  
  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return { 
      text: overdueDays === 1 ? 'Overdue 1 day' : `Overdue ${overdueDays} days`, 
      className: 'text-red-600 bg-red-100 dark:bg-red-900/50 dark:text-red-300' 
    };
  }
  if (diffDays === 0) return { text: 'Today', className: 'text-orange-600 bg-orange-100 dark:bg-orange-900/50 dark:text-orange-300' };
  if (diffDays === 1) return { text: 'Tomorrow', className: 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/50 dark:text-yellow-300' };
  if (diffDays <= 7) return { text: format(date, 'EEE'), className: 'text-muted-foreground bg-muted' };
  return { text: format(date, 'dd MMM'), className: 'text-muted-foreground bg-muted' };
};

export function ActionItemsKanban({
  actionItems,
  onEdit,
  onDelete,
  onStatusChange
}: ActionItemsKanbanProps) {
  const { getUserDisplayName } = useAllUsers();

  // Get all linked record names
  const itemsWithModules = actionItems.map(item => ({
    module_type: item.module_type,
    module_id: item.module_id
  }));
  const { getRecordName } = useModuleRecordNames(itemsWithModules);

  const getItemsByStatus = (status: ActionItemStatus) => {
    return actionItems.filter(item => item.status === status);
  };

  const handleDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    const newStatus = destination.droppableId as ActionItemStatus;
    onStatusChange(draggableId, newStatus);
  };

  const isOverdue = (dueDate: string | null): boolean => {
    if (!dueDate) return false;
    const date = startOfDay(new Date(dueDate));
    const today = startOfDay(new Date());
    return differenceInDays(date, today) < 0;
  };

  return (
    <TooltipProvider>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 h-full overflow-x-auto">
          {statusColumns.map(column => {
            const items = getItemsByStatus(column.id);
            return (
              <div key={column.id} className="flex flex-col min-w-[280px]">
                {/* Column Header */}
                <div className={cn('rounded-t-lg px-4 py-3 flex items-center justify-between', column.bgColor)}>
                  <span className={cn('font-semibold', column.color)}>{column.label}</span>
                  <Badge className={cn('h-6 min-w-6 flex items-center justify-center', column.badgeBg)}>
                    {items.length}
                  </Badge>
                </div>

                {/* Column Content */}
                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div 
                      ref={provided.innerRef} 
                      {...provided.droppableProps} 
                      className={cn(
                        'flex-1 p-2 bg-muted/30 rounded-b-lg min-h-[300px] space-y-2',
                        snapshot.isDraggingOver && 'bg-muted/50'
                      )}
                    >
                      {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-24 text-sm text-muted-foreground gap-2">
                          <Clock className="h-5 w-5 opacity-40" />
                          <span>No items</span>
                        </div>
                      ) : (
                        items.map((item, index) => {
                          const priority = priorityConfig[item.priority];
                          const linkedRecordName = getRecordName(item.module_type, item.module_id);
                          const ModuleIcon = moduleIcons[item.module_type];
                          const displayName = item.assigned_to ? getUserDisplayName(item.assigned_to) : 'Unassigned';
                          const isCompleted = item.status === 'Completed' || item.status === 'Cancelled';
                          const itemIsOverdue = isOverdue(item.due_date) && !isCompleted;
                          
                          return (
                            <Draggable key={item.id} draggableId={item.id} index={index}>
                              {(provided, snapshot) => (
                                <Card 
                                  ref={provided.innerRef} 
                                  {...provided.draggableProps} 
                                  {...provided.dragHandleProps} 
                                  className={cn(
                                    'cursor-pointer hover:shadow-md transition-all group border-l-4',
                                    priority.borderColor,
                                    snapshot.isDragging && 'shadow-lg rotate-[2deg] scale-[1.02]',
                                    itemIsOverdue && 'bg-red-50/50 dark:bg-red-950/20',
                                    isCompleted && 'opacity-70'
                                  )}
                                >
                                  <CardContent className="p-3 space-y-2">
                                    {/* Header: Priority Badge + Actions */}
                                    <div className="flex items-center justify-between">
                                      <Badge 
                                        variant="secondary" 
                                        className={cn('text-[10px] px-1.5 py-0.5 font-medium', priority.badgeClass)}
                                      >
                                        {priority.label}
                                      </Badge>
                                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
                                        <Button 
                                          variant="ghost" 
                                          size="icon" 
                                          className="h-7 w-7" 
                                          onClick={e => {
                                            e.stopPropagation();
                                            onEdit(item);
                                          }}
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button 
                                          variant="ghost" 
                                          size="icon" 
                                          className="h-7 w-7 text-destructive hover:text-destructive" 
                                          onClick={e => {
                                            e.stopPropagation();
                                            onDelete(item.id);
                                          }}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>

                                    {/* Title */}
                                    <h4 className={cn(
                                      'text-sm font-medium leading-snug',
                                      isCompleted && 'line-through text-muted-foreground'
                                    )}>
                                      {item.title}
                                    </h4>

                                    {/* Linked Record Chip */}
                                    {item.module_id && linkedRecordName && ModuleIcon && (
                                      <div className="flex items-center">
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground">
                                          <ModuleIcon className="h-3 w-3" />
                                          <span className="truncate max-w-[140px]">{linkedRecordName}</span>
                                        </span>
                                      </div>
                                    )}

                                    {/* Footer: Due Date + Assignee Avatar */}
                                    <div className="flex items-center justify-between pt-1">
                                      {item.due_date ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className={cn(
                                              'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded font-medium',
                                              getDueDateStyles(item.due_date).className
                                            )}>
                                              {itemIsOverdue && <AlertCircle className="h-3 w-3" />}
                                              {getDueDateStyles(item.due_date).text}
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            Due: {format(new Date(item.due_date), 'PPP')}
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : (
                                        <span className="text-[11px] text-muted-foreground">No due date</span>
                                      )}
                                      
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="cursor-default">
                                            <InitialsAvatar name={displayName} />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent>{displayName}</TooltipContent>
                                      </Tooltip>
                                    </div>
                                  </CardContent>
                                </Card>
                              )}
                            </Draggable>
                          );
                        })
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
    </TooltipProvider>
  );
}
