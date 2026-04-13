import { useState, useEffect, useRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoreHorizontal, Pencil, Trash2, ArrowUpDown, ArrowUp, ArrowDown, CheckCircle, Handshake, UserPlus, Users, Megaphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAllUsers } from '@/hooks/useUserDisplayNames';
import { useModuleRecordNames } from '@/hooks/useModuleRecords';
import { ActionItem, ActionItemStatus, ActionItemPriority } from '@/hooks/useActionItems';
import { DealForm } from './DealForm';
// LeadModal removed - leads are now managed under Deals
import { ContactModal } from './ContactModal';
import { supabase } from '@/integrations/supabase/client';
import { Deal } from '@/types/deal';
interface ActionItemsTableProps {
  actionItems: ActionItem[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onEdit: (actionItem: ActionItem) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ActionItemStatus) => void;
  onPriorityChange: (id: string, priority: ActionItemPriority) => void;
  onAssignedToChange: (id: string, userId: string | null) => void;
  onDueDateChange: (id: string, date: string | null) => void;
  sortField?: string | null;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  columnWidths: Record<string, number>;
  onColumnResize: (field: string, width: number) => void;
}
const priorityConfig: Record<ActionItemPriority, {
  color: string;
  bgColor: string;
  abbrev: string;
}> = {
  Low: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-500',
    abbrev: 'L'
  },
  Medium: {
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-500',
    abbrev: 'M'
  },
  High: {
    color: 'text-red-600',
    bgColor: 'bg-red-500',
    abbrev: 'H'
  }
};
const statusConfig: Record<ActionItemStatus, {
  dotColor: string;
}> = {
  Open: {
    dotColor: 'bg-blue-500'
  },
  'In Progress': {
    dotColor: 'bg-yellow-500'
  },
  Completed: {
    dotColor: 'bg-green-500'
  },
  Cancelled: {
    dotColor: 'bg-muted-foreground'
  }
};
const moduleLabels: Record<string, string> = {
  accounts: 'Account',
  contacts: 'Contact',
  deals: 'Deal',
  campaigns: 'Campaign'
};
export function ActionItemsTable({
  actionItems,
  selectedIds,
  onSelectionChange,
  onEdit,
  onDelete,
  onStatusChange,
  onPriorityChange,
  onAssignedToChange,
  onDueDateChange,
  sortField = null,
  sortDirection = 'asc',
  onSort,
  columnWidths,
  onColumnResize
}: ActionItemsTableProps) {
  const navigate = useNavigate();
  const {
    users,
    getUserDisplayName
  } = useAllUsers();

  // Modal state for viewing linked records
  const [dealModalOpen, setDealModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const allSelected = actionItems.length > 0 && selectedIds.length === actionItems.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < actionItems.length;

  // Inline date editing state
  const [editingDateId, setEditingDateId] = useState<string | null>(null);

  // Column resize state
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);

  // Get all linked record names
  const itemsWithModules = actionItems.map(item => ({
    module_type: item.module_type,
    module_id: item.module_id
  }));
  const {
    getRecordName
  } = useModuleRecordNames(itemsWithModules);
  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(actionItems.map(item => item.id));
    }
  };
  const toggleItem = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter(selectedId => selectedId !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };
  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-muted-foreground/60" />;
    }
    return sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-foreground" /> : <ArrowDown className="w-3 h-3 text-foreground" />;
  };

  // Column resize handlers
  const handleMouseDown = (e: React.MouseEvent, field: string) => {
    setIsResizing(field);
    setStartX(e.clientX);
    setStartWidth(columnWidths[field] || 120);
    e.preventDefault();
    e.stopPropagation();
  };
  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing) return;
    const deltaX = e.clientX - startX;
    const newWidth = Math.max(60, startWidth + deltaX);
    onColumnResize(isResizing, newWidth);
  };
  const handleMouseUp = () => {
    setIsResizing(null);
  };
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, startX, startWidth]);
  const handleLinkedRecordClick = async (e: React.MouseEvent, moduleType: string, moduleId: string) => {
    e.stopPropagation();
    
    const normalizedType = moduleType.toLowerCase();
    
    try {
      if (normalizedType === 'deal' || normalizedType === 'deals') {
        const { data } = await supabase
          .from('deals')
          .select('*')
          .eq('id', moduleId)
          .maybeSingle();
        if (data) {
          setSelectedDeal(data as Deal);
          setDealModalOpen(true);
        }
      } else if (normalizedType === 'account' || normalizedType === 'accounts') {
        // Account records - just show a toast for now since no account modal exists in this context
        const { data } = await supabase
          .from('accounts')
          .select('*')
          .eq('id', moduleId)
          .maybeSingle();
        if (data) {
          // Navigate or show account - for now just log
          console.log('Account clicked:', data);
        }
      } else if (normalizedType === 'contact' || normalizedType === 'contacts') {
        const { data } = await supabase
          .from('contacts')
          .select('*')
          .eq('id', moduleId)
          .maybeSingle();
        if (data) {
          setSelectedContact(data);
          setContactModalOpen(true);
        }
      }
    } catch (error) {
      console.error('Error fetching record:', error);
    }
  };

  const handleDealSave = async (dealData: Partial<Deal>) => {
    if (selectedDeal) {
      const { error } = await supabase
        .from('deals')
        .update({
          ...dealData,
          modified_at: new Date().toISOString()
        })
        .eq('id', selectedDeal.id);
      
      if (!error) {
        setDealModalOpen(false);
        setSelectedDeal(null);
      }
    }
  };

  const handleDueDateBlur = (itemId: string, value: string) => {
    onDueDateChange(itemId, value || null);
    setEditingDateId(null);
  };
  if (actionItems.length === 0) {
    return <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No action items found</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new action item to get started
        </p>
      </div>;
  }

  // Column configuration
  const columns = [{
    field: 'checkbox',
    label: '',
    sortable: false,
    width: 40,
    align: 'center' as const
  }, {
    field: 'title',
    label: 'Action Item',
    sortable: true,
    width: columnWidths.title || 300
  }, {
    field: 'assigned_to',
    label: 'Assigned To',
    sortable: true,
    width: columnWidths.assigned_to || 100
  }, {
    field: 'due_date',
    label: 'Due Date',
    sortable: true,
    width: columnWidths.due_date || 100
  }, {
    field: 'status',
    label: 'Status',
    sortable: true,
    width: columnWidths.status || 40,
    compact: true
  }, {
    field: 'priority',
    label: 'Priority',
    sortable: true,
    width: columnWidths.priority || 40,
    compact: true
  }, {
    field: 'module',
    label: 'Module',
    sortable: true,
    width: columnWidths.module || 44,
    compact: true
  }, {
    field: 'actions',
    label: '',
    sortable: false,
    width: 60
  }];
  return <div className={cn(isResizing && 'select-none')}>
      <Table>
        <TableHeader className="sticky top-0 z-20 bg-muted/80 backdrop-blur-sm">
          <TableRow className="bg-muted/80 border-b-2 border-border">
            {columns.map(col => <TableHead key={col.field} className={cn('relative text-sm font-bold bg-muted/80 py-3 h-11 text-foreground', col.compact ? 'px-1 text-center' : 'px-3 text-left', col.sortable && 'cursor-pointer hover:bg-muted/80', sortField === col.field && 'bg-accent', col.field === 'checkbox' && 'w-10', col.field === 'actions' && 'w-[60px] px-2')} style={{
            ...(col.field !== 'checkbox' && col.field !== 'actions' && !col.compact ? { width: `${col.width}px` } : {}),
            ...(col.compact ? { width: '6.67%', maxWidth: '6.67%' } : {}),
            ...(col.field === 'title' ? { minWidth: '200px' } : {}),
          }} onClick={() => col.sortable && onSort?.(col.field)}>
                {col.field === 'checkbox' ? <div className="flex items-center justify-center h-full">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" className={someSelected ? 'data-[state=checked]:bg-primary' : ''} />
                  </div> : col.label ? <div className={cn('flex items-center gap-1', col.compact && 'justify-center')}>
                    {col.label}
                    {col.sortable && !col.compact && getSortIcon(col.field)}
                  </div> : null}
                {/* Resize handle */}
                {col.field !== 'checkbox' && col.field !== 'actions' && !col.compact && <div className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary/40 active:bg-primary/60" onMouseDown={e => handleMouseDown(e, col.field)} />}
              </TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {actionItems.map(item => {
          const priority = priorityConfig[item.priority];
          const status = statusConfig[item.status];
          const linkedRecordName = getRecordName(item.module_type, item.module_id);
          return <TableRow key={item.id} className={cn('group cursor-pointer hover:bg-muted/30 border-b border-border/50', selectedIds.includes(item.id) && 'bg-primary/5')} onClick={() => onEdit(item)}>
                {/* Checkbox */}
                <TableCell onClick={e => e.stopPropagation()} className="py-2 px-3 w-10">
                  <div className="flex items-center justify-center">
                    <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={() => toggleItem(item.id)} aria-label={`Select ${item.title}`} />
                  </div>
                </TableCell>

                {/* Action Item */}
                <TableCell className="py-2 px-3 text-sm" style={{
              width: `${columnWidths.title || 300}px`,
              minWidth: '200px'
            }}>
                  <button onClick={e => {
                e.stopPropagation();
                onEdit(item);
              }} className="hover:underline text-left whitespace-normal break-words text-[#2e538e] font-normal">
                    {item.title}
                  </button>
                </TableCell>

                {/* Assigned To */}
                <TableCell onClick={e => e.stopPropagation()} className="py-2 px-3 text-sm">
                  <Select value={item.assigned_to || 'unassigned'} onValueChange={value => onAssignedToChange(item.id, value === 'unassigned' ? null : value)}>
                    <SelectTrigger className="h-7 w-auto min-w-0 text-sm border-0 bg-transparent hover:bg-muted/50 px-0 [&>svg]:hidden">
                      <SelectValue>
                        <span className="truncate">
                          {item.assigned_to ? getUserDisplayName(item.assigned_to) : 'Unassigned'}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users.map(user => <SelectItem key={user.id} value={user.id}>
                          {user.display_name}
                        </SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>

                {/* Due Date */}
                <TableCell onClick={e => e.stopPropagation()} className="py-2 px-3 text-sm">
                  {editingDateId === item.id ? <Input type="date" defaultValue={item.due_date || ''} onBlur={e => handleDueDateBlur(item.id, e.target.value)} onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleDueDateBlur(item.id, (e.target as HTMLInputElement).value);
                } else if (e.key === 'Escape') {
                  setEditingDateId(null);
                }
              }} autoFocus className="h-7 w-[130px] text-sm" /> : <button onClick={() => setEditingDateId(item.id)} className="hover:underline">
                      {item.due_date ? format(new Date(item.due_date), 'dd-MM-yy') : '—'}
                    </button>}
                </TableCell>

                {/* Status - dot only */}
                <TableCell onClick={e => e.stopPropagation()} className="py-2 px-1 text-sm text-center" style={{ width: '6.67%', maxWidth: '6.67%' }}>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex justify-center">
                          <Select value={item.status} onValueChange={(value: ActionItemStatus) => onStatusChange(item.id, value)}>
                            <SelectTrigger className="h-7 w-7 min-w-0 text-sm border-0 bg-transparent hover:bg-muted/50 px-0 justify-center [&>svg]:hidden">
                              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', status.dotColor)} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Open">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                                  Open
                                </div>
                              </SelectItem>
                              <SelectItem value="In Progress">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                                  In Progress
                                </div>
                              </SelectItem>
                              <SelectItem value="Completed">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-green-500" />
                                  Completed
                                </div>
                              </SelectItem>
                              <SelectItem value="Cancelled">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                                  Cancelled
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">{item.status}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>

                {/* Priority - dot only */}
                <TableCell onClick={e => e.stopPropagation()} className="py-2 px-1 text-sm text-center" style={{ width: '6.67%', maxWidth: '6.67%' }}>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex justify-center">
                          <Select value={item.priority} onValueChange={(value: ActionItemPriority) => onPriorityChange(item.id, value)}>
                            <SelectTrigger className="h-7 w-7 min-w-0 text-sm border-0 bg-transparent hover:bg-muted/50 px-0 justify-center [&>svg]:hidden">
                              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', priority.bgColor)} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="High">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-red-500" />
                                  High
                                </div>
                              </SelectItem>
                              <SelectItem value="Medium">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                                  Medium
                                </div>
                              </SelectItem>
                              <SelectItem value="Low">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                                  Low
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">{item.priority}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>

                {/* Module - icon only */}
                <TableCell className="py-2 px-1 text-sm text-center" style={{ width: '6.67%', maxWidth: '6.67%' }}>
                  {item.module_type === 'campaigns' && item.module_id && linkedRecordName ? (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={e => { e.stopPropagation(); navigate(`/campaigns/${item.module_id}?tab=tasks`); }}
                            className="h-7 px-2 flex items-center gap-1 rounded hover:bg-muted/50 text-primary mx-auto"
                          >
                            <Megaphone className="h-3.5 w-3.5" />
                            <span className="text-xs truncate max-w-[80px]">{linkedRecordName}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{linkedRecordName}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : item.module_id && linkedRecordName ? (
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={e => handleLinkedRecordClick(e, item.module_type, item.module_id!)}
                            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted/50 text-[#2e538e] mx-auto"
                          >
                            {(() => {
                              const t = item.module_type.toLowerCase();
                              if (t === 'deal' || t === 'deals') return <Handshake className="h-4 w-4" />;
                              if (t === 'account' || t === 'accounts') return <UserPlus className="h-4 w-4" />;
                              if (t === 'contact' || t === 'contacts') return <Users className="h-4 w-4" />;
                              return <span className="text-xs">{t[0]?.toUpperCase()}</span>;
                            })()}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{linkedRecordName}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <span className="text-muted-foreground flex justify-center">—</span>
                  )}
                </TableCell>

                {/* Actions */}
                <TableCell onClick={e => e.stopPropagation()} className="py-2 px-2">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(item)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        {item.status !== 'Completed' && (
                          <DropdownMenuItem onClick={() => onStatusChange(item.id, 'Completed')}>
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Mark Complete
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onDelete(item.id)} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>;
        })}
        </TableBody>
      </Table>

      {/* Deal Modal */}
      <DealForm
        deal={selectedDeal}
        isOpen={dealModalOpen}
        onClose={() => {
          setDealModalOpen(false);
          setSelectedDeal(null);
        }}
        onSave={handleDealSave}
        isCreating={false}
      />

      {/* Contact Modal */}
      <ContactModal
        open={contactModalOpen}
        onOpenChange={(open) => {
          setContactModalOpen(open);
          if (!open) setSelectedContact(null);
        }}
        contact={selectedContact}
        onSuccess={() => setContactModalOpen(false)}
      />
    </div>;
}