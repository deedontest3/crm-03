import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreHorizontal, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { ContactColumnConfig } from "../ContactColumnCustomizer";
import { AccountViewModal } from "../AccountViewModal";
import { LinkedDealsDialog } from "../LinkedDealsDialog";
import { cn } from "@/lib/utils";
import { useContactColumnWidths } from "@/hooks/useContactColumnWidths";
import { AppLoader } from "@/components/ui/loader";

interface Contact {
  id: string;
  contact_name: string;
  company_name?: string;
  position?: string;
  email?: string;
  phone_no?: string;
  region?: string;
  contact_owner?: string;
  created_by?: string;
  linkedin?: string;
  website?: string;
  contact_source?: string;
  industry?: string;
  description?: string;
  last_activity_time?: string;
  [key: string]: any;
}

interface ContactTableBodyProps {
  loading: boolean;
  pageContacts: Contact[];
  visibleColumns: ContactColumnConfig[];
  selectedContacts: string[];
  setSelectedContacts: React.Dispatch<React.SetStateAction<string[]>>;
  onEdit: (contact: Contact) => void;
  onDelete: (id: string) => void;
  searchTerm: string;
  onRefresh?: () => void;
  sortField: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
  dealCounts?: Record<string, number>;
  emptyStateMessage?: string;
}


