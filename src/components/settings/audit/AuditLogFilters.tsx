import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Search, CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { FilterCategory, getDatePresets } from "./auditLogUtils";

export type ModuleFilter = 'all' | 'deals' | 'contacts' | 'leads' | 'action_items' | 'accounts' | 'deal_stakeholders' | 'page_permissions' | 'email_templates' | 'notification_preferences';

interface AuditLogFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  category: FilterCategory;
  onCategoryChange: (value: FilterCategory) => void;
  moduleFilter: ModuleFilter;
  onModuleFilterChange: (value: ModuleFilter) => void;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  onDateFromChange: (date: Date | undefined) => void;
  onDateToChange: (date: Date | undefined) => void;
}

export const AuditLogFilters = ({
  searchTerm, onSearchChange,
  category, onCategoryChange,
  moduleFilter, onModuleFilterChange,
  dateFrom, dateTo,
  onDateFromChange, onDateToChange,
}: AuditLogFiltersProps) => {
  const presets = getDatePresets();
  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search logs..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      <Select value={category} onValueChange={(v) => onCategoryChange(v as FilterCategory)}>
        <SelectTrigger className="w-[170px] h-8 text-sm">
          <SelectValue placeholder="Filter by type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all_except_auth">All (except Auth)</SelectItem>
          <SelectItem value="all">All Activities</SelectItem>
          <SelectItem value="record_changes">Record Changes</SelectItem>
          <SelectItem value="activities">Activities (Notes, Emails…)</SelectItem>
          <SelectItem value="authentication">Authentication</SelectItem>
          <SelectItem value="user_management">User Management</SelectItem>
          <SelectItem value="export">Data Import/Export</SelectItem>
        </SelectContent>
      </Select>

      <Select value={moduleFilter} onValueChange={(v) => onModuleFilterChange(v as ModuleFilter)}>
        <SelectTrigger className="w-[150px] h-8 text-sm">
          <SelectValue placeholder="Module" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Modules</SelectItem>
          <SelectItem value="deals">Deals</SelectItem>
          <SelectItem value="leads">Leads</SelectItem>
          <SelectItem value="contacts">Contacts</SelectItem>
          <SelectItem value="accounts">Accounts</SelectItem>
          <SelectItem value="action_items">Action Items</SelectItem>
          <SelectItem value="deal_stakeholders">Stakeholders</SelectItem>
          <SelectItem value="page_permissions">Page Access</SelectItem>
          <SelectItem value="email_templates">Email Templates</SelectItem>
          <SelectItem value="notification_preferences">Notifications</SelectItem>
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs px-2.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            {dateFrom ? format(dateFrom, 'MMM dd') : 'From'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={dateFrom} onSelect={onDateFromChange} initialFocus />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs px-2.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            {dateTo ? format(dateTo, 'MMM dd') : 'To'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={dateTo} onSelect={onDateToChange} initialFocus />
        </PopoverContent>
      </Popover>

      {hasDateFilter && (
        <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => { onDateFromChange(undefined); onDateToChange(undefined); }}>
          <X className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
      )}

      <span className="text-muted-foreground text-xs">|</span>
      {presets.map(preset => (
        <Button
          key={preset.label}
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={() => { onDateFromChange(preset.from); onDateToChange(preset.to); }}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
};
