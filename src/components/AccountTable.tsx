import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { useColumnPreferences } from "@/hooks/useColumnPreferences";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AccountTableBody } from "./account-table/AccountTableBody";
import { AccountModal } from "./AccountModal";
import { AccountColumnCustomizer, AccountColumnConfig } from "./AccountColumnCustomizer";
import { getAccountLinkedContactCounts } from "@/lib/accountLinkedContacts";
import { getAllAccountDealCounts } from "@/lib/accountLinkedDeals";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { fetchPaginatedData } from "@/utils/supabasePagination";
import { BulkDeleteAccountsDialog } from "./accounts/BulkDeleteAccountsDialog";

interface Account {
  id: string;
  account_name: string;
  phone?: string;
  website?: string;
  industry?: string;
  company_type?: string;
  country?: string;
  region?: string;
  status?: string;
  description?: string;
  account_owner?: string;
  created_by?: string;
  modified_by?: string;
  created_time?: string;
  modified_time?: string;
  last_activity_time?: string;
  currency?: string;
}

const defaultColumns: AccountColumnConfig[] = [
  { field: 'account_name', label: 'Account Name', visible: true, order: 0 },
  { field: 'linked_deals', label: 'Linked Deals', visible: true, order: 1 },
  { field: 'description', label: 'Description', visible: true, order: 2 },
  { field: 'linked_contacts', label: 'Linked contacts', visible: true, order: 3 },
  { field: 'status', label: 'Status', visible: true, order: 4 },
  { field: 'company_type', label: 'Company Type', visible: true, order: 5 },
  { field: 'industry', label: 'Industry', visible: true, order: 6 },
  { field: 'phone', label: 'Phone', visible: true, order: 7 },
  { field: 'website', label: 'Website', visible: true, order: 8 },
  { field: 'country', label: 'Country', visible: true, order: 9 },
  { field: 'region', label: 'Region', visible: true, order: 10 },
  { field: 'currency', label: 'Currency', visible: true, order: 11 },
  { field: 'created_time', label: 'Created', visible: false, order: 12 },
  { field: 'account_owner', label: 'Account Owner', visible: true, order: 13 },
];

interface AccountTableProps {
  showColumnCustomizer: boolean;
  setShowColumnCustomizer: (show: boolean) => void;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  selectedAccounts: string[];
  setSelectedAccounts: React.Dispatch<React.SetStateAction<string[]>>;
  refreshTrigger?: number;
  searchTerm?: string;
  statusFilter?: string;
  ownerFilter?: string;
  dealsOnly?: boolean;
  connectedIds?: string[];
  connectedIdsLoading?: boolean;
}

