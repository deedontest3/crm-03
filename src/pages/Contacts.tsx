import { ContactTable } from "@/components/ContactTable";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, MoreVertical, Upload, Plus, Trash2, Download, Search, Link2, Sparkles } from "lucide-react";
import { ContactCleanupDialog } from "@/components/contacts/ContactCleanupDialog";
import { BulkDeleteContactsDialog } from "@/components/contacts/BulkDeleteContactsDialog";
import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useSimpleContactsImportExport } from "@/hooks/useSimpleContactsImportExport";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";

const Contacts = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [initialEditContactId, setInitialEditContactId] = useState<string | null>(null);
  const [dealsOnly, setDealsOnly] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCleanup, setShowCleanup] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  // Distinct contact owners via SECURITY DEFINER RPC — avoids the 1000-row
  // PostgREST cap that would silently under-count owners on larger workspaces.
  const { data: ownerIds = [] } = useQuery({
    queryKey: ['contact-owners', refreshTrigger],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_distinct_contact_owners');
      if (error) {
        // Fallback for environments where the RPC has not been deployed yet.
        const { data: rows } = await supabase.from('contacts').select('contact_owner');
        return [...new Set((rows || []).map(d => d.contact_owner).filter(Boolean))] as string[];
      }
      return ((data as { contact_owner: string }[]) || []).map(r => r.contact_owner).filter(Boolean);
    },
  });
  const { displayNames } = useUserDisplayNames(ownerIds);

  // Contact ids referenced by any deal — fast RPC (union of stakeholders,
  // campaign-contact bridge, direct-role FKs, and lead-name match).
  const { data: connectedContactIds = [], isLoading: connectedIdsLoading } = useQuery({
    queryKey: ['contacts-in-deals', refreshTrigger],
    enabled: dealsOnly,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_contact_ids_with_deals');
      if (error) throw error;
      return ((data as { contact_id: string }[]) || []).map((r) => r.contact_id).filter(Boolean);
    },
  });

  // Deep-link — jumps directly to the edit modal for /contacts?id=<uuid>.
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    (async () => {
      const { data } = await supabase.from("contacts").select("contact_name").eq("id", id).maybeSingle();
      if (data?.contact_name) {
        setSearchTerm(data.contact_name);
        setInitialEditContactId(id);
      } else {
        toast({ title: "Contact not found", description: "The linked contact no longer exists.", variant: "destructive" });
      }
      const next = new URLSearchParams(searchParams);
      next.delete("id");
      setSearchParams(next, { replace: true });
    })();
    // Re-run whenever the URL id changes so back/forward navigation re-opens the modal.
  }, [searchParams, setSearchParams, toast]);

  // Reset owner filter if the currently selected owner no longer exists in the list
  // (e.g. their last contact was reassigned or deleted).
  useEffect(() => {
    if (ownerFilter !== 'all' && ownerIds.length > 0 && !ownerIds.includes(ownerFilter)) {
      setOwnerFilter('all');
    }
  }, [ownerFilter, ownerIds]);

  // Bump refresh + invalidate caches that depend on the underlying contacts
  // set (owner list, deals-only ids, per-page deal counts).
  const onRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
    queryClient.invalidateQueries({ queryKey: ['contact-owners'] });
    queryClient.invalidateQueries({ queryKey: ['contacts-in-deals'] });
    queryClient.invalidateQueries({ queryKey: ['contact-deal-counts-rpc'] });
  };

  const { handleImport, handleExport, isImporting } = useSimpleContactsImportExport(onRefresh);

  const hasFilters = searchTerm.trim() !== '' || ownerFilter !== 'all' || dealsOnly;
  const exportScope = () => {
    if (dealsOnly) return handleExport({ idIn: connectedContactIds, searchTerm, ownerFilter, scopeLabel: 'filtered' });
    if (hasFilters) return handleExport({ searchTerm, ownerFilter, scopeLabel: 'filtered' });
    return handleExport({ scopeLabel: 'all' });
  };
  const exportSelected = () => handleExport({ ids: selectedContacts, scopeLabel: 'selected' });

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await handleImport(file); event.target.value = ''; }
    catch { event.target.value = ''; }
  };

  const handleBulkDeleted = () => {
    setSelectedContacts([]);
    onRefresh();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 h-16 border-b bg-background px-6 flex items-center">
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl font-semibold text-foreground">Contacts</h1>
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
        </div>
      </div>

      <div className="flex-shrink-0 border-b bg-muted/30 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
              <SelectValue placeholder="All Owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Owners</SelectItem>
              {ownerIds.map(id => (
                <SelectItem key={id} value={id}>{displayNames[id] || "Loading…"}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={dealsOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setDealsOnly(v => !v)}
            className="gap-2"
            aria-pressed={dealsOnly}
            title="Show only contacts referenced by at least one deal"
          >
            <Link2 className="w-4 h-4" />
            In Deals
            {dealsOnly && !connectedIdsLoading && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold bg-background/20">
                {connectedContactIds.length}
              </span>
            )}
          </Button>

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" disabled={isImporting}>
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowColumnCustomizer(true)}>
                <Settings className="w-4 h-4 mr-2" />
                Columns
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowCleanup(true)}>
                <Sparkles className="w-4 h-4 mr-2" />
                Cleanup & Diagnostics
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleImportClick} disabled={isImporting}>
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportScope()}>
                <Download className="w-4 h-4 mr-2" />
                {hasFilters ? 'Export filtered' : 'Export all'}
              </DropdownMenuItem>
              {selectedContacts.length > 0 && (
                <DropdownMenuItem onClick={exportSelected}>
                  <Download className="w-4 h-4 mr-2" />
                  Export selected ({selectedContacts.length})
                </DropdownMenuItem>
              )}
              {selectedContacts.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowBulkDelete(true)} className="text-destructive focus:text-destructive">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Selected ({selectedContacts.length})
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleImportCSV}
        className="hidden"
        disabled={isImporting}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <ContactTable
          showColumnCustomizer={showColumnCustomizer}
          setShowColumnCustomizer={setShowColumnCustomizer}
          showModal={showModal}
          setShowModal={setShowModal}
          selectedContacts={selectedContacts}
          setSelectedContacts={setSelectedContacts}
          refreshTrigger={refreshTrigger}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          initialEditContactId={initialEditContactId}
          onInitialEditConsumed={() => setInitialEditContactId(null)}
          dealsOnly={dealsOnly}
          connectedIds={connectedContactIds}
          connectedIdsLoading={dealsOnly && connectedIdsLoading}
          ownerFilter={ownerFilter}
        />
      </div>

      <ContactCleanupDialog
        open={showCleanup}
        onOpenChange={setShowCleanup}
        onChanged={onRefresh}
        onEditContact={(id) => setInitialEditContactId(id)}
      />

      <BulkDeleteContactsDialog
        open={showBulkDelete}
        onOpenChange={setShowBulkDelete}
        contactIds={selectedContacts}
        onDeleted={handleBulkDeleted}
      />
    </div>
  );
};

export default Contacts;
