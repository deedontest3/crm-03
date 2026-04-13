import { useState, useMemo, useEffect, useRef } from "react";
import {
  X,
  Plus,
  Clock,
  History,
  ListTodo,
  ChevronDown,
  ChevronRight,
  Eye,
  ArrowRight,
  Check,
  MessageSquarePlus,
  Phone,
  Mail,
  Calendar,
  FileText,
  User,
  MoreHorizontal,
  Handshake,
  AlertTriangle,
  Trash2 } from
"lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle } from
"@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator } from
"@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAllUsers } from "@/hooks/useUserDisplayNames";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Deal } from "@/types/deal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useAuth } from "@/hooks/useAuth";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { Contact } from "@/components/ContactSearchableDropdown";
import { Users } from "lucide-react";

interface DealExpandedPanelProps {
  deal: Deal;
  onClose: () => void;
  onOpenActionItemModal?: (actionItem?: any) => void;
  addDetailOpen?: boolean;
  onAddDetailOpenChange?: (open: boolean) => void;
}

interface AuditLog {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  user_id: string | null;
}

interface ActionItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  created_at: string;
  module_type: string;
  module_id: string | null;
}

// Log types with icons
const LOG_TYPES = [{ value: "Note", label: "Note", icon: FileText }] as const;

type LogType = (typeof LOG_TYPES)[number]["value"];

// Format date/time for table display: HH:mm dd-MM-yy
const formatHistoryDateTime = (date: Date): string => {
  return format(date, "HH:mm dd-MM-yy");
};

// Format a value for display
const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") {
    return "[See details]";
  }
  return String(value);
};

// Parse field_changes from audit log details
interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

const parseFieldChanges = (details: Record<string, unknown> | null): FieldChange[] => {
  if (!details) return [];

  const fieldChanges = details.field_changes as Record<string, {old: unknown;new: unknown;}> | undefined;
  if (fieldChanges && typeof fieldChanges === "object") {
    return Object.entries(fieldChanges).
    filter(([key]) => !["modified_at", "modified_by", "id"].includes(key)).
    map(([field, change]) => ({
      field: field.replace(/_/g, " "),
      oldValue: formatValue(change?.old),
      newValue: formatValue(change?.new)
    }));
  }

  const oldData = details.old_data as Record<string, unknown> | undefined;
  const updatedFields = details.updated_fields as Record<string, unknown> | undefined;

  if (updatedFields && oldData) {
    return Object.keys(updatedFields).
    filter((key) => !["modified_at", "modified_by", "id"].includes(key)).
    map((field) => ({
      field: field.replace(/_/g, " "),
      oldValue: formatValue(oldData[field]),
      newValue: formatValue(updatedFields[field])
    }));
  }

  return Object.entries(details).
  filter(
    ([key, value]) =>
    ![
    "modified_at",
    "modified_by",
    "id",
    "field_changes",
    "old_data",
    "updated_fields",
    "record_data",
    "timestamp"].
    includes(key) && (
    typeof value !== "object" || value === null)
  ).
  map(([field, value]) => ({
    field: field.replace(/_/g, " "),
    oldValue: "-",
    newValue: formatValue(value)
  }));
};

// Parse audit log details to show human-readable summary
const parseChangeSummary = (action: string, details: Record<string, unknown> | null): string => {
  if (!details || typeof details !== "object") return action === "create" ? "Created deal" : action;

  // If there's already a formatted message (from manual action item logs), use it
  if (details.message && typeof details.message === "string") {
    return details.message;
  }

  const changes = parseFieldChanges(details);
  if (changes.length === 0) return action === "create" ? "Created deal" : "Updated";

  const stageChange = changes.find((c) => c.field === "stage");
  if (stageChange) {
    return `${stageChange.oldValue} → ${stageChange.newValue}`;
  }

  const first = changes[0];
  if (changes.length === 1) {
    return `${first.field}: ${first.oldValue} → ${first.newValue}`;
  }
  return `${first.field} +${changes.length - 1}`;
};

