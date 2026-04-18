import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Megaphone, Zap, FileEdit, CheckCircle2, PauseCircle,
  Search, Users, Building2, MessageSquare
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  PieChart, Pie, Cell,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend
} from "recharts";

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
  getStrategyProgress: (id: string) => { count: number; total: number };
}

const STATUS_COLORS: Record<string, string> = {
  Active: "hsl(142, 71%, 45%)",
  Draft: "hsl(215, 20%, 65%)",
  Completed: "hsl(217, 91%, 60%)",
  Paused: "hsl(45, 93%, 47%)",
};

const STATUS_BADGE: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  Active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const STAT_BORDER_COLORS: Record<string, string> = {
  Total: "border-l-indigo-500",
  Active: "border-l-emerald-500",
  Draft: "border-l-slate-400",
  Completed: "border-l-blue-500",
  Paused: "border-l-amber-500",
};

const STAT_ICON_BG: Record<string, string> = {
  Total: "bg-indigo-100 dark:bg-indigo-900/30",
  Active: "bg-emerald-100 dark:bg-emerald-900/30",
  Draft: "bg-slate-100 dark:bg-slate-800",
  Completed: "bg-blue-100 dark:bg-blue-900/30",
  Paused: "bg-amber-100 dark:bg-amber-900/30",
};

const STAT_VALUE_COLORS: Record<string, string> = {
  Total: "text-indigo-600 dark:text-indigo-400",
  Active: "text-emerald-600 dark:text-emerald-400",
  Draft: "text-slate-600 dark:text-slate-400",
  Completed: "text-blue-600 dark:text-blue-400",
  Paused: "text-amber-600 dark:text-amber-400",
};

interface AggregateData {
  accountsBycamp: Record<string, number>;
  contactsBycamp: Record<string, number>;
  commsBycamp: Record<string, number>;
  totalAccounts: number;
  totalContacts: number;
  totalComms: number;
}

