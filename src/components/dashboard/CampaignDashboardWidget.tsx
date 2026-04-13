import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Target, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function CampaignDashboardWidget() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["campaign-dashboard-widget"],
    queryFn: async () => {
      // Fetch active campaigns
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, campaign_name, status")
        .is("archived_at", null);

      const activeCampaigns = campaigns?.filter((c) => c.status === "Active") || [];
      const allCampaigns = campaigns || [];

      // Fetch MART data
      const { data: martData } = await supabase.from("campaign_mart").select("*");

      // Compute avg MART completion
      let totalFlags = 0;
      let doneFlags = 0;
      const campaignIds = allCampaigns.map((c) => c.id);
      martData?.forEach((m) => {
        if (campaignIds.includes(m.campaign_id)) {
          totalFlags += 4;
          doneFlags += [m.message_done, m.audience_done, m.region_done, m.timing_done].filter(Boolean).length;
        }
      });
      const avgMart = totalFlags > 0 ? Math.round((doneFlags / totalFlags) * 100) : 0;

      // Fetch contacts for response rate
      const { data: contacts } = await supabase
        .from("campaign_contacts")
        .select("campaign_id, stage");

      const campaignResponseRates: { id: string; name: string; rate: number }[] = [];
      allCampaigns.forEach((c) => {
        const cContacts = contacts?.filter((cc) => cc.campaign_id === c.id) || [];
        if (cContacts.length === 0) return;
        const responded = cContacts.filter(
          (cc) => cc.stage === "Responded" || cc.stage === "Qualified" || cc.stage === "Converted"
        ).length;
        campaignResponseRates.push({
          id: c.id,
          name: c.campaign_name,
          rate: Math.round((responded / cContacts.length) * 100),
        });
      });

      campaignResponseRates.sort((a, b) => b.rate - a.rate);

      return {
        activeCount: activeCampaigns.length,
        totalCount: allCampaigns.length,
        avgMart,
        topCampaigns: campaignResponseRates.slice(0, 3),
      };
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Megaphone className="h-5 w-5 text-primary" />
          Campaign Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-3 rounded-lg bg-primary/5">
            <div className="text-2xl font-bold text-primary">{data.activeCount}</div>
            <div className="text-xs text-muted-foreground">Active Campaigns</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-primary/5">
            <div className="text-2xl font-bold text-primary">{data.avgMart}%</div>
            <div className="text-xs text-muted-foreground">Avg MART Done</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-primary/5">
            <div className="text-2xl font-bold text-primary">{data.totalCount}</div>
            <div className="text-xs text-muted-foreground">Total Campaigns</div>
          </div>
        </div>

        {data.topCampaigns.length > 0 && (
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              Top by Response Rate
            </div>
            <div className="space-y-2">
              {data.topCampaigns.map((c, i) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span className="truncate flex-1 mr-2">
                    <span className="text-muted-foreground mr-1">{i + 1}.</span>
                    {c.name}
                  </span>
                  <Badge
                    variant="secondary"
                    className={
                      c.rate >= 50
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                        : c.rate >= 20
                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {c.rate}%
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.topCampaigns.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-2">
            No campaign contacts yet
          </div>
        )}
      </CardContent>
    </Card>
  );
}
