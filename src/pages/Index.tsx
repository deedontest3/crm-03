import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Deal, DealStage } from "@/types/deal";
import { DealForm } from "@/components/DealForm";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { DashboardContent } from "@/components/dashboard/DashboardContent";
import { useToast } from "@/hooks/use-toast";
import { invalidateDealCaches } from "@/lib/dealCacheInvalidation";
import { AppLoader } from "@/components/ui/loader";

const Index = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [initialStage, setInitialStage] = useState<DealStage>('Lead');
  const [activeView, setActiveView] = useState<'kanban' | 'list'>('kanban');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchDeals();
    }
  }, [user]);

  const fetchDeals = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('deals')
        .select('*')
        .is('archived_at', null)
        .order('modified_at', { ascending: false });

      if (error) {
        toast({
          title: "Error",
          description: "Failed to fetch deals",
          variant: "destructive",
        });
        return;
      }

      setDeals((data || []) as unknown as Deal[]);
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateDeal = async (dealId: string, updates: Partial<Deal>) => {
    try {
      const { error } = await supabase
        .from('deals')
        .update({ ...updates, modified_at: new Date().toISOString() } as any)
        .eq('id', dealId);

      if (error) throw error;

      setDeals(prev => prev.map(deal => 
        deal.id === dealId ? { ...deal, ...updates } : deal
      ));
      invalidateDealCaches(queryClient);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update deal",
        variant: "destructive",
      });
    }
  };

  const handleSaveDeal = async (dealData: Partial<Deal>) => {
    try {
      if (isCreating) {
        const { data, error } = await supabase
          .from('deals')
          .insert([{ 
            ...dealData, 
            deal_name: dealData.project_name || 'Untitled Deal',
            created_by: user?.id,
            modified_by: user?.id 
          }])
          .select()
          .single();

        if (error) throw error;

        setDeals(prev => [data as unknown as Deal, ...prev]);
        invalidateDealCaches(queryClient);
      } else if (selectedDeal) {
        const updateData = {
          ...dealData,
          deal_name: dealData.project_name || selectedDeal.project_name || 'Untitled Deal',
          modified_at: new Date().toISOString(),
          modified_by: user?.id
        };
        
        console.log("Updating deal with data:", updateData);
        
        await handleUpdateDeal(selectedDeal.id, updateData);
        
        await fetchDeals();
      }
    } catch (error) {
      console.error("Error in handleSaveDeal:", error);
      throw error;
    }
  };

  const handleDeleteDeals = async (dealIds: string[]) => {
    try {
      // Same server-side archive path as the Deals page: admins/super admins can
      // archive any deal, everyone else only their own.
      const { data, error } = await (supabase as any).rpc('archive_deals', {
        p_ids: dealIds,
        p_reason: null,
      });

      if (error) {
        console.error("Archive error:", error);
        const isPermission =
          error.code === '42501' ||
          error.code === 'PGRST301' ||
          /row-level security|permission|not authenticated/i.test(error.message || '');
        toast({
          title: isPermission ? "Permission Denied" : "Couldn't archive deals",
          description: error.message || "Failed to archive deals",
          variant: "destructive",
        });
        return;
      }

      const archivedIds: string[] = ((data as { id: string }[] | null) || []).map(r => r.id);
      const notArchived = dealIds.filter(id => !archivedIds.includes(id));

      if (archivedIds.length > 0) {
        setDeals(prev => prev.filter(deal => !archivedIds.includes(deal.id)));
        invalidateDealCaches(queryClient);
        toast({
          title: "Moved to Archive",
          description: `${archivedIds.length} deal(s) archived`,
        });
      }

      if (notArchived.length > 0) {
        toast({
          title: "Some deals were skipped",
          description: `${notArchived.length} deal(s) were not archived — they were already archived or you don't own them.`,
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
    try {
      let createdCount = 0;
      let updatedCount = 0;

      for (const importDeal of importedDeals) {
        const { shouldUpdate, ...dealData } = importDeal;
        
        const existingDeal = deals.find(d => 
          (dealData.id && d.id === dealData.id) || 
          (dealData.project_name && d.project_name === dealData.project_name)
        );

        if (existingDeal) {
          const { data, error } = await supabase
            .from('deals')
            .update({
              ...dealData,
              modified_by: user?.id,
              deal_name: dealData.project_name || existingDeal.deal_name
            } as any)
            .eq('id', existingDeal.id)
            .select()
            .single();

          if (error) throw error;
          updatedCount++;
        } else {
          const newDealData = {
            ...dealData,
            stage: dealData.stage || 'Lead' as const,
            created_by: user?.id,
            modified_by: user?.id,
            deal_name: dealData.project_name || `Imported Deal ${Date.now()}`
          };

          const { data, error } = await supabase
            .from('deals')
            .insert(newDealData as any)
            .select()
            .single();

          if (error) throw error;
          createdCount++;
        }
      }

      await fetchDeals();
      invalidateDealCaches(queryClient);

      
      toast({
        title: "Import successful",
        description: `Created ${createdCount} new deals, updated ${updatedCount} existing deals`,
      });
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: "Error",
        description: "Failed to import deals. Please check the CSV format.",
        variant: "destructive",
      });
    }
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
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  if (authLoading || loading) {
    return <AppLoader variant="page" label="Loading dashboard…" />;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader
        activeView={activeView}
        onViewChange={setActiveView}
        onCreateDeal={() => handleCreateDeal('Lead')}
        onSignOut={handleSignOut}
      />

      <DashboardStats deals={deals} />

      <DashboardContent
        activeView={activeView}
        deals={deals}
        onUpdateDeal={handleUpdateDeal}
        onDealClick={handleDealClick}
        onCreateDeal={handleCreateDeal}
        onDeleteDeals={handleDeleteDeals}
        onImportDeals={handleImportDeals}
        onRefresh={fetchDeals}
      />

      <DealForm
        deal={selectedDeal}
        isOpen={isFormOpen}
        onClose={handleCloseForm}
        onSave={handleSaveDeal}
        onRefresh={fetchDeals}
        isCreating={isCreating}
        initialStage={initialStage}
      />
    </div>
  );
};

export default Index;
