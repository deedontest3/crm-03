import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { format } from "date-fns";
import { Activity } from "lucide-react";

interface Props {
  campaignId: string;
}

const EVENT_LABEL: Record<string, string> = {
  status_changed: "Status changed",
  send_job_created: "Send job created",
  send_job_completed: "Send job completed",
  send_job_paused: "Send job paused",
  approval_requested: "Approval requested",
  approval_approved: "Approval approved",
  approval_rejected: "Approval rejected",
  bulk_pause: "All sends paused",
  trigger_enrolled: "Automation enrolled contact",
};

export function CampaignActivityTab({ campaignId }: Props) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["campaign-events", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_events")
        .select("id, event_type, from_value, to_value, reason, metadata, actor_user_id, created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const actorIds = useMemo(
    () => Array.from(new Set(events.map((e: any) => e.actor_user_id).filter(Boolean))),
    [events]
  );
  const { displayNames } = useUserDisplayNames(actorIds as string[]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
        ) : events.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No activity yet.</div>
        ) : (
          <ol className="relative border-l border-border pl-6 space-y-4">
            {events.map((e: any) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="text-sm font-medium">
                    {EVENT_LABEL[e.event_type] || e.event_type}
                    {e.from_value && e.to_value && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {e.from_value} → {e.to_value}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(e.created_at), "PPp")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {e.actor_user_id ? displayNames[e.actor_user_id] || "user" : "system"}
                  {e.reason && ` • ${e.reason}`}
                </div>
                {e.metadata && Object.keys(e.metadata).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(e.metadata).slice(0, 4).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-xs">
                        {k}: {String(v).slice(0, 40)}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
