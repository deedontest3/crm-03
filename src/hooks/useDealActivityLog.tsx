import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DealActivityEntry {
  id: string;
  deal_id: string;
  actor_id: string | null;
  event_type: string;
  field_name: string | null;
  old_value: any;
  new_value: any;
  context: any;
  created_at: string;
}

export const useDealActivityLog = (dealId?: string) => {
  const [entries, setEntries] = useState<DealActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchLog = useCallback(async () => {
    if (!dealId) {
      setEntries([]);
      return;
    }
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("deal_activity_log")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(500);
    // Race guard: ignore stale responses
    if (reqId !== requestIdRef.current) return;
    if (error) {
      setError(error.message);
      setEntries([]);
    } else {
      setEntries((data || []) as DealActivityEntry[]);
    }
    setLoading(false);
  }, [dealId]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    if (!dealId) return;
    const channelName = `deal-activity-${dealId}-${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "deal_activity_log", filter: `deal_id=eq.${dealId}` },
        (payload) => {
          const row = payload.new as DealActivityEntry;
          setEntries((prev) => (prev.some((e) => e.id === row.id) ? prev : [row, ...prev]));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deal_activity_log", filter: `deal_id=eq.${dealId}` },
        (payload) => {
          const row = payload.new as DealActivityEntry;
          setEntries((prev) => prev.map((e) => (e.id === row.id ? row : e)));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "deal_activity_log", filter: `deal_id=eq.${dealId}` },
        (payload) => {
          const row = payload.old as Partial<DealActivityEntry>;
          if (!row?.id) return;
          setEntries((prev) => prev.filter((e) => e.id !== row.id));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealId]);

  return { entries, loading, error, refetch: fetchLog };
};