export const AccountTable = ({ 
  showColumnCustomizer, 
  setShowColumnCustomizer, 
  showModal, 
  setShowModal,
  selectedAccounts,
  setSelectedAccounts,
  refreshTrigger,
  searchTerm = "",
  statusFilter = "all",
  ownerFilter = "all",
  dealsOnly = false,
  connectedIds = [],
  connectedIdsLoading = false,
}: AccountTableProps) => {
  const { toast } = useToast();
  const { logBulkDelete } = useCRUDAudit();
  const [pageAccounts, setPageAccounts] = useState<Account[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<string | null>(null);
  const { columns, setColumns } = useColumnPreferences<AccountColumnConfig>('accounts', defaultColumns);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  // contactCounts derived from cached query below

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, ownerFilter, dealsOnly]);

  // Keep a ref to the latest columns so effects that toggle a single column
  // (e.g. "In Deals" showing Linked Deals) can read fresh state without
  // needing `columns` in their deps.
  const columnsRef = useRef(columns);
  useEffect(() => { columnsRef.current = columns; }, [columns]);

  // When "In Deals" turns on, force Linked Deals column visible and sort by
  // it descending. Snapshot previous sort + visibility so we can restore it
  // when the filter turns back off. Runs only on dealsOnly transitions and
  // reads the latest columns via ref so user edits made while the filter is
  // on aren't clobbered on restore.
  const preDealsStateRef = useRef<{
    sortField: string | null;
    sortDirection: 'asc' | 'desc';
    linkedDealsVisible: boolean;
  } | null>(null);
  useEffect(() => {
    if (dealsOnly) {
      const cur = columnsRef.current;
      if (!preDealsStateRef.current) {
        const col = cur.find(c => c.field === 'linked_deals');
        preDealsStateRef.current = {
          sortField,
          sortDirection,
          linkedDealsVisible: col?.visible ?? true,
        };
        if (col && !col.visible) {
          setColumns(cur.map(c => c.field === 'linked_deals' ? { ...c, visible: true } : c));
        }
      }
      setSortField('linked_deals');
      setSortDirection('desc');
    } else if (preDealsStateRef.current) {
      const snap = preDealsStateRef.current;
      setSortField(snap.sortField);
      setSortDirection(snap.sortDirection);
      const cur = columnsRef.current;
      const col = cur.find(c => c.field === 'linked_deals');
      if (col && col.visible !== snap.linkedDealsVisible) {
        setColumns(cur.map(c => c.field === 'linked_deals' ? { ...c, visible: snap.linkedDealsVisible } : c));
      }
      preDealsStateRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealsOnly]);

  const fetchAccounts = useCallback(async () => {
    // If the "In Deals" filter is on but the connected-id list hasn't
    // resolved yet, skip this run — we'll refetch when it arrives. Don't
    // toggle loading here, so the existing rows stay visible instead of
    // flashing the panel loader a second time.
    if (dealsOnly && connectedIdsLoading) {
      return;
    }
    try {
      setLoading(true);

      const filters: Record<string, string> = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      if (ownerFilter !== 'all') filters.account_owner = ownerFilter;

      // Skip server-side sort for client-only computed columns (e.g. linked_contacts, linked_deals)
      const serverSortField =
        sortField && sortField !== 'linked_contacts' && sortField !== 'linked_deals'
          ? sortField
          : undefined;

      const result = await fetchPaginatedData<Account>('accounts', {
        page: currentPage,
        pageSize: itemsPerPage,
        sortField: serverSortField,
        sortDirection,
        searchTerm: debouncedSearch || undefined,
        searchFields: ['account_name', 'website', 'phone', 'country'],
        filters,
        idIn: dealsOnly ? connectedIds : undefined,
      });

      setPageAccounts(result.data);
      setTotalCount(result.totalCount);
    } catch (error) {
      console.error('AccountTable: Error fetching accounts:', error);
      toast({ title: "Error", description: "Failed to fetch accounts.", variant: "destructive" });
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [currentPage, itemsPerPage, sortField, sortDirection, debouncedSearch, statusFilter, ownerFilter, dealsOnly, connectedIds, connectedIdsLoading, toast]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) fetchAccounts();
  }, [refreshTrigger, fetchAccounts]);

  // Fetch linked contact counts for visible accounts from all supported link sources.
  const visibleAccountSignature = useMemo(
    () => pageAccounts.map((a) => `${a.id}:${a.account_name || ''}`).filter(Boolean).sort(),
    [pageAccounts]
  );

  const { data: contactCounts = {}, isError: contactCountsError } = useQuery({
    queryKey: ['account-contact-counts', visibleAccountSignature.join('|'), refreshTrigger],
    enabled: visibleAccountSignature.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => getAccountLinkedContactCounts(pageAccounts.map(({ id, account_name }) => ({ id, account_name }))),
    placeholderData: keepPreviousData,
  });

  // Deal counts are computed for ALL accounts in one pass and cached by
  // refreshTrigger only — paging/sorting no longer re-downloads the entire
  // linking universe. Per-page lookups read from this map by account id.
  const { data: dealCounts = {}, isError: dealCountsError } = useQuery({
    queryKey: ['account-deal-counts-all', refreshTrigger],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: getAllAccountDealCounts,
    placeholderData: keepPreviousData,
  });

  // One-shot toast when either count query fails so users know badges may be
  // showing 0 due to an error, not because the accounts truly have no links.
  const countErrorNotifiedRef = useRef(false);
  useEffect(() => {
    if ((contactCountsError || dealCountsError) && !countErrorNotifiedRef.current) {
      countErrorNotifiedRef.current = true;
      toast({
        title: "Couldn't load link counts",
        description: "Linked contact/deal badges may show 0 until the next refresh.",
        variant: "destructive",
      });
    }
    if (!contactCountsError && !dealCountsError) {
      countErrorNotifiedRef.current = false;
    }
  }, [contactCountsError, dealCountsError, toast]);


  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Single-row deletes now go through BulkDeleteAccountsDialog (with a single
  // id) so linked contacts/deals/leads/campaign contacts/action items are
  // handled with the same keep-or-delete choices as bulk delete, instead of a
  // raw delete that orphans them.


  const handleEditAccount = (account: Account) => {
    setEditingAccount(account);
    setShowModal(true);
  };

  const visibleColumns = columns.filter(col => col.visible);
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalCount);

  // Render table chrome immediately; the body component shows skeleton rows while loading.

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-auto">
        <AccountTableBody
          loading={loading && !hasLoadedOnce}
          pageAccounts={pageAccounts}
          visibleColumns={visibleColumns}
          selectedAccounts={selectedAccounts}
          setSelectedAccounts={setSelectedAccounts}
          onEdit={handleEditAccount}
          onDelete={(id) => { setAccountToDelete(id); setShowDeleteDialog(true); }}
          searchTerm={searchTerm}
          onRefresh={fetchAccounts}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          contactCounts={contactCounts}
          dealCounts={dealCounts}
        />
      </div>

      {/* Pagination Footer */}
      <div className="flex-shrink-0 border-t bg-background px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {totalCount === 0
                ? (debouncedSearch || statusFilter !== 'all' || ownerFilter !== 'all' || dealsOnly
                    ? 'No accounts match your filters.'
                    : 'No accounts yet.')
                : `Showing ${startIndex + 1}-${endIndex} of ${totalCount} accounts`}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Show:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {totalCount > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm px-2">
                Page {currentPage} of {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AccountModal
        open={showModal}
        onOpenChange={(open) => { setShowModal(open); if (!open) setEditingAccount(null); }}
        account={editingAccount}
        onSuccess={() => { fetchAccounts(); setEditingAccount(null); }}
      />
      <AccountColumnCustomizer open={showColumnCustomizer} onOpenChange={setShowColumnCustomizer} columns={columns} onColumnsChange={setColumns} defaultColumns={defaultColumns} />

      <BulkDeleteAccountsDialog
        open={showDeleteDialog}
        onOpenChange={(open) => { setShowDeleteDialog(open); if (!open) setAccountToDelete(null); }}
        accountIds={accountToDelete ? [accountToDelete] : []}
        onDeleted={() => {
          // Only strip the deleted id — preserve multi-page selection.
          if (accountToDelete) {
            const removedId = accountToDelete;
            setSelectedAccounts(prev => prev.filter(id => id !== removedId));
          }
          setAccountToDelete(null);
          fetchAccounts();
        }}
      />


    </div>
  );
};
