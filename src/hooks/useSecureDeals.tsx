
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSecureDataAccess } from '@/hooks/useSecureDataAccess';
import { useToast } from '@/hooks/use-toast';
import { useCRUDAudit } from '@/hooks/useCRUDAudit';
import { fetchAllRecords } from '@/utils/supabasePagination';

interface Deal {
  id: string;
  deal_name: string;
  project_name?: string;
  customer_name?: string;
  stage?: string;
  created_by?: string;
  created_at?: string;
  modified_at?: string;
  total_contract_value?: number;
  probability?: number;
  expected_closing_date?: string;
  currency_type?: string;
  priority?: number;
  lead_owner?: string;
  lead_name?: string;
}

export const useSecureDeals = () => {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const { secureQuery, secureExport } = useSecureDataAccess();
  const { logUpdate, logDelete } = useCRUDAudit();
  const { toast } = useToast();

  const fetchDeals = async () => {
    try {
      setLoading(true);
      const allDeals = await fetchAllRecords<Deal>('deals', 'created_at', false);
      setDeals(allDeals);
    } catch (error: any) {
      console.error('Error fetching deals:', error);
      toast({
        title: "Error",
        description: "Failed to fetch deals",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateDeal = async (id: string, updates: Partial<Deal>) => {
    try {
      console.log(`=== UPDATING DEAL ${id} ===`);
      console.log('Updates:', updates);
      
      // Get the existing deal for audit logging
      let existingDeal = deals.find(d => d.id === id);
      
      // If not found in local state, fetch from DB before update
      if (!existingDeal) {
        try {
          const { data } = await supabase
            .from('deals')
            .select('*')
            .eq('id', id)
            .single();
          if (data) existingDeal = data as Deal;
        } catch { /* proceed without old data */ }
      }
      
      const query = supabase
        .from('deals')
        .update({ ...updates, modified_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      const result = await secureQuery('deals', query, 'UPDATE');
      
      if (result.data) {
        setDeals(prev => prev.map(deal => 
          deal.id === id ? { ...deal, ...updates } : deal
        ));
        
        // Log the update with old/new values
        await logUpdate('deals', id, updates, existingDeal || {});
        
        console.log('Deal updated successfully');
        toast({
          title: "Success",
          description: "Deal updated successfully",
        });
      }
    } catch (error: any) {
      console.error('Error updating deal:', error);
      
      // Check if this is a permission error (RLS policy violation)
      if (error.message?.includes('row-level security') || 
          error.message?.includes('permission') ||
          error.code === 'PGRST301' || 
          error.code === '42501') {
        
        // Log unauthorized attempt
        try {
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from('security_audit_log').insert({
            user_id: user?.id,
            action: 'Unauthorized Update Attempt',
            resource_type: 'deals',
            resource_id: id,
            details: {
              operation: 'UPDATE',
              status: 'Blocked',
              timestamp: new Date().toISOString(),
              module: 'Deals',
              reason: 'Insufficient permissions'
            }
          });
        } catch (logError) {
          console.error('Failed to log unauthorized attempt:', logError);
        }

        toast({
          title: "Permission Denied",
          description: "You don't have permission to update this record.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to update deal",
          variant: "destructive",
        });
      }
      throw error;
    }
  };

  const deleteDeal = async (id: string) => {
    try {
      // First get the deal to check ownership and get data for logging
      const dealToDelete = deals.find(d => d.id === id);
      if (!dealToDelete) {
        throw new Error('Deal not found');
      }

      const query = supabase
        .from('deals')
        .delete()
        .eq('id', id)
        .select()
        .single();

      const result = await secureQuery('deals', query, 'DELETE');
      
      // If we get here, the deletion was successful
      setDeals(prev => prev.filter(deal => deal.id !== id));
      
      // Log successful deletion
      await logDelete('deals', id, dealToDelete);
      
      toast({
        title: "Success",
        description: "Deal deleted successfully",
      });
    } catch (error: any) {
      console.error('Error deleting deal:', error);
      
      // Check if this is a permission error (RLS policy violation)
      if (error.message?.includes('row-level security') || 
          error.message?.includes('permission') ||
          error.code === 'PGRST301' || 
          error.code === '42501') {
        
        // Log unauthorized attempt
        try {
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from('security_audit_log').insert({
            user_id: user?.id,
            action: 'Unauthorized Delete Attempt',
            resource_type: 'deals',
            resource_id: id,
            details: {
              operation: 'DELETE',
              status: 'Blocked',
              timestamp: new Date().toISOString(),
              module: 'Deals',
              reason: 'Insufficient permissions'
            }
          });
        } catch (logError) {
          console.error('Failed to log unauthorized attempt:', logError);
        }

        toast({
          title: "Permission Denied",
          description: "You don't have permission to delete this record.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to delete deal",
          variant: "destructive",
        });
      }
      throw error;
    }
  };

  useEffect(() => {
    fetchDeals();
  }, []);

  return {
    deals,
    loading,
    fetchDeals,
    updateDeal,
    deleteDeal
  };
};
