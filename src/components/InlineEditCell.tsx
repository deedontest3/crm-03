import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Check, X, Edit3 } from "lucide-react";
import { Deal, DealStage, DEAL_STAGES, STAGE_COLORS, getStageLabel } from "@/types/deal";
import { cn } from "@/lib/utils";

interface InlineEditCellProps {
  value: any;
  field: string;
  dealId: string;
  onSave: (dealId: string, field: string, value: any) => void;
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'boolean' | 'stage' | 'priority' | 'currency';
  options?: string[];
  isEditing?: boolean;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

const AUTO_SAVE_TYPES = ['stage', 'priority', 'select', 'boolean', 'date'];

export const InlineEditCell = ({
  value,
  field,
  dealId,
  onSave,
  type = 'text',
  options = [],
  isEditing: controlledIsEditing,
  onEditStart,
  onEditEnd,
}: InlineEditCellProps) => {
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? '');
  const containerRef = useRef<HTMLDivElement>(null);

  const isEditing = controlledIsEditing ?? internalIsEditing;
  const isAutoSave = AUTO_SAVE_TYPES.includes(type);

  // Sync editValue with value prop when not editing
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value ?? '');
    }
  }, [value, isEditing]);

  const handleSave = useCallback(() => {
    let processedValue = editValue;
    if (type === 'number' || type === 'priority') {
      processedValue = parseFloat(editValue) || 0;
    } else if (type === 'boolean') {
      processedValue = Boolean(editValue);
    } else if (type === 'currency') {
      processedValue = parseFloat(editValue) || 0;
    }
    onSave(dealId, field, processedValue);
    if (onEditEnd) onEditEnd();
    else setInternalIsEditing(false);
  }, [editValue, type, dealId, field, onSave, onEditEnd]);

  const handleCancel = useCallback(() => {
    setEditValue(value ?? '');
    if (onEditEnd) onEditEnd();
    else setInternalIsEditing(false);
  }, [value, onEditEnd]);

  const startEditing = useCallback(() => {
    setEditValue(value ?? '');
    if (onEditStart) onEditStart();
    else setInternalIsEditing(true);
  }, [value, onEditStart]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  // Click-outside detection for non-auto-save types
  useEffect(() => {
    if (!isEditing || isAutoSave) return;
  const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleSave();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditing, isAutoSave, handleCancel]);

  // Auto-save handlers for select-based types
  const handleSelectAutoSave = useCallback((newValue: string) => {
    setEditValue(newValue);
    let processedValue: any = newValue;
    if (type === 'priority') {
      processedValue = parseInt(newValue);
    }
    onSave(dealId, field, processedValue);
    if (onEditEnd) onEditEnd();
    else setInternalIsEditing(false);
  }, [dealId, field, type, onSave, onEditEnd]);

  // Auto-save handler for boolean
  const handleBooleanAutoSave = useCallback((checked: boolean) => {
    onSave(dealId, field, checked);
    if (onEditEnd) onEditEnd();
    else setInternalIsEditing(false);
  }, [dealId, field, onSave, onEditEnd]);

  // Auto-save handler for date on blur
  const handleDateBlurSave = useCallback(() => {
    let processedValue = editValue;
    onSave(dealId, field, processedValue);
    if (onEditEnd) onEditEnd();
    else setInternalIsEditing(false);
  }, [editValue, dealId, field, onSave, onEditEnd]);

  const formatDisplayValue = () => {
    if (value === null || value === undefined || value === '') return '-';
    if (type === 'currency') {
      return Number(value).toLocaleString();
    }
    if (type === 'date' && value) {
      const d = new Date(value);
      return isNaN(d.getTime())
        ? value
        : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    if (type === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    if (type === 'priority' && value) {
      const priorityLabels: Record<number, string> = { 1: 'Highest', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Lowest' };
      return `${value} (${priorityLabels[value] || 'Unknown'})`;
    }
    return String(value);
  };

  if (!isEditing) {
    const isStage = type === 'stage' && value;
    const isProjectName = field === 'project_name';
    const stageColorClass = isStage ? STAGE_COLORS[value as DealStage] || '' : '';

    return (
      <div
        className="group flex items-center justify-between cursor-pointer hover:bg-muted/50 p-1 rounded transition-colors min-h-[32px]"
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        title="Click to edit"
      >
        {isStage ? (
          <span className={cn("text-xs font-semibold", stageColorClass)}>{getStageLabel(value as DealStage)}</span>
        ) : (
          <span className={cn("truncate flex-1 text-sm", isProjectName && "text-primary font-medium")}>
            {formatDisplayValue()}
          </span>
        )}
        <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-1 text-muted-foreground" />
      </div>
    );
  }

  const renderEditControl = () => {
    switch (type) {
      case 'textarea':
        return (
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full min-h-[60px] resize-none text-sm"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-8 text-sm"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        );
      case 'currency':
        return (
          <Input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-8 text-sm"
            placeholder="Enter amount"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        );
      case 'date':
        return (
          <Input
            type="date"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full h-8 text-sm"
            autoFocus
            onBlur={handleDateBlurSave}
          />
        );
      case 'boolean':
        return (
          <div className="flex items-center gap-2 py-1">
            <Switch
              checked={Boolean(editValue)}
              onCheckedChange={handleBooleanAutoSave}
            />
            <span className="text-sm text-muted-foreground">
              {Boolean(editValue) ? 'Yes' : 'No'}
            </span>
          </div>
        );
      case 'stage':
        return (
          <Select value={editValue} onValueChange={handleSelectAutoSave}>
            <SelectTrigger className="w-full h-8 text-sm min-w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEAL_STAGES.map((stage) => (
                <SelectItem key={stage} value={stage}>{getStageLabel(stage)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'priority':
        return (
          <Select value={editValue?.toString()} onValueChange={handleSelectAutoSave}>
            <SelectTrigger className="w-full h-8 text-sm min-w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((num) => (
                <SelectItem key={num} value={num.toString()}>
                  P{num} {num === 1 ? '(Highest)' : num === 2 ? '(High)' : num === 3 ? '(Medium)' : num === 4 ? '(Low)' : '(Lowest)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'select':
        return (
          <Select value={editValue} onValueChange={handleSelectAutoSave}>
            <SelectTrigger className="w-full h-8 text-sm min-w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      default:
        return (
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-8 text-sm"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        );
    }
  };

  return (
    <div ref={containerRef} className="relative animate-fade-in" onClick={(e) => e.stopPropagation()}>
      <div className="min-w-[60px]">
        {renderEditControl()}
      </div>
      {!isAutoSave && (
        <div className="absolute -top-1 -right-1 flex gap-0.5 z-10">
          <Button size="sm" variant="ghost" onClick={handleSave} className="h-5 w-5 p-0 bg-background border shadow-sm hover:bg-green-100" title="Save">
            <Check className="w-3 h-3 text-green-600" />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} className="h-5 w-5 p-0 bg-background border shadow-sm hover:bg-red-100" title="Cancel">
            <X className="w-3 h-3 text-red-600" />
          </Button>
        </div>
      )}
    </div>
  );
};
