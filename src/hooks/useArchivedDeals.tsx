import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { invalidateDealCaches } from "@/lib/dealCacheInvalidation";

export interface ArchivedDeal {
  id: string;
  project_name: string | null;
  deal_name: string | null;
  customer_name: string | null;
  stage: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
}

const QUERY_KEY = ["archived-deals"] as const;

export function useArchivedDeals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ArchivedDeal[]> => {
      const { data, error } = await supabase
        .from("deals")
        .select("id,project_name,deal_name,customer_name,stage,archived_at,archived_by,archive_reason")
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ArchivedDeal[];
    },
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("deals")
        .update({
          archived_at: null,
          archived_by: null,
          archive_reason: null,
          modified_at: new Date().toISOString(),
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateDealCaches(queryClient);
      toast({ title: "Deal restored", description: "The deal is back in the active pipeline." });
    },
    onError: (err: any) => {
      toast({ title: "Restore failed", description: err?.message || "Unknown error", variant: "destructive" });
    },
  });

  const hardDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("deals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateDealCaches(queryClient);
      toast({ title: "Deal permanently deleted", description: "The deal and all related records have been removed." });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err?.message || "Unknown error", variant: "destructive" });
    },
  });

  return {
    deals: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    restore: restore.mutate,
    isRestoring: restore.isPending,
    hardDelete: hardDelete.mutate,
    isDeleting: hardDelete.isPending,
  };
}
