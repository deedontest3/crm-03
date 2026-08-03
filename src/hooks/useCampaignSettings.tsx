/**
 * Per-tenant campaign settings stored in `campaign_settings` (key/value text rows).
 *
 * Currently exposed:
 *   - enqueue_threshold (default 25): bulk-recipient count above which the
 *     EmailComposeModal hands the batch off to the durable backend send queue
 *     instead of looping `send-campaign-email` from the browser.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SETTINGS_KEYS = ["enqueue_threshold", "duplicate_send_window_days"] as const;
type SettingKey = (typeof SETTINGS_KEYS)[number];

const DEFAULTS: Record<SettingKey, string> = {
  enqueue_threshold: "25",
  duplicate_send_window_days: "3",
};

export interface CampaignSettings {
  enqueueThreshold: number;
  duplicateSendWindowDays: number;
}

function parseInteger(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function useCampaignSettings() {
  const query = useQuery({
    queryKey: ["campaign-settings"],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Record<SettingKey, string>> => {
      // Use the security-definer RPC so non-admin users (who can no longer
      // SELECT from campaign_settings directly) still get the whitelisted
      // values they need.
      const map: Record<string, string> = {};
      await Promise.all(
        SETTINGS_KEYS.map(async (key) => {
          const { data, error } = await (supabase as any).rpc("get_campaign_setting", { _key: key });
          if (error) {
            console.warn(`[campaign-settings] failed to read ${key}:`, error.message);
            return;
          }
          if (typeof data === "string" && data.length > 0) {
            map[key] = data;
          }
        }),
      );
      return { ...DEFAULTS, ...map } as Record<SettingKey, string>;
    },
  });


  const raw = query.data ?? DEFAULTS;
  const settings: CampaignSettings = {
    enqueueThreshold: parseInteger(raw.enqueue_threshold, 25),
    duplicateSendWindowDays: parseInteger(raw.duplicate_send_window_days, 3),
  };

  return {
    settings,
    isLoading: query.isLoading,
  };
}