export function CampaignDashboard({ campaigns, getStrategyProgress }: CampaignDashboardProps) {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [aggregates, setAggregates] = useState<AggregateData>({
    accountsBycamp: {}, contactsBycamp: {}, commsBycamp: {},
    totalAccounts: 0, totalContacts: 0, totalComms: 0,
  });

  useEffect(() => {
    const fetchAggregates = async () => {
      const [accRes, conRes, comRes] = await Promise.all([
        supabase.from("campaign_accounts").select("campaign_id"),
        supabase.from("campaign_contacts").select("campaign_id"),
        supabase.from("campaign_communications").select("campaign_id"),
      ]);
      const countBy = (rows: { campaign_id: string }[] | null) => {
        const map: Record<string, number> = {};
        (rows || []).forEach((r) => { map[r.campaign_id] = (map[r.campaign_id] || 0) + 1; });
        return map;
      };
      const accountsBycamp = countBy(accRes.data);
      const contactsBycamp = countBy(conRes.data);
      const commsBycamp = countBy(comRes.data);
      setAggregates({
        accountsBycamp, contactsBycamp, commsBycamp,
        totalAccounts: accRes.data?.length || 0,
        totalContacts: conRes.data?.length || 0,
        totalComms: comRes.data?.length || 0,
      });
    };
    fetchAggregates();
  }, [campaigns.length]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { Active: 0, Draft: 0, Completed: 0, Paused: 0 };
    campaigns.forEach((c) => { const s = c.status || "Draft"; if (counts[s] !== undefined) counts[s]++; });
    return counts;
  }, [campaigns]);

  const pieData = useMemo(() =>
    Object.entries(statusCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value, fill: STATUS_COLORS[name] || "hsl(0,0%,70%)" })),
    [statusCounts]
  );

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter && (c.status || "Draft") !== statusFilter) return false;
      if (typeFilter && (c.campaign_type || "Unspecified") !== typeFilter) return false;
      if (search && !c.campaign_name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [campaigns, statusFilter, typeFilter, search]);

  const stats = [
    { label: "Total", value: campaigns.length, icon: Megaphone, color: "text-primary", filter: null as string | null },
    { label: "Active", value: statusCounts.Active, icon: Zap, color: "text-green-600 dark:text-green-400", filter: "Active" },
    { label: "Draft", value: statusCounts.Draft, icon: FileEdit, color: "text-muted-foreground", filter: "Draft" },
    { label: "Completed", value: statusCounts.Completed, icon: CheckCircle2, color: "text-blue-600 dark:text-blue-400", filter: "Completed" },
    { label: "Paused", value: statusCounts.Paused, icon: PauseCircle, color: "text-yellow-600 dark:text-yellow-400", filter: "Paused" },
  ];

  const handleStatClick = (filter: string | null) => {
    setStatusFilter((prev) => (prev === filter ? null : filter));
    setTypeFilter(null);
  };

  const handlePieClick = (data: any) => {
    if (data?.name) {
      setStatusFilter((prev) => (prev === data.name ? null : data.name));
      setTypeFilter(null);
    }
  };

  const activeFilterLabel = statusFilter || typeFilter || null;

  return (
    <div className="flex-1 overflow-auto p-3 space-y-3">
      {/* Stat Cards */}
      <div className="grid grid-cols-5 gap-2">
        {stats.map((s) => (
          <Card
            key={s.label}
            className={`border border-l-4 ${STAT_BORDER_COLORS[s.label] || "border-l-primary"} shadow-none cursor-pointer transition-all hover:shadow-md ${
              statusFilter === s.filter ? "ring-2 ring-primary" : ""
            } ${s.filter === null && !statusFilter ? "ring-2 ring-primary/30" : ""}`}
            onClick={() => handleStatClick(s.filter)}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`h-8 w-8 rounded-lg ${STAT_ICON_BG[s.label] || "bg-muted"} flex items-center justify-center shrink-0`}>
                <s.icon className={`h-4 w-4 ${s.color} shrink-0`} />
              </div>
              <div>
                <p className={`text-2xl font-bold leading-none ${STAT_VALUE_COLORS[s.label] || ""}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts + Activity Row */}
      <div className="grid grid-cols-12 gap-3">
        {/* Pie Chart */}
        <Card className="col-span-4 border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-medium">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData} cx="50%" cy="50%"
                    innerRadius={40} outerRadius={70}
                    paddingAngle={3} dataKey="value"
                    onClick={handlePieClick} cursor="pointer" stroke="none"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} opacity={statusFilter && statusFilter !== entry.name ? 0.3 : 1} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value: number, name: string) => [`${value} campaigns`, name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend verticalAlign="bottom" height={24} iconSize={8} formatter={(value: string) => (<span className="text-xs text-muted-foreground">{value}</span>)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Activity Summary */}
        <Card className="col-span-8 border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-medium">Activity Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{aggregates.totalAccounts}</p>
                <p className="text-xs text-muted-foreground">Accounts Targeted</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Users className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{aggregates.totalContacts}</p>
                <p className="text-xs text-muted-foreground">Contacts Added</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <MessageSquare className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{aggregates.totalComms}</p>
                <p className="text-xs text-muted-foreground">Communications</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaigns Table */}
      <Card className="border shadow-none">
        <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-medium">
              All Campaigns
              {activeFilterLabel && (
                <Badge variant="secondary" className="ml-2 cursor-pointer" onClick={() => { setStatusFilter(null); setTypeFilter(null); }}>
                  {activeFilterLabel} ✕
                </Badge>
              )}
            </CardTitle>
            <Badge variant="outline" className="text-xs">{filtered.length}</Badge>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs whitespace-nowrap">Name</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Type</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Status</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Strategy</TableHead>
                  <TableHead className="text-xs whitespace-nowrap text-right">Accounts</TableHead>
                  <TableHead className="text-xs whitespace-nowrap text-right">Contacts</TableHead>
                  <TableHead className="text-xs whitespace-nowrap text-right">Comms</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Start</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">End</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                      No campaigns match the current filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((c) => {
                    const strategy = getStrategyProgress(c.id);
                    const acc = aggregates.accountsBycamp[c.id] || 0;
                    const con = aggregates.contactsBycamp[c.id] || 0;
                    const com = aggregates.commsBycamp[c.id] || 0;
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer hover:bg-muted/50 even:bg-muted/10"
                        onClick={() => { const slug = c.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); navigate(`/campaigns/${slug}`); }}
                      >
                        <TableCell className="text-xs font-medium max-w-[200px] truncate">{c.campaign_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.campaign_type || "—"}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${STATUS_BADGE[c.status || "Draft"]}`} variant="secondary">{c.status || "Draft"}</Badge>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const pct = strategy.total > 0 ? (strategy.count / strategy.total) * 100 : 0;
                            const mc = pct === 100 ? "text-emerald-600 dark:text-emerald-400 font-medium" : pct > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
                            return <span className={`text-xs ${mc}`}>{strategy.count}/{strategy.total}</span>;
                          })()}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{acc}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{con}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{com}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {c.start_date ? format(new Date(c.start_date + "T00:00:00"), "dd MMM yy") : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {c.end_date ? format(new Date(c.end_date + "T00:00:00"), "dd MMM yy") : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
