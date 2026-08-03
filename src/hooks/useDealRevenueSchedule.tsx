import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface RevenueScheduleRow {
  id?: string;
  deal_id: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  revenue: number;
}

const KEY = (dealId?: string | null) => ['deal-revenue-schedule', dealId] as const;

export const useDealRevenueSchedule = (dealId?: string | null) => {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: KEY(dealId),
    enabled: !!dealId,
    queryFn: async (): Promise<RevenueScheduleRow[]> => {
      const { data, error } = await supabase
        .from('deal_revenue_schedule' as any)
        .select('id, deal_id, year, quarter, revenue')
        .eq('deal_id', dealId!)
        .order('year', { ascending: true })
        .order('quarter', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as RevenueScheduleRow[];
    },
  });

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: KEY(dealId) });
    qc.invalidateQueries({ queryKey: ['yearly-revenue'] });
    qc.invalidateQueries({ queryKey: ['available-years'] });
    qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
  }, [qc, dealId]);

  const upsertCell = useMutation({
    mutationFn: async ({ year, quarter, revenue }: { year: number; quarter: 1|2|3|4; revenue: number }) => {
      if (!dealId) throw new Error('dealId required');
      if (revenue <= 0) {
        // keep table sparse
        const { error } = await supabase
          .from('deal_revenue_schedule' as any)
          .delete()
          .eq('deal_id', dealId)
          .eq('year', year)
          .eq('quarter', quarter);
        if (error) throw error;
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('deal_revenue_schedule' as any)
        .upsert(
          { deal_id: dealId, year, quarter, revenue, created_by: user?.id },
          { onConflict: 'deal_id,year,quarter' }
        );
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  // Bulk insert (for newly created deals — flush buffered cells in one round-trip)
  const insertMany = useCallback(async (cells: Array<{ year: number; quarter: 1|2|3|4; revenue: number }>, forDealId: string) => {
    const nonZero = cells.filter(c => c.revenue > 0);
    if (nonZero.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    const payload = nonZero.map(c => ({ ...c, deal_id: forDealId, created_by: user?.id }));
    const { error } = await supabase
      .from('deal_revenue_schedule' as any)
      .upsert(payload, { onConflict: 'deal_id,year,quarter' });
    if (error) throw error;
    invalidateAll();
  }, [invalidateAll]);

  const deleteMany = useCallback(async (cells: Array<{ year: number; quarter: 1|2|3|4 }>) => {
    if (!dealId || cells.length === 0) return;
    for (const c of cells) {
      const { error } = await supabase
        .from('deal_revenue_schedule' as any)
        .delete()
        .eq('deal_id', dealId)
        .eq('year', c.year)
        .eq('quarter', c.quarter);
      if (error) throw error;
    }
    invalidateAll();
  }, [dealId, invalidateAll]);

  return { rows, isLoading, upsertCell: upsertCell.mutateAsync, insertMany, deleteMany };
};

/** Debounce helper for per-cell upserts. */
export const useDebouncedCallback = <T extends (...args: any[]) => void>(fn: T, delay = 400) => {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (ref.current) clearTimeout(ref.current); }, []);
  return useCallback((...args: Parameters<T>) => {
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
};

/** Buffered cell state hook for both new & existing deals. */
export const useScheduleCells = (initial: RevenueScheduleRow[]) => {
  const signature = initial
    .map((r) => `${r.year}:${r.quarter}:${Number(r.revenue) || 0}`)
    .sort()
    .join('|');

  const [cells, setCells] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    initial.forEach(r => m.set(`${r.year}:${r.quarter}`, Number(r.revenue) || 0));
    return m;
  });

  // sync only when the server signature actually changes (avoids wiping user input
  // on re-renders where `initial` is a fresh array reference but same content)
  useEffect(() => {
    setCells(() => {
      const m = new Map<string, number>();
      initial.forEach(r => m.set(`${r.year}:${r.quarter}`, Number(r.revenue) || 0));
      return m;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const get = useCallback((year: number, quarter: 1|2|3|4) => cells.get(`${year}:${quarter}`) ?? 0, [cells]);
  const set = useCallback((year: number, quarter: 1|2|3|4, value: number) => {
    setCells(prev => {
      const m = new Map(prev);
      m.set(`${year}:${quarter}`, value);
      return m;
    });
  }, []);
  const total = Array.from(cells.values()).reduce((a, b) => a + (Number(b) || 0), 0);
  const totalByYear = (year: number) =>
    [1,2,3,4].reduce((a, q) => a + (cells.get(`${year}:${q}`) ?? 0), 0);
  const yearsWithData = Array.from(new Set(Array.from(cells.keys()).map(k => Number(k.split(':')[0])))).sort();

  return { get, set, total, totalByYear, yearsWithData, allCells: cells };
};