export const ContactTableBody = ({
  loading,
  pageContacts,
  visibleColumns,
  selectedContacts,
  setSelectedContacts,
  onEdit,
  onDelete,
  searchTerm,
  onRefresh,
  sortField,
  sortDirection,
  onSort,
  dealCounts = {},
  emptyStateMessage,
}: ContactTableBodyProps) => {
  const [viewAccount, setViewAccount] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [linkedDealsContact, setLinkedDealsContact] = useState<{ id: string; name: string } | null>(null);
  const [showLinkedDealsDialog, setShowLinkedDealsDialog] = useState(false);
  const { columnWidths, updateColumnWidth } = useContactColumnWidths();

  // Column resize state — use refs for start values so the window listeners
  // don't have to be torn down and re-attached on every mousemove tick.
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const resizingRef = useRef<string | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = (e: React.MouseEvent, field: string) => {
    if (field === 'linked_deals') return;
    resizingRef.current = field;
    setIsResizing(field);
    startXRef.current = e.clientX;
    startWidthRef.current = columnWidths[field] || 120;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const field = resizingRef.current;
    if (!field) return;
    const deltaX = e.clientX - startXRef.current;
    const newWidth = Math.max(60, startWidthRef.current + deltaX);
    updateColumnWidth(field, newWidth);
  }, [updateColumnWidth]);

  const handleMouseUp = useCallback(() => {
    resizingRef.current = null;
    setIsResizing(null);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const contactOwnerIds = useMemo(
    () => [...new Set(pageContacts.map(c => c.contact_owner).filter(Boolean))] as string[],
    [pageContacts]
  );
  const createdByIds = useMemo(
    () => [...new Set(pageContacts.map(c => c.created_by).filter(Boolean))] as string[],
    [pageContacts]
  );
  const allUserIds = useMemo(
    () => [...new Set([...contactOwnerIds, ...createdByIds])],
    [contactOwnerIds, createdByIds]
  );
  const { displayNames } = useUserDisplayNames(allUserIds);

  // Select-all now covers every visible row on the current page (was capped at 50).
  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedContacts(pageContacts.map(c => c.id));
    else setSelectedContacts([]);
  };

  const handleSelectContact = (contactId: string, checked: boolean) => {
    if (checked) setSelectedContacts(prev => [...prev, contactId]);
    else setSelectedContacts(prev => prev.filter(id => id !== contactId));
  };

  const handleAccountClick = (contact: Contact) => {
    setViewAccount({ id: (contact as any).account_id || null, name: contact.company_name || null });
    setShowAccountModal(true);
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-foreground" /> 
      : <ArrowDown className="w-3 h-3 text-foreground" />;
  };

  const displayUser = (id: string | undefined | null) => {
    if (!id) return '-';
    const name = displayNames[id];
    if (!name) return 'Loading…';
    if (name === 'Unknown User') return 'Unknown';
    return name;
  };

  const getDisplayValue = (contact: Contact, columnField: string) => {
    if (columnField === 'contact_owner') return displayUser(contact.contact_owner);
    else if (columnField === 'created_by') return displayUser(contact.created_by);
    else if (columnField === 'last_activity_time' && contact.last_activity_time) {
      try {
        const date = new Date(contact.last_activity_time);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch {
        return contact.last_activity_time;
      }
    }
    // Preserve numeric 0 / false — only treat null/undefined/'' as missing.
    const v = contact[columnField as keyof Contact];
    if (v === null || v === undefined || v === '') return '-';
    return v as any;
  };

  const renderCellContent = (contact: Contact, column: ContactColumnConfig) => {
    if (column.field === 'linked_deals') {
      const count = dealCounts[contact.id] || 0;
      return (
        <button
          onClick={() => { setLinkedDealsContact({ id: contact.id, name: contact.contact_name }); setShowLinkedDealsDialog(true); }}
          className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          title={`View ${count} linked deal${count !== 1 ? 's' : ''}`}
        >
          {count}
        </button>
      );
    }
    if (column.field === 'contact_name') {
      return (
        <button
          onClick={() => onEdit(contact)}
          className="text-[#2e538e] hover:underline font-normal text-left"
        >
          {contact.contact_name}
        </button>
      );
    }

    if (column.field === 'company_name') {
      const name = contact.company_name;
      if (!name) return <span className="text-muted-foreground">-</span>;
      const hasAccount = !!(contact as any).account_id;
      if (!hasAccount) return <span title="No linked account">{name}</span>;
      return (
        <button
          onClick={() => handleAccountClick(contact)}
          className="text-[#2e538e] hover:underline font-normal text-left"
        >
          {name}
        </button>
      );
    }

    return (
      <span className="truncate max-w-[200px]" title={String(getDisplayValue(contact, column.field))}>
        {getDisplayValue(contact, column.field)}
      </span>
    );
  };

  if (loading) {
    return (
      <Table>
        <TableBody>
          <TableRow>
            <TableCell colSpan={visibleColumns.length + 2} className="p-0 h-[60vh]">
              <AppLoader variant="panel" label="Loading contacts…" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  if (pageContacts.length === 0) {
    return (
      <Table>
        <TableBody>
          <TableRow>
            <TableCell colSpan={visibleColumns.length + 2} className="text-center py-8">
              <div className="flex flex-col items-center gap-2">
                <p className="text-muted-foreground">{emptyStateMessage || 'No contacts found'}</p>
                {searchTerm && <p className="text-sm text-muted-foreground">Try adjusting your search terms</p>}
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  return (
    <>
      <div className={cn(isResizing && "select-none")}>
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-muted/80 backdrop-blur-sm">
            <TableRow className="bg-muted/80 hover:bg-muted/80 border-b-2">
              <TableHead className="w-12 text-center font-bold text-foreground bg-muted/80 py-3">
                <div className="flex justify-center">
                  <Checkbox
                    checked={pageContacts.length > 0 && selectedContacts.length === pageContacts.length}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all on this page"
                  />
                </div>
              </TableHead>
              {visibleColumns.map((column) => (
                <TableHead 
                  key={column.field} 
                  aria-sort={sortField === column.field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cn(
                    "relative text-left font-bold text-foreground bg-muted/80 px-4 py-3",
                    sortField === column.field && "bg-accent"
                  )}
                  style={{ width: `${columnWidths[column.field] || 120}px`, minWidth: column.field === 'contact_name' ? '150px' : '60px' }}
                >
                  <Button
                    variant="ghost"
                    className="h-auto p-0 font-bold hover:bg-transparent w-full justify-start text-foreground"
                    onClick={() => onSort(column.field)}
                    title={column.field === 'linked_deals' ? 'Sorted within the current page only' : undefined}
                  >
                    <div className="flex items-center gap-2">
                      {column.label}
                      {getSortIcon(column.field)}
                    </div>
                  </Button>
                  {/* Resize handle — not a tab stop, mouse-only. */}
                  <div 
                    role="separator"
                    aria-label={`Resize ${column.label} column`}
                    tabIndex={-1}
                    className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary/40 active:bg-primary/60" 
                    onMouseDown={e => handleMouseDown(e, column.field)} 
                  />
                </TableHead>
              ))}
              <TableHead className="w-20 bg-muted/80 py-3"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(sortField === 'linked_deals'
              ? [...pageContacts].sort((a, b) => {
                  const ca = dealCounts[a.id] || 0;
                  const cb = dealCounts[b.id] || 0;
                  return sortDirection === 'asc' ? ca - cb : cb - ca;
                })
              : pageContacts
            ).map((contact) => (
              <TableRow key={contact.id} className="group hover:bg-muted/30">
                <TableCell className="text-center px-4 py-3">
                  <div className="flex justify-center">
                    <Checkbox
                      checked={selectedContacts.includes(contact.id)}
                      onCheckedChange={(checked) => handleSelectContact(contact.id, checked as boolean)}
                    />
                  </div>
                </TableCell>
                {visibleColumns.map((column) => (
                  <TableCell 
                    key={column.field} 
                    className="text-left px-4 py-3 align-middle"
                    style={{ width: `${columnWidths[column.field] || 120}px` }}
                  >
                    <div className="flex items-center min-h-[1.5rem]">
                      {renderCellContent(contact, column)}
                    </div>
                  </TableCell>
                ))}
                <TableCell className="py-3 px-2">
                  <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(contact)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onDelete(contact.id)} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AccountViewModal
        open={showAccountModal}
        onOpenChange={setShowAccountModal}
        accountId={viewAccount.id}
        accountName={viewAccount.name}
      />
      <LinkedDealsDialog
        open={showLinkedDealsDialog}
        onOpenChange={setShowLinkedDealsDialog}
        target={linkedDealsContact ? { kind: 'contact', id: linkedDealsContact.id, name: linkedDealsContact.name } : null}
      />
    </>
  );
};
