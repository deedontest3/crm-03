import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, Users, Building2, Mail, Phone, MessageSquare, TrendingUp, RefreshCw } from "lucide-react";

interface Props {
  campaignId: string;
}

export function CampaignAnalytics({ campaignId }: Props) {
  const queryClient = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["campaign-accounts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_accounts").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["campaign-contacts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_contacts").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: communications = [] } = useQuery({
    queryKey: ["campaign-communications", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_communications").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: deals = [] } = useQuery({
    queryKey: ["campaign-deals", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("deals").select("id, stage").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-deals", campaignId] });
  };

  const emails = communications.filter((c) => c.communication_type === "Email");
  const calls = communications.filter((c) => c.communication_type === "Call");
  const linkedIn = communications.filter((c) => c.communication_type === "LinkedIn");
  const responded = contacts.filter((c) => c.stage === "Responded" || c.stage === "Qualified");
  const dealsWon = deals.filter((d) => d.stage === "Won");

  const stats = [
    { label: "Accounts Targeted", value: accounts.length, icon: Building2 },
    { label: "Contacts Targeted", value: contacts.length, icon: Users },
    { label: "Emails Sent", value: emails.length, icon: Mail },
    { label: "Calls Made", value: calls.length, icon: Phone },
    { label: "LinkedIn Messages", value: linkedIn.length, icon: MessageSquare },
    { label: "Responses", value: responded.length, icon: TrendingUp },
    { label: "Deals Created", value: deals.length, icon: BarChart3 },
    { label: "Deals Won", value: dealsWon.length, icon: BarChart3 },
  ];

  const funnel = [
    { label: "Targeted", value: contacts.length },
    { label: "Contacted", value: contacts.filter((c) => c.stage !== "Not Contacted").length },
    { label: "Responded", value: responded.length },
    { label: "Qualified", value: contacts.filter((c) => c.stage === "Qualified").length },
    { label: "Deal Created", value: deals.length },
    { label: "Won", value: dealsWon.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {/* Stats Grid — responsive */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <s.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader><CardTitle className="text-base">Conversion Funnel</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {funnel.map((stage, i) => {
              const maxVal = funnel[0].value || 1;
              const pct = Math.round((stage.value / maxVal) * 100);
              return (
                <div key={stage.label} className="flex items-center gap-4">
                  <div className="w-28 text-sm text-muted-foreground">{stage.label}</div>
                  <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                    <div className="h-full bg-primary/80 rounded-full flex items-center justify-end pr-2 transition-all" style={{ width: `${stage.value === 0 ? 0 : Math.max(pct, 5)}%` }}>
                      <span className="text-xs font-medium text-primary-foreground">{stage.value}</span>
                    </div>
                  </div>
                  <div className="w-14 text-xs text-muted-foreground text-right">{pct}%</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
