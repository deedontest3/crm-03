import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Deal, DealStage } from "@/types/deal";
import { KanbanBoard } from "@/components/KanbanBoard";
import { ListView } from "@/components/ListView";
import { DealForm } from "@/components/DealForm";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { Plus, LayoutGrid, List, Archive } from "lucide-react";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { usePermissions } from "@/contexts/PermissionsContext";
import { ArchivedDealsDialog } from "@/components/deals/ArchivedDealsDialog";
import { AppLoader } from "@/components/ui/loader";

const DealsPage = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logCreate, logUpdate, logDelete, logBulkDelete } = useCRUDAudit();
  
  // URL params for highlight from notifications
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const fixFields = searchParams.get('fix');
  const [highlightFields, setHighlightFields] = useState<string[]>([]);
  const [highlightProcessed, setHighlightProcessed] = useState(false);
  
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [initialStage, setInitialStage] = useState<DealStage>('Lead');
  const [activeView, setActiveView] = useState<'kanban' | 'list'>('kanban');
  const { userRole } = usePermissions();
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Initial fetch is capped to KANBAN_LIMIT most-recent deals so first paint is fast.
  // The "Load all" button below pulls the rest in 1000-row batches when needed
  // (e.g. a user with thousands of historical deals scrolling further).
  const KANBAN_LIMIT = 500;
  const [loadAll, setLoadAll] = useState(false);

  const dealsQuery = useQuery({
    queryKey: ['deals-all', loadAll],
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<Deal[]> => {
      // Fast path: only the most recent KANBAN_LIMIT rows for initial paint
      if (!loadAll) {
        const { data, error } = await supabase
          .from('deals')
          .select('*')
          .is('archived_at', null)
          .order('modified_at', { ascending: false })
          .range(0, KANBAN_LIMIT - 1);
        if (error) throw error;
        return (data || []) as unknown as Deal[];
      }

      // Full load (paginated to bypass the 1000-row supabase limit)
      const PAGE = 1000;
      let from = 0;
      const all: Deal[] = [];
      while (true) {
        const { data, error } = await supabase
          .from('deals')
          .select('*')
          .is('archived_at', null)
          .order('modified_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data || []) as unknown as Deal[];
        all.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });

  const deals = dealsQuery.data || [];
  const loading = dealsQuery.isLoading;
  const hasMore = !loadAll && deals.length >= KANBAN_LIMIT;

  const fetchDeals = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['deals-all'] });
  }, [queryClient]);

  // Local helper to update deals cache without refetching
  const setDeals = useCallback(
    (updater: (prev: Deal[]) => Deal[]) => {
      queryClient.setQueryData<Deal[]>(['deals-all', loadAll], (prev) => updater(prev || []));
    },
    [queryClient, loadAll]
  );

  const handleUpdateDeal = async (dealId: string, updates: Partial<Deal>) => {
    try {
      
      // Get the existing deal for audit logging
      const existingDeal = deals.find(deal => deal.id === dealId);
      
      // Ensure we have all required fields for the update
      const updateData = {
        ...updates,
        modified_at: new Date().toISOString(),
        modified_by: user?.id
      };


      const { data, error } = await supabase
        .from('deals')
        .update(updateData as any)
        .eq('id', dealId)
        .select()
        .single();

      if (error) {
        console.error("Supabase update error:", error);
        throw error;
      }

      
      // Log update operation
      await logUpdate('deals', dealId, updates, existingDeal);
      
      // Update local state
      setDeals(prev => prev.map(deal => 
        deal.id === dealId ? { ...deal, ...updateData } : deal
      ));

    } catch (error: any) {
      console.error("Update deal error:", error);
      toast({
        title: "Error",
        description: `Failed to update deal: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleSaveDeal = async (dealData: Partial<Deal>) => {
    try {
      
      if (isCreating) {
        const insertData = { 
          ...dealData, 
          deal_name: dealData.project_name || dealData.deal_name || 'Untitled Deal',
          created_by: user?.id, // Ensure created_by is set for RLS
          modified_by: user?.id,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString()
        };
        

        const { data, error } = await supabase
          .from('deals')
          .insert([insertData] as any)
          .select()
          .single();

        if (error) {
          console.error("Insert error:", error);
          
          // Check for RLS policy violation
          if (error.message?.includes('row-level security') || 
              error.message?.includes('permission') ||
              error.code === 'PGRST301' || 
              error.code === '42501') {
            toast({
              title: "Permission Denied",
              description: "You don't have permission to create deals.",
              variant: "destructive",
            });
            return;
          }
          
          throw error;
        }


        // Log create operation
        await logCreate('deals', data.id, dealData);

        // Real-time subscription handles adding to state — no manual insert needed
      } else if (selectedDeal) {
        const updateData = {
          ...dealData,
          deal_name: dealData.project_name || selectedDeal.project_name || selectedDeal.deal_name || 'Untitled Deal',
          modified_at: new Date().toISOString(),
          modified_by: user?.id
        };
        
        
        await handleUpdateDeal(selectedDeal.id, updateData);
        await fetchDeals();
      }
    } catch (error: any) {
      console.error("Error in handleSaveDeal:", error);
      throw error;
    }
  };

  const handleDeleteDeals = async (dealIds: string[]) => {
    try {
      // Archiving runs through a server-side function: it validates the caller
      // (admin/super admin can archive any deal, everyone else only their own)
      // and returns the ids it archived, so we never need to read archived rows
      // back (viewing the archive stays super-admin only).
      const { data, error } = await (supabase as any).rpc('archive_deals', {
        p_ids: dealIds,
        p_reason: null,
      });

      if (error) {
        console.error("Archive error:", error, JSON.stringify(error));
        toast({
          title: "Error",
          description: error.message || "Failed to archive deals",
          variant: "destructive",
        });
        return;
      }

      const archivedIds: string[] = ((data as { id: string }[] | null) || []).map(r => r.id);
      const notArchived = dealIds.filter(id => !archivedIds.includes(id));

      if (archivedIds.length > 0) {
        const archivedDeals = deals.filter(d => archivedIds.includes(d.id));
        setDeals(prev => prev.filter(deal => !archivedIds.includes(deal.id)));

        if (archivedIds.length === 1) {
          await logDelete('deals', archivedIds[0], archivedDeals[0]);
        } else {
          await logBulkDelete('deals', archivedIds.length, archivedIds);
        }

        toast({
          title: "Moved to Archive",
          description: `${archivedIds.length} deal(s) archived. A super admin can restore or permanently delete them.`,
        });
      }

      if (notArchived.length > 0) {
        toast({
          title: "Permission Denied",
          description: `You don't have permission to archive ${notArchived.length} deal(s).`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Unexpected archive error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to archive deals",
        variant: "destructive",
      });
    }
  };



  const handleImportDeals = async (importedDeals: (Partial<Deal> & { shouldUpdate?: boolean })[]) => {
    // This function is kept for compatibility but the actual import logic is now handled
    // by the simplified CSV processor in useDealsImportExport hook
    // Refresh data after import
    await fetchDeals();
  };

  const handleCreateDeal = (stage: DealStage) => {
    setInitialStage(stage);
    setIsCreating(true);
    setSelectedDeal(null);
    setIsFormOpen(true);
  };

  const handleDealClick = (deal: Deal) => {
    setSelectedDeal(deal);
    setIsCreating(false);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setSelectedDeal(null);
    setIsCreating(false);
    setHighlightFields([]);
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  // Handle highlight from notification click
  useEffect(() => {
    if (highlightId && deals.length > 0 && !loading && !highlightProcessed) {
      const deal = deals.find(d => d.id === highlightId);
      if (deal) {
        setSelectedDeal(deal);
        setIsCreating(false);
        setHighlightFields(fixFields ? fixFields.split(',').filter(Boolean) : []);
        setIsFormOpen(true);
      } else {
        toast({
          title: "Deal not found",
          description: "The deal you're looking for may have been deleted.",
        });
      }
      setSearchParams({}, { replace: true });
      setHighlightProcessed(true);
    }
  }, [highlightId, fixFields, deals, loading, highlightProcessed, setSearchParams, toast]);

  // Reset processed state when highlightId changes
  useEffect(() => {
    if (highlightId) {
      setHighlightProcessed(false);
    }
  }, [highlightId]);

  useEffect(() => {
    if (user) {
      // useQuery already does the initial fetch — don't double-fetch on mount.
      // Set up real-time subscription — only when tab is visible to avoid
      // wasted re-renders when the user is on another tab.
      let channel: ReturnType<typeof supabase.channel> | null = null;

      const subscribe = () => {
        if (channel) return;
        channel = supabase
          .channel('deals-changes')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'deals' },
            (payload) => {
              if (payload.eventType === 'INSERT') {
                if ((payload.new as any)?.archived_at) return;
                setDeals(prev =>
                  prev.some(d => d.id === (payload.new as Deal).id)
                    ? prev
                    : [payload.new as Deal, ...prev]
                );
              } else if (payload.eventType === 'UPDATE') {
                // Archived deals leave the active pipeline (super admins see
                // them in the Archive dialog instead).
                if ((payload.new as any)?.archived_at) {
                  setDeals(prev => prev.filter(deal => deal.id !== payload.new.id));
                  return;
                }
                setDeals(prev => {
                  const exists = prev.some(d => d.id === payload.new.id);
                  return exists
                    ? prev.map(deal =>
                        deal.id === payload.new.id ? { ...deal, ...payload.new } as Deal : deal
                      )
                    : [payload.new as Deal, ...prev];
                });
              } else if (payload.eventType === 'DELETE') {

                setDeals(prev => prev.filter(deal => deal.id !== payload.old.id));
              }
            }

          )
          .subscribe();
      };

      const unsubscribe = () => {
        if (channel) {
          supabase.removeChannel(channel);
          channel = null;
        }
      };

      const onVisibility = () => {
        if (document.visibilityState === 'visible') {
          subscribe();
          fetchDeals();
        } else {
          unsubscribe();
        }
      };

      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        subscribe();
      }
      document.addEventListener('visibilitychange', onVisibility);

      // Listen for custom import events
      const handleImportEvent = () => {
        fetchDeals();
      };
      window.addEventListener('deals-data-updated', handleImportEvent);

      return () => {
        unsubscribe();
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('deals-data-updated', handleImportEvent);
      };
    }
  }, [user, fetchDeals, setDeals]);

  if (authLoading || loading) {
    return <AppLoader variant="page" label="Loading deals…" />;
  }

  if (!user) {
    return null;
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        value={activeView}
        onValueChange={(value) => value && setActiveView(value as 'kanban' | 'list')}
        className="border rounded-lg p-0.5 bg-muted/50"
      >
        <ToggleGroupItem
          value="kanban"
          aria-label="Kanban view"
          className="px-3 h-8 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm rounded-md"
        >
          <LayoutGrid className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="list"
          aria-label="List view"
          className="px-3 h-8 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm rounded-md"
        >
          <List className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>

      <Button onClick={() => handleCreateDeal('Lead')}>
        <Plus className="w-4 h-4 mr-2" />
        New Deal
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Main Content Area - Takes full height, header is inside each view */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeView === 'kanban' ? (
          <KanbanBoard
            deals={deals}
            onUpdateDeal={handleUpdateDeal}
            onDealClick={handleDealClick}
            onCreateDeal={handleCreateDeal}
            onDeleteDeals={handleDeleteDeals}
            onImportDeals={handleImportDeals}
            onRefresh={fetchDeals}
            headerActions={headerActions}
            onOpenArchive={() => setArchiveOpen(true)}
            canArchive={userRole === 'super_admin'}
            onLoadAll={() => setLoadAll(true)}
            hasMore={hasMore}
          />
        ) : (
          <ListView
            deals={deals}
            onDealClick={handleDealClick}
            onUpdateDeal={handleUpdateDeal}
            onDeleteDeals={handleDeleteDeals}
            onImportDeals={handleImportDeals}
            headerActions={headerActions}
          />
        )}
      </div>

      {/* Deal Form Modal */}
      <DealForm
        deal={selectedDeal}
        isOpen={isFormOpen}
        onClose={handleCloseForm}
        onSave={handleSaveDeal}
        onRefresh={fetchDeals}
        isCreating={isCreating}
        initialStage={initialStage}
        highlightFields={highlightFields}
         onDelete={(dealId) => {
           handleDeleteDeals([dealId]);
           setIsFormOpen(false);
           setSelectedDeal(null);
         }}
      />

      <ArchivedDealsDialog open={archiveOpen} onOpenChange={setArchiveOpen} />
    </div>
  );
};

export default DealsPage;