// Stakeholder types
interface DealStakeholder {
  id: string;
  deal_id: string;
  contact_id: string;
  role: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

const STAKEHOLDER_ROLES = [
{ role: "budget_owner", label: "Budget Owner", color: "bg-blue-400", borderColor: "border-l-blue-400", badgeBg: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", nameColor: "text-blue-700 dark:text-blue-300" },
{ role: "champion", label: "Champion", color: "bg-green-400", borderColor: "border-l-green-400", badgeBg: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300", nameColor: "text-green-700 dark:text-green-300" },
{ role: "influencer", label: "Influencer", color: "bg-amber-400", borderColor: "border-l-amber-400", badgeBg: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", nameColor: "text-amber-700 dark:text-amber-300" },
{ role: "objector", label: "Objector", color: "bg-red-400", borderColor: "border-l-red-400", badgeBg: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", nameColor: "text-red-700 dark:text-red-300" }] as
const;

// ── Inline add-dropdown for a single role ───────────────────────────────────
interface StakeholderAddDropdownProps {
  contacts: Contact[];
  excludeIds: string[];
  onAdd: (contact: Contact) => void;
  onCreateContact: (name: string) => Promise<Contact | null>;
  cellRef: React.RefObject<HTMLDivElement>;
}

const normalize = (s: string) =>
s.toLowerCase().replace(/[-_.,()]/g, " ").replace(/\s+/g, " ").trim();

const StakeholderAddDropdown = ({ contacts, excludeIds, onAdd, onCreateContact, cellRef }: StakeholderAddDropdownProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownWidth, setDropdownWidth] = useState(220);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next && cellRef.current) {
      setDropdownWidth(Math.round(cellRef.current.offsetWidth * 0.40));
    }
    setOpen(next);
    if (!next) setSearch("");
  };

  const filtered = useMemo(() => {
    const available = contacts.filter((c) => !excludeIds.includes(c.id));
    if (!search) return available.slice(0, 80);
    const words = normalize(search).split(" ").filter(Boolean);
    return available.
    filter((c) => {
      const combined = normalize(`${c.contact_name || ""} ${c.company_name || ""} ${c.position || ""}`);
      return words.every((w) => combined.includes(w));
    }).
    slice(0, 80);
  }, [contacts, excludeIds, search]);

  const handleCreateAndAdd = async () => {
    if (!newContactName.trim()) return;
    setIsCreating(true);
    const contact = await onCreateContact(newContactName.trim());
    setIsCreating(false);
    if (contact) {
      onAdd(contact);
      setShowCreateDialog(false);
      setOpen(false);
      setSearch("");
      setNewContactName("");
    }
  };

  return (
    <>
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center justify-center w-6 h-5 rounded hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Add contact">
          <Plus className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 z-[200]"
        style={{ width: `${Math.max(dropdownWidth, 200)}px` }}
        align="start"
        side="bottom"
        sideOffset={4}
        avoidCollisions={true}
        onWheel={(e) => e.stopPropagation()}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search contacts…"
            value={search}
            onValueChange={setSearch}
            className="h-8 text-xs" />
          <CommandList
            className="max-h-[180px] overflow-y-auto"
            onWheel={(e) => {e.stopPropagation();(e.currentTarget as HTMLElement).scrollTop += e.deltaY;}}>
            {filtered.length === 0 ?
            <div className="py-3 text-center space-y-2">
              <p className="text-xs text-muted-foreground">No contacts found.</p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  setNewContactName(search);
                  setShowCreateDialog(true);
                  setOpen(false);
                }}>
                <Plus className="h-3 w-3" />
                Create "{search}"
              </Button>
            </div> :
            <CommandGroup>
                {filtered.map((c) =>
              <CommandItem
                key={c.id}
                value={c.contact_name}
                onSelect={() => {onAdd(c);setOpen(false);setSearch("");}}
                className="cursor-pointer py-1 px-2">
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium truncate">{c.contact_name}</span>
                      {(c.company_name || c.position) &&
                  <span className="text-[10px] text-muted-foreground truncate">
                          {[c.company_name, c.position].filter(Boolean).join(" • ")}
                        </span>
                  }
                    </div>
                  </CommandItem>
              )}
              </CommandGroup>
            }
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>

    {/* Create New Contact Dialog */}
    <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Create New Contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label className="text-xs">Contact Name</Label>
            <Input
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder="Enter contact name"
              className="h-8 text-sm mt-1"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateAndAdd(); }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleCreateAndAdd} disabled={!newContactName.trim() || isCreating}>
              {isCreating ? "Creating…" : "Save & Select"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>);

};

