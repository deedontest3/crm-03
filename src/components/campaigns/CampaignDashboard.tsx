import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Megaphone, Zap, FileEdit, CheckCircle2, PauseCircle } from "lucide-react";
import { format } from "date-fns";

interface Campaign {
  id: string;
  campaign_name: string;
  campaign_type: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  owner: string | null;
  archived_at: string | null;
  created_at: string | null;
}

interface CampaignDashboardProps {
  campaigns: Campaign[];
  getMartProgress: (id: string) => { count: number; total: number };
}

const statusColors: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Active: "bg-primary/10 text-primary",
  Paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export function CampaignDashboard({ campaigns, getMartProgress }: CampaignDashboardProps) {
  const navigate = useNavigate();

  const active = campaigns.filter((c) => c.status === "Active").length;
  const draft = campaigns.filter((c) => c.status === "Draft").length;
  const completed = campaigns.filter((c) => c.status === "Completed").length;
  const paused = campaigns.filter((c) => c.status === "Paused").length;

  const stats = [
    { label: "Total", value: campaigns.length, icon: Megaphone, color: "text-primary" },
    { label: "Active", value: active, icon: Zap, color: "text-green-600 dark:text-green-400" },
    { label: "Draft", value: draft, icon: FileEdit, color: "text-muted-foreground" },
    { label: "Completed", value: completed, icon: CheckCircle2, color: "text-blue-600 dark:text-blue-400" },
    { label: "Paused", value: paused, icon: PauseCircle, color: "text-yellow-600 dark:text-yellow-400" },
  ];

  // MART progress for active/draft campaigns
  const martCampaigns = campaigns
    .filter((c) => c.status === "Active" || c.status === "Draft")
    .slice(0, 8);

  // Recent campaigns sorted by created_at
  const recent = [...campaigns]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 5);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-none">
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`h-5 w-5 ${s.color} shrink-0`} />
              <div>
                <p className="text-2xl font-semibold leading-none">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MART Progress */}
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">MART Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {martCampaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active campaigns</p>
            ) : (
              martCampaigns.map((c) => {
                const { count, total } = getMartProgress(c.id);
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 rounded-md p-2 -mx-2 transition-colors"
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                  >
                    <span className="text-sm truncate flex-1 min-w-0">{c.campaign_name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{count}/{total}</span>
                    <Progress value={pct} className="w-20 h-2 shrink-0" />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Status Breakdown */}
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Active", count: active, color: "bg-primary" },
              { label: "Draft", count: draft, color: "bg-muted-foreground" },
              { label: "Completed", count: completed, color: "bg-blue-500" },
              { label: "Paused", count: paused, color: "bg-yellow-500" },
            ].map((item) => {
              const pct = campaigns.length > 0 ? (item.count / campaigns.length) * 100 : 0;
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.color} shrink-0`} />
                  <span className="text-sm flex-1">{item.label}</span>
                  <span className="text-sm font-medium">{item.count}</span>
                  <div className="w-24 bg-muted rounded-full h-2 shrink-0">
                    <div className={`${item.color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Recent Campaigns */}
      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Recent Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {recent.map((c) => (
              <div
                key={c.id}
                className="border rounded-lg p-3 cursor-pointer hover:bg-muted/50 transition-colors space-y-2"
                onClick={() => navigate(`/campaigns/${c.id}`)}
              >
                <p className="text-sm font-medium truncate">{c.campaign_name}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={statusColors[c.status || "Draft"]} variant="secondary">
                    {c.status || "Draft"}
                  </Badge>
                  {c.campaign_type && (
                    <span className="text-xs text-muted-foreground">{c.campaign_type}</span>
                  )}
                </div>
                {c.start_date && (
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(c.start_date + "T00:00:00"), "dd MMM yyyy")}
                    {c.end_date && ` — ${format(new Date(c.end_date + "T00:00:00"), "dd MMM yyyy")}`}
                  </p>
                )}
              </div>
            ))}
            {recent.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full">No campaigns yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
