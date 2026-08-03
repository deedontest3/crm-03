import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { useColumnPreferences } from "@/hooks/useColumnPreferences";
import { ContactTableBody } from "./contact-table/ContactTableBody";
import { ContactModal } from "./ContactModal";
import { ContactColumnCustomizer, ContactColumnConfig } from "./ContactColumnCustomizer";
import { StandardPagination } from "./shared/StandardPagination";
import { BulkDeleteContactsDialog } from "./contacts/BulkDeleteContactsDialog";
import { fetchPaginatedData } from "@/utils/supabasePagination";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { showToastOnce } from "@/lib/toastOnce";

interface Contact {
  id: string;
  contact_name: string;
  company_name?: string;
  account_id?: string | null;
  position?: string;
  email?: string;
  phone_no?: string;
  region?: string;
  contact_owner?: string;
  created_time?: string;
  modified_time?: string;
  last_activity_time?: string;
  industry?: string;
  contact_source?: string;
  linkedin?: string;
  website?: string;
  description?: string;
  created_by?: string;
  modified_by?: string;
}

const defaultColumns: ContactColumnConfig[] = [
  { field: 'contact_name', label: 'Contact Name', visible: true, order: 0 },
  { field: 'linked_deals', label: 'Linked Deals', visible: true, order: 1 },
  { field: 'company_name', label: 'Account', visible: true, order: 2 },
  { field: 'position', label: 'Position', visible: true, order: 3 },
  { field: 'email', label: 'Email', visible: true, order: 4 },
  { field: 'phone_no', label: 'Phone', visible: true, order: 5 },
  { field: 'region', label: 'Region', visible: true, order: 6 },
  { field: 'contact_owner', label: 'Contact Owner', visible: true, order: 7 },
  { field: 'industry', label: 'Industry', visible: true, order: 8 },
  { field: 'contact_source', label: 'Source', visible: true, order: 9 },
  { field: 'last_activity_time', label: 'Last Activity', visible: false, order: 10 },
];

interface ContactTableProps {
  showColumnCustomizer: boolean;
  setShowColumnCustomizer: (show: boolean) => void;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  selectedContacts: string[];
  setSelectedContacts: React.Dispatch<React.SetStateAction<string[]>>;
  refreshTrigger?: number;
  searchTerm?: string;
  setSearchTerm?: (term: string) => void;
  /** Deep-link: id of contact to auto-open in edit modal once data loads. */
  initialEditContactId?: string | null;
  /** Notify parent that the deep-link has been consumed so it won't re-fire. */
  onInitialEditConsumed?: () => void;
  dealsOnly?: boolean;
  connectedIds?: string[];
  connectedIdsLoading?: boolean;
  ownerFilter?: string;
}

