import { useState, useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreHorizontal, Pencil, Trash2, ArrowUpDown, ArrowUp, ArrowDown, ListTodo } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { ContactColumnConfig } from "../ContactColumnCustomizer";
import { AccountViewModal } from "../AccountViewModal";
import { cn } from "@/lib/utils";
import { useContactColumnWidths } from "@/hooks/useContactColumnWidths";

interface Contact {
  id: string;
  contact_name: string;
  company_name?: string;
  position?: string;
  email?: string;
  phone_no?: string;
  region?: string;
  contact_owner?: string;
  lead_status?: string;
  created_by?: string;
  linkedin?: string;
  website?: string;
  contact_source?: string;
  industry?: string;
  description?: string;
  mobile_no?: string;
  city?: string;
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
  onAddActionItem?: (contact: Contact) => void;
}

const getLeadStatusDotColor = (status: string | undefined) => {
  switch (status) {
    case 'New': return 'bg-blue-500';
    case 'Contacted': return 'bg-yellow-500';
    case 'Converted': return 'bg-green-500';
    default: return 'bg-gray-400';
  }
};

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
  onAddActionItem
}: ContactTableBodyProps) => {
  const [viewAccountName, setViewAccountName] = useState<string | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const { columnWidths, updateColumnWidth } = useContactColumnWidths();

  // Column resize state
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);

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
    updateColumnWidth(isResizing, newWidth);
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

  const contactOwnerIds = [...new Set(pageContacts.map(c => c.contact_owner).filter(Boolean))];
  const createdByIds = [...new Set(pageContacts.map(c => c.created_by).filter(Boolean))];
  const allUserIds = [...new Set([...contactOwnerIds, ...createdByIds])];
  const { displayNames } = useUserDisplayNames(allUserIds);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedContacts(pageContacts.slice(0, 50).map(c => c.id));
    } else {
      setSelectedContacts([]);
    }
  };

  const handleSelectContact = (contactId: string, checked: boolean) => {
    if (checked) {
      setSelectedContacts(prev => [...prev, contactId]);
    } else {
      setSelectedContacts(prev => prev.filter(id => id !== contactId));
    }
  };

  const handleAccountClick = (companyName: string) => {
    setViewAccountName(companyName);
    setShowAccountModal(true);
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-muted-foreground/60" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-foreground" /> 
      : <ArrowDown className="w-3 h-3 text-foreground" />;
  };

  const getDisplayValue = (contact: Contact, columnField: string) => {
    if (columnField === 'contact_owner') {
      if (!contact.contact_owner) return '-';
      const displayName = displayNames[contact.contact_owner];
      return displayName && displayName !== "Unknown User" ? displayName : (displayName === "Unknown User" ? "Unknown User" : "Loading...");
    } else if (columnField === 'created_by') {
      if (!contact.created_by) return '-';
      const displayName = displayNames[contact.created_by];
      return displayName && displayName !== "Unknown User" ? displayName : (displayName === "Unknown User" ? "Unknown User" : "Loading...");
    } else if (columnField === 'lead_status' && contact.lead_status) {
      return (
        <div className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', getLeadStatusDotColor(contact.lead_status))} />
          <span>{contact.lead_status}</span>
        </div>
      );
    } else if (columnField === 'last_activity_time' && contact.last_activity_time) {
      try {
        const date = new Date(contact.last_activity_time);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch {
        return contact.last_activity_time;
      }
    }
    return contact[columnField as keyof Contact] || '-';
  };

  const renderCellContent = (contact: Contact, column: ContactColumnConfig) => {
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
      if (!name) return <span>-</span>;
      return (
        <button
          onClick={() => handleAccountClick(name)}
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
            <TableCell colSpan={visibleColumns.length + 2} className="text-center py-8">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mr-2"></div>
                Loading contacts...
              </div>
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
                <p className="text-muted-foreground">No contacts found</p>
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
                    checked={selectedContacts.length > 0 && selectedContacts.length === Math.min(pageContacts.length, 50)}
                    onCheckedChange={handleSelectAll}
                  />
                </div>
              </TableHead>
              {visibleColumns.map((column) => (
                <TableHead 
                  key={column.field} 
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
                  >
                    <div className="flex items-center gap-2">
                      {column.label}
                      {getSortIcon(column.field)}
                    </div>
                  </Button>
                  {/* Resize handle */}
                  <div 
                    className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary/40 active:bg-primary/60" 
                    onMouseDown={e => handleMouseDown(e, column.field)} 
                  />
                </TableHead>
              ))}
              <TableHead className="w-20 bg-muted/80 py-3"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageContacts.map((contact) => (
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
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex justify-center">
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
                        {onAddActionItem && (
                          <DropdownMenuItem onClick={() => onAddActionItem(contact)}>
                            <ListTodo className="h-4 w-4 mr-2" />
                            Add Action Item
                          </DropdownMenuItem>
                        )}
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
        accountName={viewAccountName}
      />
    </>
  );
};