// ── Stakeholders Section Component ──────────────────────────────────────────
const StakeholdersSection = ({ deal, queryClient }: {deal: Deal;queryClient: ReturnType<typeof useQueryClient>;}) => {
  const { user } = useAuth();
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    stakeholder: DealStakeholder | null;
  }>({ open: false, stakeholder: null });

  // Single contacts fetch shared across all 4 roles
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  useEffect(() => {
    const fetchContacts = async () => {
      const all: Contact[] = [];
      let from = 0;
      const BATCH = 1000;
      while (true) {
        const { data, error } = await supabase.
        from("contacts").
        select("id, contact_name, company_name, position, email, phone_no, region, contact_owner, contact_source, industry, linkedin, website").
        order("contact_name", { ascending: true }).
        range(from, from + BATCH - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < BATCH) break;
        from += BATCH;
      }
      setAllContacts(all);
    };
    fetchContacts();
  }, []);

  // Fetch stakeholders from junction table
  const { data: stakeholders = [] } = useQuery({
    queryKey: ["deal-stakeholders", deal.id],
    queryFn: async () => {
      const { data, error } = await supabase.
      from("deal_stakeholders").
      select("*").
      eq("deal_id", deal.id);
      if (error) {console.error("Error fetching stakeholders:", error);return [];}
      return (data || []) as DealStakeholder[];
    },
    enabled: !!deal.id
  });

  // Build contact name map from already-loaded contacts
  const contactNames = useMemo(() => {
    const map: Record<string, string> = {};
    allContacts.forEach((c) => {map[c.id] = c.contact_name;});
    return map;
  }, [allContacts]);

  const { logCreate: logStakeholderCreate, logDelete: logStakeholderDelete } = useCRUDAudit();

  const handleAddContact = async (role: string, contact: Contact) => {
    const insertData = {
      deal_id: deal.id,
      contact_id: contact.id,
      role,
      created_by: user?.id
    };
    const { data, error } = await supabase.from("deal_stakeholders").insert(insertData).select().single();
    if (error) {console.error("Error adding stakeholder:", error);return;}
    await logStakeholderCreate('deal_stakeholders', data?.id || '', { ...insertData, contact_name: contact.contact_name, deal_name: deal.deal_name });
    queryClient.invalidateQueries({ queryKey: ["deal-stakeholders", deal.id] });
  };

  const handleRemoveContact = async (stakeholderId: string) => {
    const stakeholder = stakeholders?.find(s => s.id === stakeholderId);
    const contactName = stakeholder ? contactNames[stakeholder.contact_id] : undefined;
    await supabase.from("deal_stakeholders").delete().eq("id", stakeholderId);
    await logStakeholderDelete('deal_stakeholders', stakeholderId, { ...stakeholder, contact_name: contactName, deal_name: deal.deal_name });
    queryClient.invalidateQueries({ queryKey: ["deal-stakeholders", deal.id] });
  };

  const handleCreateContact = async (name: string): Promise<Contact | null> => {
    // Look up account name to link new contact to the deal's account
    let companyName: string | null = null;
    const dealAccountId = (deal as any).account_id as string | null;
    if (dealAccountId) {
      const { data: account } = await supabase
        .from("accounts")
        .select("account_name")
        .eq("id", dealAccountId)
        .single();
      companyName = account?.account_name || deal.customer_name || null;
    } else {
      companyName = deal.customer_name || null;
    }

    const { data, error } = await supabase
      .from("contacts")
      .insert({ contact_name: name, company_name: companyName, created_by: user?.id })
      .select("id, contact_name, company_name, position, email, phone_no, region, contact_owner, contact_source, industry, linkedin, website")
      .single();
    if (error || !data) {
      console.error("Error creating contact:", error);
      return null;
    }
    // Log inline contact creation
    await logStakeholderCreate('contacts', data.id, { contact_name: name, company_name: companyName, created_from: 'deal_stakeholder_picker', deal_name: deal.deal_name });
    // Add to local contacts list
    setAllContacts((prev) => [...prev, data as Contact].sort((a, b) => a.contact_name.localeCompare(b.contact_name)));
    return data as Contact;
  };

  const promptRemove = (sh: DealStakeholder) => {
    setConfirmDialog({ open: true, stakeholder: sh });
  };

  const handleConfirmAction = async () => {
    const { stakeholder } = confirmDialog;
    if (!stakeholder) return;
    await handleRemoveContact(stakeholder.id);
    setConfirmDialog({ open: false, stakeholder: null });
  };

  return (
    <>
    <div className="px-3 pt-1.5 pb-1">
      <div className="bg-muted/20 border border-border/60 rounded-lg overflow-hidden">
        {/* Section Header */}
        <div className="flex items-center px-3 py-1.5 bg-muted/50 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Stakeholders</span>
          </div>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-2 gap-0">
          {STAKEHOLDER_ROLES.map(({ role, label, borderColor, nameColor }, idx) => {
              const roleStakeholders = stakeholders.filter((s) => s.role === role);
              // Only exclude contacts already in the SAME role (allow same contact in multiple roles)
              const excludeIds = roleStakeholders.map((s) => s.contact_id);

              const getCellRef = (el: HTMLDivElement | null) => {
                cellRefs.current[role] = el;
              };
              const cellRef = { get current() {return cellRefs.current[role] ?? null;} } as React.RefObject<HTMLDivElement>;

              return (
                <div
                  key={role}
                  ref={getCellRef}
                  className={cn(
                    "flex items-start min-w-0 px-2 py-1.5 border-l-[3px] transition-colors",
                    borderColor,
                    idx < 2 && "border-b border-border/60",
                    idx % 2 === 0 && "border-r border-border/60"
                  )}>

                {/* Label */}
                <span
                    className="text-xs font-medium text-muted-foreground shrink-0 pt-0.5 leading-5 whitespace-nowrap"
                    style={{ width: "28%" }}>
                  {label} :
                </span>

                {/* Contact name + inline actions */}
                <div className="flex flex-col gap-0.5 min-w-0 flex-1 pl-1">
                  {roleStakeholders.length === 0 ?
                    <div className="h-5 flex items-center">
                      <StakeholderAddDropdown
                        contacts={allContacts}
                        excludeIds={excludeIds}
                        onAdd={(contact) => handleAddContact(role, contact)}
                        onCreateContact={handleCreateContact}
                        cellRef={cellRef} />
                    </div> :

                    roleStakeholders.map((sh, shIdx) =>
                    <div
                      key={sh.id}
                      className="group/row flex items-center gap-1.5 min-w-0 h-5">

                        <span className="truncate text-xs font-medium leading-5 flex-1 min-w-0 text-primary">
                          {contactNames[sh.contact_id] || "…"}
                        </span>

                        {/* Remove button */}
                        <button
                        className="opacity-0 group-hover/row:opacity-60 hover:!opacity-100 transition-opacity shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => promptRemove(sh)}
                        title="Remove">
                          <X className="h-3.5 w-3.5" />
                        </button>

                        {/* Inline add button after last contact - show on hover */}
                        {shIdx === roleStakeholders.length - 1 &&
                      <div className="opacity-0 group-hover/row:opacity-60 hover:!opacity-100 transition-opacity">
                        <StakeholderAddDropdown
                          contacts={allContacts}
                          excludeIds={excludeIds}
                          onAdd={(contact) => handleAddContact(role, contact)}
                          onCreateContact={handleCreateContact}
                          cellRef={cellRef} />
                      </div>
                      }
                      </div>
                    )
                    }
                </div>
              </div>);
            })}
        </div>
      </div>
    </div>

    {/* Confirmation Dialog for Remove */}
    <AlertDialog open={confirmDialog.open} onOpenChange={(open) => {
        if (!open) setConfirmDialog({ open: false, stakeholder: null });
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Remove Stakeholder
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove "{contactNames[confirmDialog.stakeholder?.contact_id || ""] || "this contact"}" from this deal?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
              onClick={handleConfirmAction}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>);

};

export const DealExpandedPanel = ({
  deal,
  onClose,
  onOpenActionItemModal,
  addDetailOpen: externalAddDetailOpen,
  onAddDetailOpenChange
}: DealExpandedPanelProps) => {
  const { user } = useAuth();
  const [detailLogId, setDetailLogId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Unified Add Detail modal state
  const [internalAddDetailOpen, setInternalAddDetailOpen] = useState(false);
  const addDetailOpen = externalAddDetailOpen !== undefined ? externalAddDetailOpen : internalAddDetailOpen;
  const setAddDetailOpen = (open: boolean) => {
    if (!open) setAddDetailFromSection(null);
    if (onAddDetailOpenChange) onAddDetailOpenChange(open);else
    setInternalAddDetailOpen(open);
  };
  const [addDetailType, setAddDetailType] = useState<"log" | "action_item">("log");
  const [addDetailFromSection, setAddDetailFromSection] = useState<null | "log" | "action_item">(null);
  const [logType, setLogType] = useState<LogType>("Note");
  const [logMessage, setLogMessage] = useState("");
  const [isSavingLog, setIsSavingLog] = useState(false);

  // Action item fields for unified modal
  const [actionTitle, setActionTitle] = useState("");
  const [actionAssignedTo, setActionAssignedTo] = useState<string>(user?.id || "unassigned");
  const [actionDueDate, setActionDueDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return format(tomorrow, "yyyy-MM-dd");
  });
  const [actionPriority, setActionPriority] = useState("Low");
  const [actionStatus, setActionStatus] = useState("Open");
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);

  // Action items inline editing state
  const [editingDateId, setEditingDateId] = useState<string | null>(null);

  // Auto-scroll refs
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const actionItemsScrollRef = useRef<HTMLDivElement>(null);

  const { users, getUserDisplayName } = useAllUsers();
  const { logCreate, logUpdate, logDelete } = useCRUDAudit();

  // Fetch audit logs for the deal - ascending order (newest at bottom)
  const { data: auditLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["deal-audit-logs", deal.id],
    queryFn: async () => {
      const { data, error } = await supabase.
      from("security_audit_log").
      select("*").
      eq("resource_type", "deals").
      eq("resource_id", deal.id).
      order("created_at", { ascending: true }).
      limit(50);

      if (error) {
        console.error("Error fetching deal audit logs:", error);
        return [];
      }

      return (data || []) as AuditLog[];
    },
    enabled: !!deal.id
  });

  // Fetch action items from unified action_items table
  const { data: actionItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["deal-action-items-unified", deal.id],
    queryFn: async () => {
      const { data, error } = await supabase.
      from("action_items").
      select("*").
      eq("module_type", "deals").
      eq("module_id", deal.id).
      order("created_at", { ascending: true });

      if (error) {
        console.error("Error fetching deal action items:", error);
        return [];
      }

      return (data || []) as ActionItem[];
    },
    enabled: !!deal.id
  });

  // Extract unique user IDs from audit logs and action items
  const userIds = useMemo(() => {
    const logUserIds = auditLogs.map((log) => log.user_id).filter((id): id is string => !!id);
    const actionUserIds = actionItems.map((item) => item.assigned_to).filter((id): id is string => !!id);
    const ids = [...logUserIds, ...actionUserIds];
    return [...new Set(ids)];
  }, [auditLogs, actionItems]);

  // Fetch display names for users
  const { displayNames } = useUserDisplayNames(userIds);

  const isLoading = logsLoading || itemsLoading;

  // Auto-refresh history logs when panel opens
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["deal-audit-logs", deal.id] });
  }, [deal.id, queryClient]);

  // Filter history: only manual logs and action item status changes
  const manualAndStatusLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const details = log.details as any;
      return details?.manual_entry === true || details?.action_item_title;
    });
  }, [auditLogs]);

  // Split action items: active vs completed
  const activeActionItems = useMemo(() => {
    return actionItems.filter((item) => item.status === "Open" || item.status === "In Progress");
  }, [actionItems]);

  const completedActionItems = useMemo(() => {
    return actionItems.filter((item) => item.status === "Completed" || item.status === "Cancelled");
  }, [actionItems]);

  // Merged history: manual logs + completed action items, sorted ascending
  const mergedHistory = useMemo(() => {
    const mappedLogs = manualAndStatusLogs.map((log) => {
      const details = log.details as any;
      let message = details?.message || parseChangeSummary(log.action, log.details);

      // Override with action item title + new status for both old and new format logs
      if (details?.action_item_title && details?.field_changes?.status) {
        message = `${details.action_item_title} → ${details.field_changes.status.new}`;
      }

      return {
        id: log.id,
        message,
        user_id: log.user_id,
        created_at: log.created_at,
        isCompletedAction: false,
        originalLog: log
      };
    });

    return [...mappedLogs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [manualAndStatusLogs]);

  // Auto-scroll both sections to bottom when data changes
  useEffect(() => {
    setTimeout(() => {
      if (historyScrollRef.current) {
        historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight;
      }
      if (actionItemsScrollRef.current) {
        actionItemsScrollRef.current.scrollTop = actionItemsScrollRef.current.scrollHeight;
      }
    }, 100);
  }, [mergedHistory, activeActionItems]);

  // Handle adding a manual log entry
  const handleAddLog = async () => {
    if (!logMessage.trim() || !user) return;

    setIsSavingLog(true);
    try {
      const { error } = await supabase.rpc('log_security_event', {
        p_action: logType.toUpperCase(),
        p_resource_type: 'deals',
        p_resource_id: deal.id,
        p_details: {
          message: logMessage.trim(),
          log_type: logType,
          manual_entry: true
        }
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["deal-audit-logs", deal.id] });

      setLogMessage("");
      setLogType("Note");
      setAddDetailOpen(false);
    } catch (error) {
      console.error("Error adding log:", error);
    } finally {
      setIsSavingLog(false);
    }
  };

  // Handle adding action item from unified modal
  const handleAddActionItem = async () => {
    if (!actionTitle.trim() || !user) return;

    setIsSavingLog(true);
    try {
      const { data: insertedItem, error } = await supabase.from("action_items").insert({
        title: actionTitle.trim(),
        module_type: "deals",
        module_id: deal.id,
        created_by: user.id,
        assigned_to: actionAssignedTo === "unassigned" ? null : actionAssignedTo,
        due_date: actionDueDate || null,
        priority: actionPriority,
        status: actionStatus
      }).select('id').single();

      if (error) throw error;

      // Log the action item creation with actual ID
      await logCreate('action_items', insertedItem?.id || '', {
        title: actionTitle.trim(),
        module_type: 'deals',
        module_id: deal.id,
        deal_name: deal.deal_name,
        assigned_to: actionAssignedTo === "unassigned" ? null : actionAssignedTo,
        due_date: actionDueDate || null,
        priority: actionPriority,
        status: actionStatus
      });

      queryClient.invalidateQueries({ queryKey: ["deal-action-items-unified", deal.id] });

      // Reset form
      setActionTitle("");
      setActionAssignedTo(user?.id || "unassigned");
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setActionDueDate(format(tomorrow, "yyyy-MM-dd"));
      setActionPriority("Low");
      setActionStatus("Open");
      setMoreOptionsOpen(false);
      setAddDetailOpen(false);
    } catch (error) {
      console.error("Error adding action item:", error);
    } finally {
      setIsSavingLog(false);
    }
  };

  const handleSaveDetail = () => {
    if (addDetailType === "log") {
      handleAddLog();
    } else {
      handleAddActionItem();
    }
  };

  const statusDotColor: Record<string, string> = {
    Open: "bg-blue-500",
    "In Progress": "bg-yellow-500",
    Completed: "bg-green-500",
    Cancelled: "bg-muted-foreground"
  };

  // Hidden internal fields
  const HIDDEN_FIELDS = new Set(["id", "created_by", "modified_by", "account_id"]);

  const toTitleCase = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const isUUID = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

  const formatDetailValue = (key: string, val: any): string => {
    if (val === null || val === undefined) return "--";
    if (typeof val === "string" && val.match(/^\d{4}-\d{2}-\d{2}(T|\s)/)) {
      try {
        return format(new Date(val), "MMM d, yyyy h:mm a");
      } catch {
        return val;
      }
    }
    if (typeof val === "string" && val.match(/^\d{4}-\d{2}-\d{2}$/)) {
      try {
        return format(new Date(val + "T00:00:00"), "MMM d, yyyy");
      } catch {
        return val;
      }
    }
    if (typeof val === "string" && isUUID(val)) return val.slice(0, 8) + "…";
    if (typeof val === "number" && (key.includes("revenue") || key.includes("contract_value") || key === "budget"))
    return val.toLocaleString();
    if (typeof val === "number" && key === "probability") return `${val}%`;
    return String(val);
  };

  const renderFormattedDetails = (details: any) => {
    if (!details || typeof details !== "object") return null;

    const { module, status, operation, timestamp, field_changes, old_data, updated_fields, record_data, ...rest } =
    details;

    const remainingObjectData = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    );
    const recordData =
    record_data ||
    old_data ||
    updated_fields || (
    Object.keys(remainingObjectData).length > 0 ? remainingObjectData : null);

    return (
      <div className="space-y-3">
        {(module || status || operation) &&
        <div className="flex flex-wrap gap-2 items-center">
            {module &&
          <Badge variant="outline" className="text-xs">
                {module}
              </Badge>
          }
            {operation &&
          <Badge variant="secondary" className="text-xs">
                {operation}
              </Badge>
          }
            {status &&
          <Badge variant={status === "Success" ? "default" : "destructive"} className="text-xs">
                {status}
              </Badge>
          }
            {timestamp &&
          <span className="text-xs text-muted-foreground ml-auto">
                {(() => {
              try {
                return format(new Date(timestamp), "MMM d, yyyy h:mm a");
              } catch {
                return timestamp;
              }
            })()}
              </span>
          }
          </div>
        }

        {field_changes && typeof field_changes === "object" && Object.keys(field_changes).length > 0 &&
        <div>
            <span className="text-xs font-medium text-muted-foreground block mb-1">Field Changes</span>
            <div className="rounded-md border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="py-1.5 px-2 text-xs h-auto">Field</TableHead>
                    <TableHead className="py-1.5 px-2 text-xs h-auto">Old Value</TableHead>
                    <TableHead className="py-1.5 px-2 text-xs h-auto w-[20px]"></TableHead>
                    <TableHead className="py-1.5 px-2 text-xs h-auto">New Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(field_changes).
                filter(([key]) => !HIDDEN_FIELDS.has(key)).
                map(([key, change]: [string, any]) =>
                <TableRow key={key}>
                        <TableCell className="py-1.5 px-2 text-xs text-muted-foreground">{toTitleCase(key)}</TableCell>
                        <TableCell className="py-1.5 px-2 text-xs">{formatDetailValue(key, change?.old)}</TableCell>
                        <TableCell className="py-1.5 px-1 w-[20px]">
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        </TableCell>
                        <TableCell className="py-1.5 px-2 text-xs font-medium">
                          {formatDetailValue(key, change?.new)}
                        </TableCell>
                      </TableRow>
                )}
                </TableBody>
              </Table>
            </div>
          </div>
        }

        {recordData && typeof recordData === "object" &&
        <div>
            <span className="text-xs font-medium text-muted-foreground block mb-1">Record Snapshot</span>
            <div className="rounded-md border border-border/50 bg-muted/10 p-2 space-y-1 max-h-48 overflow-auto">
              {Object.entries(recordData).
            filter(([key, val]) => !HIDDEN_FIELDS.has(key) && val !== null && val !== undefined).
            map(([key, val]) =>
            <div key={key} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground min-w-[120px] flex-shrink-0">{toTitleCase(key)}</span>
                    <span className="text-foreground break-all">{formatDetailValue(key, val)}</span>
                  </div>
            )}
            </div>
          </div>
        }
      </div>);

  };

  const selectedLog = detailLogId ? auditLogs.find((l) => l.id === detailLogId) : null;

  // Inline update handlers for action items
  const invalidateActionItems = () => {
    queryClient.invalidateQueries({ queryKey: ["deal-action-items-unified", deal.id] });
  };

  const handleStatusChange = async (id: string, status: string) => {
    const item = actionItems.find((i) => i.id === id);
    const oldStatus = item?.status;
    await supabase.from("action_items").update({ status, updated_at: new Date().toISOString() }).eq("id", id);

    // Log ALL status changes via useCRUDAudit
    await logUpdate('action_items', id, { status }, { status: oldStatus, title: item?.title, deal_name: deal.deal_name });

    if (status === "Completed" || status === "Cancelled") {
      queryClient.invalidateQueries({ queryKey: ["deal-audit-logs", deal.id] });
    }

    invalidateActionItems();
  };

  const handleAssignedToChange = async (id: string, userId: string | null) => {
    const item = actionItems.find((i) => i.id === id);
    const oldAssignedTo = item?.assigned_to;
    await supabase.from("action_items").update({ assigned_to: userId, updated_at: new Date().toISOString() }).eq("id", id);
    await logUpdate('action_items', id, { assigned_to: userId }, { assigned_to: oldAssignedTo, title: item?.title, deal_name: deal.deal_name });
    invalidateActionItems();
  };

  const handleDueDateChange = async (id: string, date: string | null) => {
    const item = actionItems.find((i) => i.id === id);
    const oldDueDate = item?.due_date;
    await supabase.from("action_items").update({ due_date: date, updated_at: new Date().toISOString() }).eq("id", id);
    await logUpdate('action_items', id, { due_date: date }, { due_date: oldDueDate, title: item?.title, deal_name: deal.deal_name });
    invalidateActionItems();
  };

  const handleDeleteActionItem = async (id: string) => {
    const item = actionItems.find((i) => i.id === id);
    await supabase.from("action_items").delete().eq("id", id);
    await logDelete('action_items', id, { ...item, deal_name: deal.deal_name });
    invalidateActionItems();
  };

  const handleDueDateBlur = (itemId: string, value: string) => {
    handleDueDateChange(itemId, value || null);
    setEditingDateId(null);
  };

  const handleActionItemClick = (actionItem: ActionItem) => {
    if (onOpenActionItemModal) {
      onOpenActionItemModal(actionItem);
    }
  };

  return (
    <>
      <div
        className="h-full w-full bg-card border border-border/50 rounded-lg shadow-lg flex flex-col overflow-hidden"
        onKeyDown={(e) => e.key === "Escape" && onClose()}>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-1">
          {/* Stakeholders Section */}
          <div className="shrink-0 max-h-[40%] overflow-y-auto">
            <StakeholdersSection deal={deal} queryClient={queryClient} />
          </div>

          {/* History Section */}
          <div className="px-3 pt-1 pb-0.5 flex flex-col flex-1 min-h-0">
            <div className="bg-muted/20 border border-border/60 rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="flex-1 min-h-0 overflow-y-auto" ref={historyScrollRef}>
                {isLoading ?
                <div className="flex items-center justify-center py-6">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                  </div> :

                <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="text-[11px] bg-muted/50">
                        <TableHead className="h-7 px-1" style={{ width: "3%" }}></TableHead>
                        <TableHead className="h-7 px-2 text-[11px] font-bold" style={{ width: "74%" }}>
                          Updates
                        </TableHead>
                        <TableHead className="h-7 px-2 text-[11px] font-bold" style={{ width: "10%" }}>
                          By
                        </TableHead>
                        <TableHead className="h-7 px-2 text-[11px] font-bold" style={{ width: "10%" }}>
                          Time
                        </TableHead>
                        <TableHead className="h-7 px-1" style={{ width: "3%" }}></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mergedHistory.length === 0 ?
                    <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                            <div className="flex items-center justify-center">
                              <History className="h-4 w-4 mr-2" />
                              <span className="text-xs">No history yet</span>
                            </div>
                          </TableCell>
                        </TableRow> :

                    mergedHistory.map((entry, index) =>
                    <TableRow key={entry.id} className="text-xs group cursor-pointer hover:bg-muted/30">
                            <TableCell className="py-1.5 px-1 text-[11px] text-muted-foreground text-center">
                              {index + 1}
                            </TableCell>
                            <TableCell className="py-1.5 px-2">
                              {entry.originalLog ?
                        <button
                          onClick={() => setDetailLogId(entry.originalLog!.id)}
                          className="hover:underline text-left whitespace-normal break-words text-primary font-normal text-sm">

                                  {entry.message}
                                </button> :

                        <span className="text-left whitespace-normal break-words text-xs text-muted-foreground">
                                  {entry.message}
                                </span>
                        }
                            </TableCell>
                            <TableCell className="py-1.5 px-2 text-muted-foreground whitespace-nowrap text-[11px]">
                              {entry.user_id ?
                        displayNames[entry.user_id] || getUserDisplayName(entry.user_id) || "..." :
                        "-"}
                            </TableCell>
                            <TableCell className="py-1.5 px-2 text-[11px] text-muted-foreground whitespace-nowrap w-24">
                              {formatHistoryDateTime(new Date(entry.created_at))}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()} className="py-1.5 px-1 w-8">
                              {entry.originalLog &&
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setDetailLogId(entry.originalLog!.id)}>

                                  <Eye className="h-3 w-3" />
                                </Button>
                        }
                            </TableCell>
                          </TableRow>
                    )
                    }
                    </TableBody>
                  </Table>
                }
              </div>
              <div className="flex justify-end px-2 py-1 border-t border-border/40">
                <button
                  onClick={() => {
                    setAddDetailType("log");
                    setAddDetailFromSection("log");
                    setAddDetailOpen(true);
                  }}
                  className="h-7 w-7 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center hover:bg-primary/90 transition-colors">

                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Action Items Section */}
          <div className="px-3 pt-0.5 pb-1 flex flex-col flex-1 min-h-0">
            <div className="bg-muted/20 border border-border/60 rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="flex-1 min-h-0 overflow-y-auto" ref={actionItemsScrollRef}>
                {isLoading ?
                <div className="flex items-center justify-center py-6">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                  </div> :

                <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="text-[11px] bg-muted/50">
                        <TableHead className="h-7 px-1" style={{ width: "3%" }}></TableHead>
                        <TableHead className="h-7 px-2 text-[11px] font-bold" style={{ width: "70%" }}>
                          Action Items
                        </TableHead>
                        <TableHead className="h-7 px-2 text-[11px] font-bold" style={{ width: "9%" }}>
                          Assigned
                        </TableHead>
                        <TableHead className="h-7 px-2 text-[11px] font-bold" style={{ width: "8%" }}>
                          Due
                        </TableHead>
                        <TableHead className="h-7 px-1 text-[11px] font-bold text-center" style={{ width: "7%" }}>
                          Status
                        </TableHead>
                        <TableHead className="h-7 px-1" style={{ width: "3%" }}></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeActionItems.length === 0 ?
                    <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                            <div className="flex flex-col items-center justify-center">
                              <ListTodo className="h-4 w-4 mb-1" />
                              <span className="text-xs">No active action items</span>
                            </div>
                          </TableCell>
                        </TableRow> :

                    activeActionItems.map((item, index) =>
                    <TableRow
                      key={item.id}
                      className="text-xs group cursor-pointer hover:bg-muted/30"
                      onClick={() => handleActionItemClick(item)}>

                            <TableCell className="py-1.5 px-1 text-[11px] text-muted-foreground text-center">
                              {index + 1}
                            </TableCell>

                            {/* Action Item */}
                            <TableCell className="py-1.5 px-2">
                              <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActionItemClick(item);
                          }}
                          className="hover:underline text-left whitespace-normal break-words text-primary font-normal text-sm">

                                {item.title}
                              </button>
                            </TableCell>

                            {/* Assigned To */}
                            <TableCell onClick={(e) => e.stopPropagation()} className="py-1.5 px-2 text-xs">
                              <Select
                          value={item.assigned_to || "unassigned"}
                          onValueChange={(value) =>
                          handleAssignedToChange(item.id, value === "unassigned" ? null : value)
                          }>

                                <SelectTrigger className="h-6 w-auto min-w-0 text-[11px] border-0 bg-transparent hover:bg-muted/50 px-0 [&>svg]:hidden">
                                  <SelectValue>
                                    <span className="truncate">
                                      {item.assigned_to ? getUserDisplayName(item.assigned_to) : "Unassigned"}
                                    </span>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unassigned">Unassigned</SelectItem>
                                  {users.map((u) =>
                            <SelectItem key={u.id} value={u.id}>
                                      {u.display_name}
                                    </SelectItem>
                            )}
                                </SelectContent>
                              </Select>
                            </TableCell>

                            {/* Due Date */}
                            <TableCell
                        onClick={(e) => e.stopPropagation()}
                        className="py-1.5 px-2 text-xs whitespace-nowrap">

                              {editingDateId === item.id ?
                        <Input
                          type="date"
                          defaultValue={item.due_date || ""}
                          onBlur={(e) => handleDueDateBlur(item.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                            handleDueDateBlur(item.id, (e.target as HTMLInputElement).value);else
                            if (e.key === "Escape") setEditingDateId(null);
                          }}
                          autoFocus
                          className="h-6 w-[110px] text-[11px]" /> :


                        <button onClick={() => setEditingDateId(item.id)} className="hover:underline text-[11px]">
                                  {item.due_date ? format(new Date(item.due_date), "dd-MM-yy") : "—"}
                                </button>
                        }
                            </TableCell>

                            {/* Status - dot only */}
                            <TableCell onClick={(e) => e.stopPropagation()} className="py-1.5 px-1 text-center">
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex justify-center">
                                      <Select
                                  value={item.status}
                                  onValueChange={(value) => handleStatusChange(item.id, value)}>

                                        <SelectTrigger className="h-6 w-6 min-w-0 border-0 bg-transparent hover:bg-muted/50 px-0 justify-center [&>svg]:hidden">
                                          <span
                                      className={cn(
                                        "w-2 h-2 rounded-full flex-shrink-0",
                                        statusDotColor[item.status] || "bg-muted-foreground"
                                      )} />

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

                            {/* Actions */}
                            <TableCell onClick={(e) => e.stopPropagation()} className="py-1.5 px-1">
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-center">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
                                      <MoreHorizontal className="h-3.5 w-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleActionItemClick(item)}>Edit</DropdownMenuItem>
                                    {item.status !== "Completed" &&
                              <DropdownMenuItem onClick={() => handleStatusChange(item.id, "Completed")}>
                                        Mark Complete
                                      </DropdownMenuItem>
                              }
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                onClick={() => handleDeleteActionItem(item.id)}
                                className="text-destructive focus:text-destructive">

                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                    )
                    }
                    </TableBody>
                  </Table>
                }
              </div>
              <div className="flex justify-end px-2 py-1 border-t border-border/40">
                <button
                  onClick={() => {
                    setAddDetailType("action_item");
                    setAddDetailFromSection("action_item");
                    setAddDetailOpen(true);
                  }}
                  className="h-7 w-7 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center hover:bg-primary/90 transition-colors">

                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Log Dialog */}
      <Dialog open={!!detailLogId} onOpenChange={() => setDetailLogId(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">History Details</DialogTitle>
          </DialogHeader>
          {selectedLog &&
          (() => {
            const details = selectedLog.details as Record<string, any> | null;
            const isManualEntry = details?.manual_entry === true;
            const changes = parseFieldChanges(selectedLog.details);
            const updaterName = selectedLog.user_id ? displayNames[selectedLog.user_id] || "Unknown" : "-";

            return (
              <ScrollArea className="flex-1 max-h-[calc(85vh-80px)]">
                  <div className="space-y-4 text-sm pr-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-muted-foreground text-xs">Updated By</span>
                        <p className="font-medium">{updaterName}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Date</span>
                        <p>{format(new Date(selectedLog.created_at), "HH:mm dd-MM-yy")}</p>
                      </div>
                    </div>

                    {details?.message && !details?.action_item_title &&
                  <div>
                        <span className="text-muted-foreground text-xs block mb-1">Update Message</span>
                        <p className="text-sm bg-muted/30 rounded-md p-2 whitespace-pre-wrap break-words">
                          {String(details.message)}
                        </p>
                      </div>
                  }

                    {details?.action_item_title &&
                  <>
                        <div>
                          <span className="text-muted-foreground text-xs block mb-1">Action Item Name</span>
                          <p className="text-sm font-medium">{String(details.action_item_title)}</p>
                        </div>
                        {(details?.action_item_status || details?.field_changes?.status?.new) &&
                    <div>
                            <span className="text-muted-foreground text-xs block mb-1">Current Status</span>
                            <p className="text-sm font-medium">
                              {String(details?.field_changes?.status?.new || details?.action_item_status)}
                            </p>
                          </div>
                    }
                      </>
                  }

                    {!details?.message && !details?.action_item_title && selectedLog.action === "create" &&
                  <p className="text-muted-foreground text-xs italic">Deal was created</p>
                  }
                  </div>
                </ScrollArea>);

          })()}
        </DialogContent>
      </Dialog>

      {/* Unified Add Detail Modal */}
      <Dialog open={addDetailOpen} onOpenChange={setAddDetailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              {addDetailType === "action_item" ? "Add Action Item" : "Add Update"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {addDetailFromSection === null &&
            <div className="flex gap-1 p-1 bg-muted rounded-md">
                <button
                type="button"
                onClick={() => setAddDetailType("log")}
                className={cn(
                  "flex-1 text-xs py-1.5 px-3 rounded-sm font-medium transition-colors",
                  addDetailType === "log" ?
                  "bg-background text-foreground shadow-sm" :
                  "text-muted-foreground hover:text-foreground"
                )}>

                  Update
                </button>
                <button
                type="button"
                onClick={() => setAddDetailType("action_item")}
                className={cn(
                  "flex-1 text-xs py-1.5 px-3 rounded-sm font-medium transition-colors",
                  addDetailType === "action_item" ?
                  "bg-background text-foreground shadow-sm" :
                  "text-muted-foreground hover:text-foreground"
                )}>

                  Action Item
                </button>
              </div>
            }

            {addDetailType === "log" ?
            <>
                <div className="space-y-2">
                  <Textarea
                  value={logMessage}
                  onChange={(e) => setLogMessage(e.target.value)}
                  placeholder="Enter update..."
                  className="min-h-[100px] text-sm" />

                </div>
              </> :

            <>
                <div className="space-y-2">
                  <Input
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  placeholder="Action item title..."
                  className="h-9 text-sm" />

                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Assigned To</Label>
                    <Select value={actionAssignedTo} onValueChange={setActionAssignedTo}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users.map((u) =>
                      <SelectItem key={u.id} value={u.id}>
                            {u.display_name}
                          </SelectItem>
                      )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Due Date</Label>
                    <Input
                    type="date"
                    value={actionDueDate}
                    onChange={(e) => setActionDueDate(e.target.value)}
                    className="h-9 text-sm" />

                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Priority</Label>
                    <Select value={actionPriority} onValueChange={setActionPriority}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="High">High</SelectItem>
                        <SelectItem value="Medium">Medium</SelectItem>
                        <SelectItem value="Low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Status</Label>
                    <Select value={actionStatus} onValueChange={setActionStatus}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Open">Open</SelectItem>
                        <SelectItem value="In Progress">In Progress</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            }

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddDetailOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveDetail}
                disabled={
                addDetailType === "log" ? !logMessage.trim() || isSavingLog : !actionTitle.trim() || isSavingLog
                }>

                {isSavingLog ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>);

};