export const ContactTable = ({ 
  showColumnCustomizer, 
  setShowColumnCustomizer, 
  showModal, 
  setShowModal,
  selectedContacts,
  setSelectedContacts,
  refreshTrigger,
  searchTerm = "",
  setSearchTerm,
  initialEditContactId,
  onInitialEditConsumed,
  dealsOnly = false,
  connectedIds = [],
  connectedIdsLoading = false,
  ownerFilter = "all",
}: ContactTableProps) => {
  const { logDelete, logCreate } = useCRUDAudit();
  const queryClient = useQueryClient();
  const [pageContacts, setPageContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  // Route single-row deletes through the cascade-aware bulk dialog so RLS,
  // orphaned stakeholders, and campaign membership are all handled uniformly.
  const [singleDeleteId, setSingleDeleteId] = useState<string | null>(null);
  const { columns, setColumns } = useColumnPreferences<ContactColumnConfig>('contacts', defaultColumns);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm]);

  const fetchContacts = useCallback(async () => {
    // If "In Deals" is on but the connected-id list is still loading, skip
    // this run — the query will re-fire when it arrives.
    if (dealsOnly && connectedIdsLoading) {
      return;
    }
    try {
      // Only show the full-panel loader before the first successful load.
      // Subsequent filter/sort/page changes keep prior rows visible.
      if (!hasLoadedOnceRef.current) setLoading(true);

      const serverSortField = sortField && sortField !== 'linked_deals' ? sortField : undefined;
      const filters: Record<string, string> = {};
      if (ownerFilter !== 'all') filters.contact_owner = ownerFilter;
      const result = await fetchPaginatedData<Contact>('contacts', {
        page: currentPage,
        pageSize: itemsPerPage,
        sortField: serverSortField,
        sortDirection,
        searchTerm: debouncedSearch || undefined,
        searchFields: ['contact_name', 'company_name', 'email', 'phone_no'],
        filters,
        idIn: dealsOnly ? connectedIds : undefined,
      });

      setPageContacts(result.data);
      setTotalCount(result.totalCount);
    } catch (error) {
      console.error('ContactTable: Error fetching contacts:', error);
      showToastOnce({
        title: "Error",
        description: "Failed to fetch contacts. Please refresh the page.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
      setHasLoadedOnce(true);
    }
  }, [currentPage, itemsPerPage, sortField, sortDirection, debouncedSearch, dealsOnly, connectedIds, connectedIdsLoading, ownerFilter, refreshTrigger]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dealsOnly, ownerFilter]);

  // When "In Deals" turns on, force Linked Deals column visible and sort by
  // it descending. We snapshot ONLY the prior sort here — the column
  // visibility override is applied in-memory (via `effectiveColumns` below)
  // and never persisted, so toggling the filter doesn't write to
  // column_preferences twice per click.
  const preDealsStateRef = useRef<{
    sortField: string | null;
    sortDirection: 'asc' | 'desc';
  } | null>(null);
  useEffect(() => {
    if (dealsOnly) {
      if (!preDealsStateRef.current) {
        preDealsStateRef.current = { sortField, sortDirection };
      }
      setSortField('linked_deals');
      setSortDirection('desc');
    } else if (preDealsStateRef.current) {
      setSortField(preDealsStateRef.current.sortField);
      setSortDirection(preDealsStateRef.current.sortDirection);
      preDealsStateRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealsOnly]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Deep-link auto-open: consumedRef prevents this from re-firing every time
  // pageContacts changes.
  const consumedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialEditContactId) return;
    if (consumedIdRef.current === initialEditContactId) return;
    consumedIdRef.current = initialEditContactId;
    const inPage = pageContacts.find(c => c.id === initialEditContactId);
    if (inPage) {
      setEditingContact(inPage);
      setShowModal(true);
      onInitialEditConsumed?.();
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", initialEditContactId)
        .maybeSingle();
      if (cancelled || !data) return;
      setEditingContact(data as Contact);
      setShowModal(true);
      onInitialEditConsumed?.();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditContactId]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Legacy single-delete kept only for internal callers; UI routes through the
  // BulkDeleteContactsDialog so cascade choices are exposed to the user.
  void logDelete;

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setShowModal(true);
  };

  // In-memory override so "In Deals" can force the Linked Deals column visible
  // without mutating the user's persisted column preferences.
  const effectiveColumns = dealsOnly
    ? columns.map(c => c.field === 'linked_deals' ? { ...c, visible: true } : c)
    : columns;
  const visibleColumns = effectiveColumns.filter(col => col.visible);
  const totalPages = Math.ceil(totalCount / itemsPerPage);

  // Fast per-page deal count via RPC — no full-graph download. Deliberately
  // keep `refreshTrigger` OUT of the query key so it doesn't refetch on every
  // save; invalidation should happen through explicit query invalidation.
  const visibleIds = useMemo(
    () => [...pageContacts.map(c => c.id)].sort(),
    [pageContacts],
  );
  const { data: dealCounts = {}, isError: dealCountsError } = useQuery({
    queryKey: ['contact-deal-counts-rpc', visibleIds.join('|')],
    enabled: visibleIds.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_contact_deal_counts', { _contact_ids: visibleIds });
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const row of (data as { contact_id: string; deal_count: number }[]) || []) {
        out[row.contact_id] = Number(row.deal_count) || 0;
      }
      return out;
    },
    placeholderData: keepPreviousData,
  });
  void dealCountsError;

  // Render table chrome immediately; the body component shows skeleton rows while loading.



  return (
    <div className="flex flex-col h-full">
      {/* Table Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <ContactTableBody
          loading={loading && !hasLoadedOnce}
          pageContacts={pageContacts}
          visibleColumns={visibleColumns}
          selectedContacts={selectedContacts}
          setSelectedContacts={setSelectedContacts}
          onEdit={handleEditContact}
          onDelete={(id) => setSingleDeleteId(id)}
          searchTerm={searchTerm}
          onRefresh={fetchContacts}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          dealCounts={dealCounts}
          emptyStateMessage={
            dealsOnly && connectedIds.length === 0
              ? 'No contacts are linked to any deal.'
              : undefined
          }
        />
      </div>

      {/* Always show pagination */}
      <StandardPagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalCount}
        itemsPerPage={itemsPerPage}
        onPageChange={setCurrentPage}
        onPageSizeChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
        entityName="contacts"
      />

      {/* Modals */}
      <ContactModal
        open={showModal}
        onOpenChange={setShowModal}
        contact={editingContact}
        onSuccess={() => {
          fetchContacts();
          setEditingContact(null);
          // New/updated contact may introduce a new owner or change deal links
          // — refresh the owner filter and deal-count caches.
          queryClient.invalidateQueries({ queryKey: ['contact-owners'] });
          queryClient.invalidateQueries({ queryKey: ['contacts-in-deals'] });
          queryClient.invalidateQueries({ queryKey: ['contact-deal-counts-rpc'] });
        }}
      />

      <ContactColumnCustomizer
        open={showColumnCustomizer}
        onOpenChange={setShowColumnCustomizer}
        columns={columns}
        onColumnsChange={setColumns}
      />

      {/* Single-row delete via the same cascade-aware dialog used for bulk. */}
      <BulkDeleteContactsDialog
        open={!!singleDeleteId}
        onOpenChange={(o) => { if (!o) setSingleDeleteId(null); }}
        contactIds={singleDeleteId ? [singleDeleteId] : []}
        onDeleted={() => {
          setSingleDeleteId(null);
          fetchContacts();
          queryClient.invalidateQueries({ queryKey: ['contact-owners'] });
          queryClient.invalidateQueries({ queryKey: ['contacts-in-deals'] });
          queryClient.invalidateQueries({ queryKey: ['contact-deal-counts-rpc'] });
        }}
      />
    </div>
  );
};
