import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2,
  Users,
  MessageSquare,
  TrendingUp,
  BarChart3,
  ArrowRight,
  HeartPulse,
  Sparkles,
  Mail,
  Phone,
  Linkedin,
  Activity,
  Target,
} from "lucide-react";
import { differenceInDays, subDays, startOfDay, format } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, Tooltip as RTooltip, CartesianGrid } from "recharts";
import {
  getOutreachCounts,
  getRepliedThreads,
  getFunnel,
} from "./overviewMetrics";
import { RecentActivityPanel } from "./overview/RecentActivityPanel";
import { UpcomingActionItems } from "./overview/UpcomingActionItems";
import { EmailEngagementWidget } from "./overview/EmailEngagementWidget";
import { getEnabledChannels, pickDrilldownChannel } from "./channelVisibility";

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
  onDrilldown?: (
    drilldown:
      | {
          tab: "setup";
          section: "region" | "audience" | "message" | "timing";
          audienceView?: "accounts" | "contacts";
        }
      | {
          tab: "monitoring";
          view: "outreach" | "analytics";
          channel?: "email" | "linkedin" | "call";
          status?: "all" | "sent" | "replied" | "failed" | "bounced";
          threadId?: string;
        }
      | { tab: "actionItems" }
  ) => void;
}

const funnelStages = [
  { key: "total", label: "Total", bar: "bg-slate-400" },
  { key: "contacted", label: "Contacted", bar: "bg-blue-500" },
  { key: "responded", label: "Responded", bar: "bg-amber-500" },
  { key: "qualified", label: "Qualified", bar: "bg-violet-500" },
  { key: "converted", label: "Converted", bar: "bg-emerald-500" },
] as const;

