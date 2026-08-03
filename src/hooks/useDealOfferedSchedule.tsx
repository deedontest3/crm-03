import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCallback } from "react";

export interface OfferedScheduleRow {
  id?: string;
  deal_id: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  revenue: number;
}

const KEY = (dealId?: string | null) => ['deal-offered-schedule', dealId] as const;

export const useDealOfferedSchedule = (dealId?: string | null) => {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: KEY(dealId),
    enabled: !!dealId,
    queryFn: async (): Promise<OfferedScheduleRow[]> => {
      const { data, error } = await supabase
        .from('deal_offered_schedule' as any)
        .select('id, deal_id, year, quarter, revenue')
        .eq('deal_id', dealId!)
        .order('year', { ascending: true })
        .order('quarter', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as OfferedScheduleRow[];
    },
  });

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: KEY(dealId) });
    qc.invalidateQueries({ queryKey: ['yearly-revenue'] });
    qc.invalidateQueries({ queryKey: ['available-years'] });
    qc.invalidateQueries({ queryKey: ['available-fiscal-years'] });
    qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
  }, [qc, dealId]);

  const upsertCell = useMutation({
    mutationFn: async ({ year, quarter, revenue }: { year: number; quarter: 1|2|3|4; revenue: number }) => {
      if (!dealId) throw new Error('dealId required');
      if (revenue <= 0) {
        const { error } = await supabase
          .from('deal_offered_schedule' as any)
          .delete()
          .eq('deal_id', dealId)
          .eq('year', year)
          .eq('quarter', quarter);
        if (error) throw error;
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('deal_offered_schedule' as any)
        .upsert(
          { deal_id: dealId, year, quarter, revenue, created_by: user?.id },
          { onConflict: 'deal_id,year,quarter' }
        );
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const deleteMany = useCallback(async (cells: Array<{ year: number; quarter: 1|2|3|4 }>) => {
    if (!dealId || cells.length === 0) return;
    for (const c of cells) {
      const { error } = await supabase
        .from('deal_offered_schedule' as any)
        .delete()
        .eq('deal_id', dealId)
        .eq('year', c.year)
        .eq('quarter', c.quarter);
      if (error) throw error;
    }
    invalidateAll();
  }, [dealId, invalidateAll]);

  return { rows, isLoading, upsertCell: upsertCell.mutateAsync, deleteMany };
};
