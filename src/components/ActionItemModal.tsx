import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { CalendarIcon, Loader2, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAllUsers } from '@/hooks/useUserDisplayNames';
import { useModuleRecords } from '@/hooks/useModuleRecords';
import { useAuth } from '@/hooks/useAuth';
import {
  ActionItem,
  ActionItemPriority,
  ActionItemStatus,
  ModuleType,
  CreateActionItemInput,
} from '@/hooks/useActionItems';

interface ActionItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionItem?: ActionItem | null;
  onSave: (data: CreateActionItemInput) => Promise<void>;
  defaultModuleType?: ModuleType;
  defaultModuleId?: string;
}

const priorityDotColor: Record<ActionItemPriority, string> = {
  High: 'bg-red-500',
  Medium: 'bg-yellow-500',
  Low: 'bg-blue-500',
};

const priorityOptions: { value: ActionItemPriority; label: string; dotColor: string }[] = [
  { value: 'Low', label: 'Low', dotColor: priorityDotColor.Low },
  { value: 'Medium', label: 'Medium', dotColor: priorityDotColor.Medium },
  { value: 'High', label: 'High', dotColor: priorityDotColor.High },
];

const statusDotColor: Record<ActionItemStatus, string> = {
  Open: 'bg-blue-500',
  'In Progress': 'bg-yellow-500',
  Completed: 'bg-green-500',
  Cancelled: 'bg-muted-foreground',
};

const statusOptions: { value: ActionItemStatus; label: string; dotColor: string }[] = [
  { value: 'Open', label: 'Open', dotColor: statusDotColor.Open },
  { value: 'In Progress', label: 'In Progress', dotColor: statusDotColor['In Progress'] },
  { value: 'Completed', label: 'Completed', dotColor: statusDotColor.Completed },
  { value: 'Cancelled', label: 'Cancelled', dotColor: statusDotColor.Cancelled },
];

const moduleOptions: { value: ModuleType; label: string }[] = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'deals', label: 'Deals' },
];

