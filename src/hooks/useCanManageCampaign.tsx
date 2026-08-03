import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns whether the current user may manage (send/pause/automate) the given
 * campaign. Delegates to the same `can_manage_campaign` Postgres function the
 * edge functions enforce server-side, so the UI and the server agree on a
 * single source of truth. This is defense-in-depth: the server is the real
 * gate (send-campaign-email / enqueue-campaign-send both re-check), and this
 * hook just prevents showing actions that would 403.
 *
 * Fails closed: while loading, on error, or without a campaign id it returns
 * false so management controls stay hidden until permission is confirmed.
 */
export function useCanManageCampaign(campaignId?: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ["can-manage-campaign", campaignId],
    enabled: !!campaignId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("can_manage_campaign", {
        _campaign_id: campaignId,
      });
      if (error) return false;
      return data === true;
    },
  });

  return { canManage: data === true, isLoading };
}
