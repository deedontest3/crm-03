import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, Download, Columns, MoreVertical, Search, X, Link2, AlertTriangle, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { AccountTable } from "@/components/AccountTable";
import { useSimpleAccountsImportExport } from "@/hooks/useSimpleAccountsImportExport";
import { supabase } from "@/integrations/supabase/client";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { getAccountIdsWithLinkedDeals, getAmbiguousDealLinks, getUnmatchedDeals } from "@/lib/accountLinkedDeals";
import { UnmatchedDealsDialog } from "@/components/UnmatchedDealsDialog";
import { AccountCleanupDialog } from "@/components/accounts/AccountCleanupDialog";
import { BulkDeleteAccountsDialog } from "@/components/accounts/BulkDeleteAccountsDialog";

import { usePersistentState } from "@/hooks/usePersistentState";

const Accounts = () => {
  // Filter state persists across refreshes (matches Dashboard behavior).
  const [searchTerm, setSearchTerm] = usePersistentState<string>("accounts.searchTerm", "");
  const [statusFilter, setStatusFilter] = usePersistentState<string>("accounts.statusFilter", "all");
  const [ownerFilter, setOwnerFilter] = usePersistentState<string>("accounts.ownerFilter", "all");
  const [dealsOnly, setDealsOnly] = usePersistentState<boolean>("accounts.dealsOnly", false);
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showUnmatchedDeals, setShowUnmatchedDeals] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  useCRUDAudit();
  const queryClient = useQueryClient();

  const invalidateAccountCaches = () => {
    queryClient.invalidateQueries({ queryKey: ['account-contact-counts'] });
    queryClient.invalidateQueries({ queryKey: ['account-deal-counts-all'] });
    queryClient.invalidateQueries({ queryKey: ['accounts-in-deals'] });
    queryClient.invalidateQueries({ queryKey: ['deal-links-review'] });
  };

  const { handleImport, handleExport, isImporting } = useSimpleAccountsImportExport(() => {
    setRefreshTrigger(prev => prev + 1);
    invalidateAccountCaches();
  });

  const { data: reviewCounts = { ambiguous: 0, total: 0 } } = useQuery({
    queryKey: ['deal-links-review', refreshTrigger],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [ambiguous, unmatched] = await Promise.all([
        getAmbiguousDealLinks(),
        getUnmatchedDeals(),
      ]);
      return { ambiguous: ambiguous.length, total: ambiguous.length + unmatched.length };
    },
  });
  const ambiguousCount = reviewCounts.ambiguous;

  // Distinct account owners — cached for 5 min, refetched only when refreshTrigger changes.
  const { data: ownerIds = [] } = useQuery({
    queryKey: ['account-owners', refreshTrigger],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Prefer the SECURITY DEFINER RPC (single round trip). Fall back to a
      // paginated scan ONLY when the function isn't installed — a real
      // permission error should surface instead of masquerading as a full scan.
      const { data, error } = await (supabase as any).rpc('get_distinct_account_owners');
      if (!error && Array.isArray(data)) {
        return (data as Array<{ account_owner: string }>).map((r) => r.account_owner).filter(Boolean);
      }
      // Narrow the fallback to "function does not exist"; re-throw everything else.
      const { isRpcMissingError } = await import('@/lib/isRpcMissingError');
      if (error && !isRpcMissingError(error)) throw error;

      const PAGE = 1000;
      const owners = new Set<string>();
      let from = 0;
      while (true) {
        const { data: rows, error: err } = await supabase
          .from('accounts')
          .select('account_owner')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (err) throw err;
        const list = rows || [];
        for (const r of list) if (r.account_owner) owners.add(r.account_owner);
        if (list.length < PAGE) break;
        from += PAGE;
      }
      return [...owners];
    },
  });

  const { displayNames } = useUserDisplayNames(ownerIds);

  // Account ids referenced by at least one deal — cached for 5 min.
  const { data: connectedAccountIds = [], isLoading: connectedIdsLoading } = useQuery({
    queryKey: ['accounts-in-deals', refreshTrigger],
    enabled: dealsOnly,
    staleTime: 5 * 60 * 1000,
    queryFn: getAccountIdsWithLinkedDeals,
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) { handleImport(file); event.target.value = ''; }
  };

  // Realtime: refresh accounts + linked-count caches when related rows change.
  // We split debouncing by source: direct `accounts` edits refresh fast (600ms),
  // while high-volume tables (deals/contacts/stakeholders/campaign_contacts)
  // that only affect link-count badges are debounced to 2.5s to avoid thrashing
  // on busy workspaces.
  useEffect(() => {
    let accountsTimer: ReturnType<typeof setTimeout> | null = null;
    let linkTimer: ReturnType<typeof setTimeout> | null = null;
    const bumpAccounts = () => {
      if (accountsTimer) return;
      accountsTimer = setTimeout(() => {
        accountsTimer = null;
        invalidateAccountCaches();
        setRefreshTrigger((prev) => prev + 1);
      }, 600);
    };
    const bumpLinks = () => {
      if (linkTimer) return;
      linkTimer = setTimeout(() => {
        linkTimer = null;
        // Only invalidate the count caches; skip a full account re-fetch.
        queryClient.invalidateQueries({ queryKey: ['account-contact-counts'] });
        queryClient.invalidateQueries({ queryKey: ['account-deal-counts-all'] });
      }, 2500);
    };
    const channel = supabase
      .channel('accounts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, bumpAccounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, bumpLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, bumpLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deal_stakeholders' }, bumpLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_contacts' }, bumpLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_accounts' }, bumpLinks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, bumpLinks)
      .subscribe();
    return () => {
      if (accountsTimer) clearTimeout(accountsTimer);
      if (linkTimer) clearTimeout(linkTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const handleBulkDeleted = () => {
    setSelectedAccounts([]);
    invalidateAccountCaches();
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 h-16 px-6 border-b bg-background flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Accounts</h1>
        <Button onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex-shrink-0 px-6 py-3 bg-muted/30 border-b flex items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search accounts..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9" />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="New">New</SelectItem>
            <SelectItem value="Working">Working</SelectItem>
            <SelectItem value="Qualified">Qualified</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
            <SelectValue placeholder="All Owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            {ownerIds.map(id => (
              <SelectItem key={id} value={id}>{displayNames[id] || `User ${id.slice(0, 6)}…`}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={dealsOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setDealsOnly(v => !v)}
          className="gap-2"
          aria-pressed={dealsOnly}
          aria-busy={dealsOnly && connectedIdsLoading}
        >
          {dealsOnly && connectedIdsLoading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Link2 className="h-4 w-4" />}
          In Deals
        </Button>

        {reviewCounts.total > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowUnmatchedDeals(true)}
            className="gap-2 relative"
          >
            <AlertTriangle className="h-4 w-4" />
            Review Deal Links
            {reviewCounts.total > 0 && (
              <span
                className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive"
                aria-label={`${reviewCounts.total} deal link${reviewCounts.total === 1 ? "" : "s"} need review`}
              />
            )}
          </Button>
        )}

        <div className="flex-1" />

        {selectedAccounts.length > 0 && (
          <>
            <span className="text-sm font-medium text-foreground">
              {selectedAccounts.length} item{selectedAccounts.length !== 1 ? 's' : ''} selected
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedAccounts([])} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4 mr-1" /> Clear
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setShowBulkDeleteDialog(true)}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected ({selectedAccounts.length})
            </Button>
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="More actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowColumnCustomizer(true)}>
              <Columns className="h-4 w-4 mr-2" /> Customize Columns
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowCleanup(true)}>
              <Sparkles className="h-4 w-4 mr-2" /> Cleanup & Diagnostics
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
              <Upload className="h-4 w-4 mr-2" /> {isImporting ? 'Importing...' : 'Import CSV'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" disabled={isImporting} />

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AccountTable
          showColumnCustomizer={showColumnCustomizer} setShowColumnCustomizer={setShowColumnCustomizer}
          showModal={showModal} setShowModal={setShowModal}
          selectedAccounts={selectedAccounts} setSelectedAccounts={setSelectedAccounts}
          refreshTrigger={refreshTrigger} searchTerm={searchTerm} statusFilter={statusFilter} ownerFilter={ownerFilter}
          dealsOnly={dealsOnly} connectedIds={connectedAccountIds}
          connectedIdsLoading={dealsOnly && connectedIdsLoading}
        />
      </div>

      <UnmatchedDealsDialog
        open={showUnmatchedDeals}
        onOpenChange={setShowUnmatchedDeals}
        onChanged={() => setRefreshTrigger((prev) => prev + 1)}
      />

      <AccountCleanupDialog
        open={showCleanup}
        onOpenChange={setShowCleanup}
        onChanged={() => setRefreshTrigger((prev) => prev + 1)}
      />

      <BulkDeleteAccountsDialog
        open={showBulkDeleteDialog}
        onOpenChange={setShowBulkDeleteDialog}
        accountIds={selectedAccounts}
        onDeleted={handleBulkDeleted}
      />
    </div>
  );
};

export default Accounts;