export function ActionItemModal({
  open,
  onOpenChange,
  actionItem,
  onSave,
  defaultModuleType = 'accounts',
  defaultModuleId,
}: ActionItemModalProps) {
  const { users, getUserDisplayName } = useAllUsers();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recordSearchOpen, setRecordSearchOpen] = useState(false);
  const [recordSearchValue, setRecordSearchValue] = useState('');
  const [formData, setFormData] = useState({
    module_type: defaultModuleType as ModuleType,
    module_id: defaultModuleId || null as string | null,
    title: '',
    description: '',
    assigned_to: null as string | null,
    due_date: null as Date | null,
    priority: 'Medium' as ActionItemPriority,
    status: 'Open' as ActionItemStatus,
  });

  // Fetch records for the selected module
  const { records, isLoading: isLoadingRecords } = useModuleRecords(formData.module_type);

  // Get creator's display name
  const creatorName = actionItem 
    ? getUserDisplayName(actionItem.created_by) 
    : (user ? getUserDisplayName(user.id) : 'Unknown');

  // Reset form when modal opens/closes or actionItem changes
  useEffect(() => {
    if (actionItem) {
      setFormData({
        module_type: actionItem.module_type as ModuleType,
        module_id: actionItem.module_id,
        title: actionItem.title,
        description: actionItem.description || '',
        assigned_to: actionItem.assigned_to,
        due_date: actionItem.due_date ? new Date(actionItem.due_date) : null,
        priority: actionItem.priority,
        status: actionItem.status,
      });
    } else {
      setFormData({
        module_type: defaultModuleType,
        module_id: defaultModuleId || null,
        title: '',
        description: '',
        assigned_to: null,
        due_date: null,
        priority: 'Medium',
        status: 'Open',
      });
    }
    setRecordSearchValue('');
  }, [actionItem, open, defaultModuleType, defaultModuleId]);

  // Reset module_id when module_type changes (unless editing)
  useEffect(() => {
    if (!actionItem && open) {
      setFormData((prev) => ({ ...prev, module_id: null }));
      setRecordSearchValue('');
    }
  }, [formData.module_type, actionItem, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    setIsSubmitting(true);
    try {
      await onSave({
        module_type: formData.module_type,
        module_id: formData.module_id,
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        assigned_to: formData.assigned_to,
        due_date: formData.due_date ? format(formData.due_date, 'yyyy-MM-dd') : null,
        priority: formData.priority,
        status: formData.status,
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving action item:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRecordPlaceholder = () => {
    switch (formData.module_type) {
      case 'accounts':
        return 'Select account...';
      case 'contacts':
        return 'Select contact...';
      case 'deals':
        return 'Select deal...';
      default:
        return 'Select record...';
    }
  };

  const selectedRecordName = formData.module_id
    ? records.find((r) => r.id === formData.module_id)?.name
    : null;

  const filteredRecords = recordSearchValue
    ? records.filter((r) =>
        r.name.toLowerCase().includes(recordSearchValue.toLowerCase())
      )
    : records;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {actionItem ? 'Edit Action Item' : 'New Action Item'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Record Linking */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Module Selection */}
              <div className="space-y-2">
                <Label htmlFor="module">Module</Label>
                <Select
                  value={formData.module_type}
                  onValueChange={(value: ModuleType) =>
                    setFormData((prev) => ({ ...prev, module_type: value, module_id: null }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select module" />
                  </SelectTrigger>
                  <SelectContent>
                    {moduleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Record Selection - Searchable Combobox */}
              <div className="space-y-2">
                <Label htmlFor="record">Record</Label>
                <Popover open={recordSearchOpen} onOpenChange={setRecordSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={recordSearchOpen}
                      className="w-full justify-between font-normal"
                      disabled={isLoadingRecords}
                    >
                      <span className="truncate">
                        {isLoadingRecords
                          ? 'Loading...'
                          : selectedRecordName || getRecordPlaceholder()}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0 w-[--radix-popover-trigger-width]"
                    align="start"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder={`Search ${formData.module_type}...`}
                        value={recordSearchValue}
                        onValueChange={setRecordSearchValue}
                      />
                      <CommandList className="max-h-[200px]">
                        <CommandEmpty>No records found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="none"
                            onSelect={() => {
                              setFormData((prev) => ({ ...prev, module_id: null }));
                              setRecordSearchOpen(false);
                              setRecordSearchValue('');
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                !formData.module_id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            No linked record
                          </CommandItem>
                          {filteredRecords.map((record) => (
                            <CommandItem
                              key={record.id}
                              value={record.id}
                              onSelect={() => {
                                setFormData((prev) => ({ ...prev, module_id: record.id }));
                                setRecordSearchOpen(false);
                                setRecordSearchValue('');
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  formData.module_id === record.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              {record.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {/* Section 2: Action Item Details */}
          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Textarea
                id="title"
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = el.scrollHeight + 'px';
                  }
                }}
                value={formData.title}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, title: e.target.value }));
                  const target = e.target;
                  target.style.height = 'auto';
                  target.style.height = target.scrollHeight + 'px';
                }}
                placeholder="Enter action item title"
                required
                rows={1}
                className="min-h-[40px] resize-none overflow-hidden"
              />
            </div>

            {/* Assigned To, Due Date */}
            <div className="grid grid-cols-2 gap-4">
              {/* Assigned To */}
              <div className="space-y-2">
                <Label htmlFor="assigned_to">Assigned To</Label>
                <Select
                  value={formData.assigned_to || 'unassigned'}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      assigned_to: value === 'unassigned' ? null : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Due Date */}
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !formData.due_date && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formData.due_date
                        ? format(formData.due_date, 'dd-MMM-yyyy')
                        : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.due_date || undefined}
                      onSelect={(date) =>
                        setFormData((prev) => ({ ...prev, due_date: date || null }))
                      }
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Priority and Status */}
            <div className="grid grid-cols-2 gap-4">
              {/* Priority */}
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value: ActionItemPriority) =>
                    setFormData((prev) => ({ ...prev, priority: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full', option.dotColor)} />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value: ActionItemStatus) =>
                    setFormData((prev) => ({ ...prev, status: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full', option.dotColor)} />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Enter description or notes"
                rows={3}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Created by: {creatorName}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !formData.title.trim()}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {actionItem ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