export function CampaignOverview({
  campaign,
  accounts,
  contacts,
  communications,
  onTabChange,
  onDrilldown,
}: Props) {
  const navigate = useNavigate();

  const { data: deals = [] } = useQuery({
    queryKey: ["campaign-deals-overview", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select(
          "id, stage, total_contract_value, deal_name, account_id, source_campaign_contact_id"
        )
        .eq("campaign_id", campaign.id);
      if (error) throw error;
      return data || [];
    },
  });

  const drill = (d: Parameters<NonNullable<Props["onDrilldown"]>>[0]) =>
    onDrilldown ? onDrilldown(d) : onTabChange((d as any).tab);

  // Channel visibility — single source of truth for what to render.
  const enabledChannels = useMemo(() => getEnabledChannels(campaign), [campaign?.enabled_channels, campaign?.primary_channel]);
  const showEmailCh = enabledChannels.includes("Email");
  const showPhoneCh = enabledChannels.includes("Phone");
  const showLinkedInCh = enabledChannels.includes("LinkedIn");
  const defaultDrilldownChannel = useMemo(() => pickDrilldownChannel(campaign), [campaign?.enabled_channels, campaign?.primary_channel]);

  // ---------- Unified metrics ----------
  const outreach = useMemo(() => getOutreachCounts(communications), [communications]);
  const repliedThreads = useMemo(
    () => getRepliedThreads(communications),
    [communications]
  );


  // Outbound contacts (anyone we touched at least once)
  const contactedContactIds = useMemo(() => {
    const s = new Set<string>();
    outreach.threads.forEach((t) => {
      if (t.contactId && t.outboundCount > 0) s.add(t.contactId);
    });
    communications.forEach((c: any) => {
      if (
        c.communication_type !== "Email" &&
        c.contact_id &&
        c.sent_via !== "graph-sync"
      )
        s.add(c.contact_id);
    });
    return s;
  }, [outreach.threads, communications]);

  const repliedContactIds = useMemo(() => {
    const s = new Set<string>();
    repliedThreads.forEach((t) => t.contactId && s.add(t.contactId));
    return s;
  }, [repliedThreads]);

  // Sparkline buckets
  const buildSpark = (filterFn: (c: any) => boolean) => {
    const today = startOfDay(new Date());
    const days = Array.from({ length: 7 }, (_, i) =>
      startOfDay(subDays(today, 6 - i))
    );
    return days.map((day) => {
      const next = subDays(day, -1);
      const v = communications.filter((c: any) => {
        if (!filterFn(c)) return false;
        if (!c.communication_date) return false;
        const t = new Date(c.communication_date).getTime();
        return t >= day.getTime() && t < next.getTime();
      }).length;
      return { v };
    });
  };
  const outreachSpark = useMemo(
    () => buildSpark((c) => c.sent_via !== "graph-sync"),
    [communications]
  );
  const responseSpark = useMemo(
    () => buildSpark((c) => c.sent_via === "graph-sync" || c.email_status === "Replied"),
    [communications]
  );


  // Won deal value (excludes Lost) — used for Deals KPI sub-stat.
  const winningDeals = deals.filter((d: any) => d.stage !== "Lost");
  const totalDealValue = winningDeals.reduce(
    (sum: number, d: any) => sum + (Number(d.total_contract_value) || 0),
    0
  );

  const today = new Date();
  const endDate = campaign.end_date ? new Date(campaign.end_date) : null;
  const daysRemaining = endDate ? Math.max(0, differenceInDays(endDate, today)) : 0;

  // Reply rate aligned with Analytics tab: replied threads / outbound threads.
  const responseRate =
    outreach.emailThreads > 0
      ? Math.round((repliedThreads.length / outreach.emailThreads) * 100)
      : 0;

  // Funnel-driven Lead→Deal % so Overview matches Analytics & Funnel widget.
  const funnel = useMemo(
    () => getFunnel(contacts, communications, deals),
    [contacts, communications, deals]
  );
  const leadToDealPct =
    funnel.responded > 0
      ? Math.round((funnel.converted / funnel.responded) * 100)
      : 0;
  const avgDealValue =
    winningDeals.length > 0 ? totalDealValue / winningDeals.length : 0;

  // Outreach timeline (last 14 days, daily)
  const timelineData = useMemo(() => {
    const today = startOfDay(new Date());
    const days = Array.from({ length: 14 }, (_, i) =>
      startOfDay(subDays(today, 13 - i))
    );
    return days.map((day) => {
      const next = subDays(day, -1);
      const inDay = communications.filter((c: any) => {
        if (!c.communication_date) return false;
        if (c.sent_via === "graph-sync") return false;
        const t = new Date(c.communication_date).getTime();
        return t >= day.getTime() && t < next.getTime();
      });
      const Email = inDay.filter((c) => c.communication_type === "Email").length;
      const Call = inDay.filter(
        (c) => c.communication_type === "Phone" || c.communication_type === "Call"
      ).length;
      const LinkedIn = inDay.filter((c) => c.communication_type === "LinkedIn").length;
      return {
        date: format(day, "d MMM"),
        iso: format(day, "yyyy-MM-dd"),
        Email,
        Call,
        LinkedIn,
        total: Email + Call + LinkedIn,
      };
    });
  }, [communications]);

  // Next Best Actions (up to 3)
  const nextActions = useMemo(() => {
    const list: Array<{
      id: string;
      icon: any;
      label: string;
      cta: string;
      onClick: () => void;
    }> = [];
    const unreached = contacts.length - contactedContactIds.size;
    if (unreached > 0)
      list.push({
        id: "reach",
        icon: MessageSquare,
        label: `${unreached} contact${unreached > 1 ? "s" : ""} not yet reached`,
        cta: "Reach out",
        onClick: () =>
          drill({
            tab: "setup",
            section: "audience",
            audienceView: "contacts",
          }),
      });
    const repliedNoDeal = repliedContactIds.size - deals.length;
    if (repliedNoDeal > 0)
      list.push({
        id: "convert",
        icon: TrendingUp,
        label: `${repliedNoDeal} replied — convert to deals`,
        cta: "Open replies",
        onClick: () =>
          drill({
            tab: "monitoring",
            view: "outreach",
            channel: "email",
            status: "replied",
          }),
      });
    // Stalled threads (>5d, outbound only, no reply)
    const fiveDaysAgo = subDays(new Date(), 5).getTime();
    const stalled = outreach.threads.filter(
      (t) =>
        !t.hasReply &&
        t.outboundCount > 0 &&
        t.lastDate &&
        new Date(t.lastDate).getTime() < fiveDaysAgo
    ).length;
    if (stalled > 0)
      list.push({
        id: "follow",
        icon: HeartPulse,
        label: `${stalled} stalled thread${stalled > 1 ? "s" : ""} — follow up`,
        cta: "Follow up",
        onClick: () =>
          drill({
            tab: "monitoring",
            view: "outreach",
            channel: "email",
            status: "sent",
          }),
      });
    if (endDate && daysRemaining <= 7 && daysRemaining > 0)
      list.push({
        id: "ending",
        icon: Sparkles,
        label: `Campaign ends in ${daysRemaining}d`,
        cta: "Review",
        onClick: () => drill({ tab: "monitoring", view: "analytics" } as any),
      });
    if (list.length === 0)
      list.push({
        id: "ok",
        icon: Sparkles,
        label: "All caught up — keep nurturing",
        cta: "Monitor",
        onClick: () => drill({ tab: "monitoring", view: "outreach" }),
      });
    return list.slice(0, 3);
  }, [contacts.length, contactedContactIds.size, repliedContactIds.size, deals.length, outreach.threads, endDate, daysRemaining]);

  // Compute % delta of last 3 days vs prior 3 days from spark buckets.
  const computeDelta = (spark: { v: number }[]) => {
    if (!spark || spark.length < 6) return null;
    const recent = spark.slice(-3).reduce((s, p) => s + p.v, 0);
    const prior = spark.slice(-6, -3).reduce((s, p) => s + p.v, 0);
    if (recent === 0 && prior === 0) return null;
    if (prior === 0) return { pct: 100, up: true };
    const pct = Math.round(((recent - prior) / prior) * 100);
    return { pct: Math.abs(pct), up: pct >= 0 };
  };

  // KPIs
  const kpis = [
    {
      label: "Accounts",
      value: accounts.length,
      icon: Building2,
      onClick: () =>
        drill({ tab: "setup", section: "audience", audienceView: "accounts" }),
      borderClass: "border-l-slate-400",
      iconBg: "bg-slate-100 dark:bg-slate-800",
      iconColor: "text-slate-600 dark:text-slate-300",
      tintClass: "bg-gradient-to-br from-slate-100/70 via-transparent to-transparent dark:from-slate-800/40",
    },
    {
      label: "Contacts",
      value: contacts.length,
      icon: Users,
      onClick: () =>
        drill({ tab: "setup", section: "audience", audienceView: "contacts" }),
      borderClass: "border-l-blue-500",
      iconBg: "bg-blue-100 dark:bg-blue-900/40",
      iconColor: "text-blue-600 dark:text-blue-300",
      tintClass: "bg-gradient-to-br from-blue-100/70 via-transparent to-transparent dark:from-blue-950/40",
    },
    {
      label: "Outreach",
      value: outreach.total,
      icon: MessageSquare,
      subNode: (
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums">
          {showEmailCh && (
            <span className="inline-flex items-center gap-0.5" title="Email threads">
              <Mail className="h-2.5 w-2.5" />
              {outreach.emailThreads}
            </span>
          )}
          {showPhoneCh && (
            <span className="inline-flex items-center gap-0.5" title="Calls">
              <Phone className="h-2.5 w-2.5" />
              {outreach.calls}
            </span>
          )}
          {showLinkedInCh && (
            <span className="inline-flex items-center gap-0.5" title="LinkedIn">
              <Linkedin className="h-2.5 w-2.5" />
              {outreach.linkedin}
            </span>
          )}
        </span>
      ),
      onClick: () =>
        drill({ tab: "monitoring", view: "outreach", channel: defaultDrilldownChannel, status: "all" }),
      borderClass: "border-l-indigo-500",
      iconBg: "bg-indigo-100 dark:bg-indigo-900/40",
      iconColor: "text-indigo-600 dark:text-indigo-300",
      tintClass: "bg-gradient-to-br from-indigo-100/70 via-transparent to-transparent dark:from-indigo-950/40",
      spark: outreachSpark,
      sparkColor: "hsl(var(--channel-email))",
      delta: computeDelta(outreachSpark),
    },
    {
      label: "Responses",
      value: repliedThreads.length,
      icon: TrendingUp,
      sub: `${responseRate}% reply rate`,
      onClick: () =>
        drill({
          tab: "monitoring",
          view: "outreach",
          channel: defaultDrilldownChannel,
          status: "replied",
        }),
      borderClass: "border-l-amber-500",
      iconBg: "bg-amber-100 dark:bg-amber-900/40",
      iconColor: "text-amber-600 dark:text-amber-300",
      tintClass: "bg-gradient-to-br from-amber-100/70 via-transparent to-transparent dark:from-amber-950/40",
      spark: responseSpark,
      sparkColor: "hsl(var(--channel-call))",
      delta: computeDelta(responseSpark),
    },
    ...(deals.length > 0
      ? [{
          label: "Deals",
          value: deals.length,
          icon: BarChart3,
          subNode: (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[10px] text-muted-foreground tabular-nums">
              {avgDealValue > 0 && <span>€{(avgDealValue / 1000).toFixed(0)}k avg</span>}
              {leadToDealPct > 0 && (
                <>
                  {avgDealValue > 0 && <span className="opacity-50">·</span>}
                  <span>{leadToDealPct}% L→D</span>
                </>
              )}
              {avgDealValue === 0 && leadToDealPct === 0 && <span>—</span>}
            </span>
          ),
          onClick: () => navigate(`/deals?campaign=${campaign.id}`),
          borderClass: "border-l-emerald-500",
          iconBg: "bg-emerald-100 dark:bg-emerald-900/40",
          iconColor: "text-emerald-600 dark:text-emerald-300",
          tintClass: "bg-gradient-to-br from-emerald-100/70 via-transparent to-transparent dark:from-emerald-950/40",
        }]
      : []),
  ];


  return (
    <div className="flex flex-col gap-2 w-full pb-2">
      {/* Row 1: KPI strip */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${kpis.length >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"} gap-2`}>
        {kpis.map((k) => {
          const Icon = k.icon;
          const delta = (k as any).delta as { pct: number; up: boolean } | null | undefined;
          const sparkId = `spark-${k.label.toLowerCase()}`;
          return (
            <Card
              key={k.label}
              className={`relative overflow-hidden border-l-[3px] ${k.borderClass} cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all`}
              onClick={k.onClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  k.onClick();
                }
              }}
            >
              <div className={`pointer-events-none absolute inset-0 ${(k as any).tintClass || ""}`} />
              <CardContent className="relative p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        {k.label}
                      </p>
                      {delta && (
                        <span
                          className={`inline-flex items-center gap-0.5 px-1 py-[1px] rounded-sm text-[9px] font-semibold tabular-nums ${
                            delta.up
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                          }`}
                          title="Last 3 days vs prior 3 days"
                        >
                          {delta.up ? "▲" : "▼"} {delta.pct}%
                        </span>
                      )}
                    </div>
                    <p className="text-xl font-bold leading-tight tabular-nums">
                      {k.value}
                    </p>
                    {(k as any).subNode ? (
                      <div className="mt-0.5">{(k as any).subNode}</div>
                    ) : (k as any).sub ? (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {(k as any).sub}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div
                      className={`h-8 w-8 rounded-lg ${k.iconBg} flex items-center justify-center shrink-0 shadow-sm ring-1 ring-border/40`}
                    >
                      <Icon className={`h-4 w-4 ${k.iconColor}`} />
                    </div>
                    {k.spark && k.spark.some((p) => p.v > 0) && (
                      <div className="h-5 w-14">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={k.spark} margin={{ top: 1, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id={sparkId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={k.sparkColor} stopOpacity={0.55} />
                                <stop offset="100%" stopColor={k.sparkColor} stopOpacity={0.05} />
                              </linearGradient>
                            </defs>
                            <Area
                              type="monotone"
                              dataKey="v"
                              stroke={k.sparkColor}
                              strokeWidth={1.5}
                              fill={`url(#${sparkId})`}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Row 2: Recent Activity | Next Action | Email Engagement (top-right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-stretch">
        {/* Recent Activity (left) */}
        <div className="lg:col-span-5 flex">
          <RecentActivityPanel
            communications={communications}
            enabledChannels={enabledChannels}
            onOpenThread={(threadId) =>
              drill({
                tab: "monitoring",
                view: "outreach",
                channel: defaultDrilldownChannel,
                status: "all",
                threadId,
              })
            }
            onOpenAll={() =>
              drill({
                tab: "monitoring",
                view: "outreach",
                channel: defaultDrilldownChannel,
                status: "all",
              })
            }
            onOpenCall={
              showPhoneCh
                ? () =>
                    drill({ tab: "monitoring", view: "outreach", channel: "call", status: "all" })
                : undefined
            }
            onOpenLinkedIn={
              showLinkedInCh
                ? () =>
                    drill({ tab: "monitoring", view: "outreach", channel: "linkedin", status: "all" })
                : undefined
            }
          />
        </div>

        {/* Next Action (middle) */}
        <div className="lg:col-span-3 flex">
          <Card className="relative flex-1 overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-violet-500 to-fuchsia-500" />
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-5 w-5 rounded-md bg-primary/15 flex items-center justify-center">
                  <Target className="h-3 w-3 text-primary" />
                </div>
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Next Action
                </h3>
                <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                  {nextActions.length}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {nextActions.map((a) => {
                  const Icon = a.icon;
                  const tone =
                    a.id === "reach"
                      ? { bar: "bg-blue-500", chip: "bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300", hover: "hover:bg-blue-50/60 dark:hover:bg-blue-950/30" }
                      : a.id === "convert"
                      ? { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300", hover: "hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30" }
                      : a.id === "follow"
                      ? { bar: "bg-amber-500", chip: "bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300", hover: "hover:bg-amber-50/60 dark:hover:bg-amber-950/30" }
                      : a.id === "ending"
                      ? { bar: "bg-violet-500", chip: "bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300", hover: "hover:bg-violet-50/60 dark:hover:bg-violet-950/30" }
                      : { bar: "bg-slate-400", chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", hover: "hover:bg-muted/50" };
                  return (
                    <li key={a.id}>
                      <button
                        onClick={a.onClick}
                        className={`relative w-full flex items-start gap-2 p-1.5 pl-2.5 rounded-md text-left group overflow-hidden ${tone.hover}`}
                      >
                        <span className={`absolute left-0 top-1 bottom-1 w-1 rounded-r ${tone.bar}`} />
                        <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${tone.chip}`}>
                          <Icon className="h-2.5 w-2.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium leading-tight truncate">
                            {a.label}
                          </p>
                          <p className="text-[10px] text-primary group-hover:underline flex items-center gap-0.5">
                            {a.cta} <ArrowRight className="h-2.5 w-2.5" />
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Action Items (top-right — fills empty space beside Next Action) */}
        <div className="lg:col-span-4 flex">
          <div className="flex-1">
            <UpcomingActionItems
              campaignId={campaign.id}
              onOpenActionItems={() => onTabChange("actionItems")}
            />
          </div>
        </div>
      </div>

      {/* Row 3: Outreach Timeline | Upcoming Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-stretch">
        <div className="lg:col-span-8 flex">
          <Card className="flex-1">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-5 w-5 rounded-md bg-primary/10 flex items-center justify-center">
                  <Activity className="h-3 w-3 text-primary" />
                </div>
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Outreach Timeline
                </h3>
                <div className="ml-auto flex items-center gap-2 text-[10px] tabular-nums">
                  {showEmailCh && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--channel-email))" }} />
                      <span className="text-muted-foreground">Email</span>
                      <span className="font-semibold">{timelineData.reduce((s, d) => s + d.Email, 0)}</span>
                    </span>
                  )}
                  {showPhoneCh && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--channel-call))" }} />
                      <span className="text-muted-foreground">Calls</span>
                      <span className="font-semibold">{timelineData.reduce((s, d) => s + d.Call, 0)}</span>
                    </span>
                  )}
                  {showLinkedInCh && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--channel-linkedin))" }} />
                      <span className="text-muted-foreground">LinkedIn</span>
                      <span className="font-semibold">{timelineData.reduce((s, d) => s + d.LinkedIn, 0)}</span>
                    </span>
                  )}
                  <span className="text-muted-foreground">· Last 14d</span>
                </div>
              </div>
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={timelineData}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    onClick={(e: any) => {
                      if (!e || !e.activeLabel) return;
                      drill({
                        tab: "monitoring",
                        view: "outreach",
                        channel: "email",
                        status: "all",
                      });
                    }}
                  >
                    <defs>
                      <linearGradient id="bar-email" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--channel-email))" stopOpacity={1} />
                        <stop offset="100%" stopColor="hsl(var(--channel-email))" stopOpacity={0.55} />
                      </linearGradient>
                      <linearGradient id="bar-call" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--channel-call))" stopOpacity={1} />
                        <stop offset="100%" stopColor="hsl(var(--channel-call))" stopOpacity={0.55} />
                      </linearGradient>
                      <linearGradient id="bar-linkedin" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--channel-linkedin))" stopOpacity={1} />
                        <stop offset="100%" stopColor="hsl(var(--channel-linkedin))" stopOpacity={0.55} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="2 4" stroke="hsl(var(--border))" opacity={0.5} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9 }}
                      axisLine={false}
                      tickLine={false}
                      interval={1}
                    />
                    <RTooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 6,
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--background))",
                      }}
                    />
                    {showEmailCh && <Bar dataKey="Email" stackId="a" fill="url(#bar-email)" radius={[3, 3, 0, 0]} />}
                    {showPhoneCh && <Bar dataKey="Call" stackId="a" fill="url(#bar-call)" radius={[3, 3, 0, 0]} />}
                    {showLinkedInCh && <Bar dataKey="LinkedIn" stackId="a" fill="url(#bar-linkedin)" radius={[3, 3, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Email Engagement (right) */}
        <div className="lg:col-span-4 flex">
          <div className="flex-1">
            <EmailEngagementWidget
              communications={communications}
              onDrilldown={(status) =>
                drill({
                  tab: "monitoring",
                  view: "outreach",
                  channel: "email",
                  status: status as any,
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
