import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2, Users, MessageSquare, TrendingUp,
  Target, FileText, BarChart3, ArrowRight
} from "lucide-react";
import { format } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";

interface StrategyComplete {
  message: boolean;
  audience: boolean;
  region: boolean;
  timing: boolean;
}

interface Props {
  campaign: any;
  accounts: any[];
  contacts: any[];
  communications: any[];
  isStrategyComplete: StrategyComplete;
  strategyProgress: number;
  onTabChange: (tab: string) => void;
}

const statusColors: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Active: "bg-primary/10 text-primary",
  Paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const stageOrder = ["Not Contacted", "Contacted", "Responded", "Qualified", "Converted"];

function parseRegionToCountries(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const r = JSON.parse(raw);
    if (Array.isArray(r)) {
      return Array.from(new Set(r.map((item: any) =>
        typeof item === "object" && item !== null ? item.country || item.region : String(item)
      ).filter(Boolean)));
    }
    if (typeof r === "object" && r !== null) {
      const out: string[] = [];
      Object.values(r).forEach((v) => {
        if (Array.isArray(v)) out.push(...(v as string[]));
        else if (v) out.push(String(v));
      });
      return Array.from(new Set(out));
    }
  } catch {}
  return [raw];
}

export function CampaignOverview({
  campaign, accounts, contacts, communications,
  isStrategyComplete, strategyProgress, onTabChange
}: Props) {
  const { data: deals = [] } = useQuery({
    queryKey: ["campaign-deals-overview", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("id, stage, total_contract_value")
        .eq("campaign_id", campaign.id);
      if (error) throw error;
      return data;
    },
  });

  const emailCount = communications.filter((c: any) => c.communication_type === "Email").length;
  const callCount = communications.filter((c: any) => c.communication_type === "Call" || c.communication_type === "Phone").length;
  const linkedinCount = communications.filter((c: any) => c.communication_type === "LinkedIn").length;
  const outreachTotal = emailCount + callCount + linkedinCount;
  const responseCount = contacts.filter((c: any) =>
    c.stage === "Responded" || c.stage === "Qualified" || c.stage === "Converted"
  ).length;

  const stageData = useMemo(() => {
    const counts: Record<string, number> = {};
    stageOrder.forEach(s => counts[s] = 0);
    contacts.forEach((c: any) => {
      const stage = c.stage || "Not Contacted";
      if (counts[stage] !== undefined) counts[stage]++;
      else counts["Not Contacted"]++;
    });
    return stageOrder.map(s => ({ stage: s, count: counts[s] }));
  }, [contacts]);

  const maxStage = Math.max(1, ...stageData.map(s => s.count));

  const timelineData = useMemo(() => {
    if (communications.length === 0) return [];
    const weekMap: Record<string, number> = {};
    communications.forEach((c: any) => {
      if (!c.communication_date) return;
      const d = new Date(c.communication_date);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = format(weekStart, "dd MMM");
      weekMap[key] = (weekMap[key] || 0) + 1;
    });
    return Object.entries(weekMap)
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([week, count]) => ({ week, count }));
  }, [communications]);

  const totalDealValue = deals.reduce((sum: number, d: any) => sum + (d.total_contract_value || 0), 0);
  const countries = useMemo(() => parseRegionToCountries(campaign.region), [campaign.region]);
  const description = (campaign.description || "").trim();
  const goal = (campaign.goal || "").trim();
  const notes = (campaign.notes || "").replace(/\[timezone:.+?\]\s*/g, "").trim();

  const KPI = ({ label, value, icon: Icon, sub, onClick }: {
    label: string; value: number | string; icon: any; sub?: string; onClick?: () => void;
  }) => (
    <div
      className={`rounded-md border bg-card p-2 ${onClick ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="mt-0.5 text-lg font-semibold leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* 6-KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KPI label="Accounts" value={accounts.length} icon={Building2} onClick={() => onTabChange("setup")} />
        <KPI label="Contacts" value={contacts.length} icon={Users} onClick={() => onTabChange("setup")} />
        <KPI
          label="Outreach"
          value={outreachTotal}
          icon={MessageSquare}
          sub={`${emailCount} ✉ · ${callCount} ☎ · ${linkedinCount} in`}
          onClick={() => onTabChange("monitoring")}
        />
        <KPI
          label="Responses"
          value={responseCount}
          icon={TrendingUp}
          sub={contacts.length > 0 ? `${Math.round((responseCount / contacts.length) * 100)}% rate` : undefined}
        />
        <KPI
          label="Deals"
          value={deals.length}
          icon={BarChart3}
          sub={totalDealValue > 0 ? `€${totalDealValue.toLocaleString()}` : undefined}
          onClick={() => onTabChange("monitoring")}
        />
        <KPI
          label="Setup"
          value={`${strategyProgress}/4`}
          icon={Target}
          sub={`${Math.round((strategyProgress / 4) * 100)}% done`}
          onClick={() => onTabChange("setup")}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Funnel - CSS bars */}
        <Card className="border">
          <CardHeader className="py-2">
            <CardTitle className="text-xs font-medium flex items-center gap-2 cursor-pointer hover:text-primary transition-colors" onClick={() => onTabChange("setup")}>
              <Users className="h-3.5 w-3.5" /> Contact Funnel <ArrowRight className="h-3 w-3 ml-auto opacity-60" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No contacts added yet</p>
            ) : (
              <div className="space-y-1.5">
                {stageData.map((s) => (
                  <div key={s.stage} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-muted-foreground truncate">{s.stage}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${(s.count / maxStage) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-right tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="border">
          <CardHeader className="py-2">
            <CardTitle className="text-xs font-medium flex items-center gap-2 cursor-pointer hover:text-primary transition-colors" onClick={() => onTabChange("monitoring")}>
              <MessageSquare className="h-3.5 w-3.5" /> Recent Activity <ArrowRight className="h-3 w-3 ml-auto opacity-60" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {communications.length === 0 ? (
              <p className="text-xs text-muted-foreground">No activity yet</p>
            ) : (
              <div className="space-y-1">
                {communications.slice(0, 5).map((c: any) => {
                  const snippet = (c.subject || c.notes || "").toString().trim();
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
                      onClick={() => onTabChange("monitoring")}
                    >
                      <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">{c.communication_type}</Badge>
                      <span className="shrink-0 truncate max-w-[100px]">{c.contacts?.contact_name || "Unknown"}</span>
                      {snippet && <span className="text-muted-foreground truncate flex-1">· {snippet}</span>}
                      <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                        {c.communication_date ? format(new Date(c.communication_date), "dd MMM") : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Outreach Timeline - only when meaningful */}
      {timelineData.length >= 3 && (
        <Card className="border">
          <CardHeader className="py-2">
            <CardTitle className="text-xs font-medium flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5" /> Outreach Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={timelineData} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={24} />
                <Tooltip formatter={(v: number) => [v, "Messages"]} />
                <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Unified details card */}
      <Card className="border">
        <CardHeader className="py-2">
          <CardTitle className="text-xs font-medium flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" /> Campaign Details
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium">{campaign.campaign_type || "—"}</span>
            </div>
            <div className="flex justify-between gap-2 items-center">
              <span className="text-muted-foreground">Status</span>
              <Badge className={`${statusColors[campaign.status || "Draft"]} text-[10px] h-4 px-1.5`} variant="secondary">{campaign.status}</Badge>
            </div>
            {countries.length > 0 && (
              <div className="flex justify-between gap-2 md:col-span-2">
                <span className="text-muted-foreground shrink-0">Region</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {countries.slice(0, 8).map((c) => (
                    <Badge key={c} variant="outline" className="text-[10px] h-4 px-1.5">{c}</Badge>
                  ))}
                  {countries.length > 8 && <Badge variant="outline" className="text-[10px] h-4 px-1.5">+{countries.length - 8}</Badge>}
                </div>
              </div>
            )}
            {description && (
              <div className="md:col-span-2">
                <p className="text-muted-foreground mb-0.5">Description</p>
                <p className="text-foreground/90 whitespace-pre-wrap leading-snug">{description}</p>
              </div>
            )}
            {goal && goal !== description && (
              <div className="md:col-span-2">
                <p className="text-muted-foreground mb-0.5">Goal</p>
                <p className="text-foreground/90 whitespace-pre-wrap leading-snug">{goal}</p>
              </div>
            )}
            {notes && (
              <div className="md:col-span-2">
                <p className="text-muted-foreground mb-0.5">Notes</p>
                <p className="text-foreground/90 whitespace-pre-wrap leading-snug">{notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
