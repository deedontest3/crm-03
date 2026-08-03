import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  BarChart3, Users, Mail, TrendingUp,
  TrendingDown, ArrowRight, Send, Reply,
  Inbox, AlertTriangle, Info, Eye, Target, Trophy, DollarSign, Filter,
  ChevronDown, XCircle,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  Tooltip as RechartsTooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { format, subDays, isAfter, startOfDay } from "date-fns";
import { getEnabledChannels } from "./channelVisibility";
import { computeEmailStats } from "./emailMetrics";

// Drilldown shape mirrors CampaignDetail's CampaignDrilldown so the parent can
// route us to the right tab/view/filter without us importing its types.
export type AnalyticsDrilldown =
  | { tab: "setup"; section: "region" | "audience" | "message" | "timing"; audienceView?: "accounts" | "contacts" }
  | { tab: "monitoring"; view: "outreach" | "analytics"; channel?: "email" | "linkedin" | "call"; status?: "all" | "sent" | "delivered" | "opened" | "replied" | "failed" | "bounced" | "notReplied" | "needsFollowup"; threadId?: string }
  | { tab: "actionItems" };

interface Props {
  campaignId: string;
  campaign?: any;
  /** Optional drilldown handler — when provided, KPIs/cards become clickable. */
  onDrilldown?: (next: AnalyticsDrilldown) => void;
  /** When provided, renders inline Outreach/Analytics toggle in the toolbar. */
  viewMode?: "outreach" | "analytics";
  onViewModeChange?: (v: "outreach" | "analytics") => void;
}

// ────────────────────────── Design tokens ──────────────────────────
const CHART = {
  primary:  "hsl(var(--channel-email))",
  success:  "hsl(var(--channel-success))",
  call:     "hsl(var(--channel-call))",
  linkedin: "hsl(var(--channel-linkedin))",
  failed:   "hsl(var(--channel-failed))",
  neutral:  "hsl(var(--channel-neutral))",
  opened:   "hsl(var(--channel-opened))",
} as const;

type DateRange = "7" | "30" | "90" | "all";
type ChannelFilter = "all" | "email" | "call" | "linkedin";

// ────────────────────────── Helpers ──────────────────────────
// A bounce is a hard non-delivery. We deliberately do NOT treat
// `email_status === "Failed"` as a bounce — those are transient send failures
// surfaced separately (see `isFailedSend`).
const isBounce = (m: any) =>
  m.email_status === "Bounced" ||
  !!m.bounced_at ||
  !!m.bounce_reason ||
  !!m.bounce_type;

const isFailedSend = (m: any) =>
  m.email_status === "Failed" && !isBounce(m);

const isProviderSent = (m: any) =>
  m.communication_type === "Email" &&
  m.sent_via && m.sent_via !== "manual" &&
  m.delivery_status !== "received";

const isInbound = (m: any) => m.delivery_status === "received";

const NDR_SUBJECT = /^(undeliverable:|undelivered:|mail delivery failed|failure notice|returned mail|delivery status notification)/i;

const pct = (num: number, den: number) =>
  den > 0 ? Math.min(100, Math.max(0, Math.round((num / den) * 100))) : 0;

const trendDelta = (current: number, previous: number): { delta: number; up: boolean | null } => {
  if (previous === 0) return { delta: current === 0 ? 0 : 100, up: current > 0 };
  const d = Math.round(((current - previous) / previous) * 100);
  return { delta: Math.abs(d), up: d === 0 ? null : d > 0 };
};

// ────────────────────────── Sub components ──────────────────────────
function HeroKpiTile({
  label, value, icon: Icon, accent, delta, sublabel, onClick,
}: {
  label: string;
  value: string | number;
  icon: any;
  accent: "primary" | "success" | "call" | "linkedin" | "neutral" | "failed";
  delta?: { delta: number; up: boolean | null };
  sublabel?: string;
  onClick?: () => void;
}) {
  const accentColor: Record<string, string> = {
    primary:  "text-primary",
    success:  "text-emerald-600 dark:text-emerald-400",
    call:     "text-amber-600 dark:text-amber-400",
    linkedin: "text-violet-600 dark:text-violet-400",
    neutral:  "text-slate-600 dark:text-slate-400",
    failed:   "text-rose-600 dark:text-rose-400",
  };
  const interactive = !!onClick;
  return (
    <Card
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : -1}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      aria-label={interactive ? `${label}: ${value}. Open details.` : undefined}
      className={`border-border/60 shadow-sm overflow-hidden ${interactive ? "cursor-pointer hover:bg-muted/40 hover:border-primary/40 transition-colors" : ""}`}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] font-medium text-muted-foreground truncate">{label}</span>
            <span className={`text-2xl font-bold tabular-nums leading-tight ${accentColor[accent]}`}>{value}</span>
            {sublabel && <span className="text-[10px] text-muted-foreground truncate">{sublabel}</span>}
          </div>
          <Icon className={`h-3.5 w-3.5 shrink-0 ${accentColor[accent]}`} />
        </div>
        {delta && delta.up !== null && (
          <div className={`mt-1 inline-flex items-center gap-1 text-[10px] font-medium ${delta.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {delta.up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {delta.delta}% vs prev
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RateRow({ label, num, den, color, hint }: { label: string; num: number; den: number; color: string; hint: string }) {
  const p = pct(num, den);
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <div className="flex items-center gap-1 text-muted-foreground">
          {label}
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger><Info className="h-3 w-3" /></TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">{hint}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <span className="font-medium tabular-nums text-foreground">{p}% <span className="text-muted-foreground">({num}/{den})</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  );
}

function EmptyHint({ icon: Icon, message, ctaLabel, onCta }: { icon: any; message: string; ctaLabel?: string; onCta?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
      <Icon className="h-7 w-7 mb-2 opacity-50" />
      <p className="text-xs">{message}</p>
      {ctaLabel && onCta && (
        <button type="button" onClick={onCta} className="mt-2 text-xs text-primary hover:underline">
          {ctaLabel} →
        </button>
      )}
    </div>
  );
}

function CollapsibleCard({
  title, summary, icon: Icon, defaultOpen = false, children,
}: { title: string; summary?: string; icon: any; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader
        className="p-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">{title}</span>
            {summary && <span className="text-[11px] font-normal text-muted-foreground truncate">· {summary}</span>}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="p-3 pt-0">{children}</CardContent>}
    </Card>
  );
}

// ────────────────────────── Main ──────────────────────────
export function CampaignAnalytics({ campaignId, campaign, onDrilldown, viewMode, onViewModeChange }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [breakdownsOpen, setBreakdownsOpen] = useState(false);

  // Auto-refresh on mount so analytics is always fresh (replaces manual refresh button).
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-deals", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-email-history", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-templates-meta", campaignId] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Channel visibility
  const enabledChannels = useMemo(() => getEnabledChannels(campaign), [campaign?.enabled_channels, campaign?.primary_channel]);
  const showEmailCh = enabledChannels.includes("Email");
  const showCallCh = enabledChannels.includes("Phone");
  const showLinkedInCh = enabledChannels.includes("LinkedIn");

  useEffect(() => {
    if (channelFilter === "all") return;
    const stillEnabled =
      (channelFilter === "email" && showEmailCh) ||
      (channelFilter === "call" && showCallCh) ||
      (channelFilter === "linkedin" && showLinkedInCh);
    if (!stillEnabled) setChannelFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmailCh, showCallCh, showLinkedInCh]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["campaign-accounts", campaignId, "analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("*, accounts(account_name, industry, region, country)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["campaign-contacts", campaignId, "analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("*, contacts(contact_name, email, position, company_name, region), accounts(account_name, region, industry)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const { data: communications = [] } = useQuery({
    queryKey: ["campaign-communications", campaignId, "analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_communications")
        .select("*, opened_at, open_count, last_opened_at, tracking_id, template_id, contacts(contact_name), accounts(account_name, region, industry)")
        .eq("campaign_id", campaignId)
        .order("communication_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const { data: deals = [] } = useQuery({
    queryKey: ["campaign-deals", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("id, stage, total_contract_value, account_id")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const contactEmails = useMemo(() => {
    return contacts.map(c => c.contacts?.email).filter(Boolean);
  }, [contacts]);

  const { data: emailHistory = [] } = useQuery({
    queryKey: ["campaign-email-history", campaignId, contactEmails.length],
    enabled: contactEmails.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_history")
        .select("id, recipient_email, sender_email, sent_at, status, opened_at, replied_at, bounced_at, open_count, unique_opens, reply_count")
        .in("recipient_email", contactEmails);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["campaign-templates-meta", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_email_templates")
        .select("id, template_name, email_type")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  // Refresh now happens automatically on mount (see effect above).

  // ───── Date / channel filtering ─────
  const cutoff = useMemo(() => {
    if (dateRange === "all") return null;
    return subDays(new Date(), parseInt(dateRange, 10));
  }, [dateRange]);

  const filteredComms = useMemo(() => {
    let rows = communications as any[];
    if (cutoff) rows = rows.filter(c => c.communication_date && isAfter(new Date(c.communication_date), cutoff));
    if (channelFilter !== "all") {
      rows = rows.filter(c => {
        const t = c.communication_type;
        if (channelFilter === "email") return t === "Email";
        if (channelFilter === "call") return t === "Call" || t === "Phone";
        if (channelFilter === "linkedin") return t === "LinkedIn";
        return true;
      });
    }
    return rows;
  }, [communications, cutoff, channelFilter]);

  const prevPeriodComms = useMemo(() => {
    if (!cutoff) return [];
    const days = parseInt(dateRange, 10);
    const prevStart = subDays(cutoff, days);
    return (communications as any[]).filter(c => {
      if (!c.communication_date) return false;
      const d = new Date(c.communication_date);
      return isAfter(d, prevStart) && !isAfter(d, cutoff);
    });
  }, [communications, cutoff, dateRange]);

  // ───── Email metrics — per-campaign attribution only ─────
  const emailStats = useMemo(() => {
    // Unified counting rules — see src/components/campaigns/emailMetrics.ts.
    // Same numbers in Outreach chips, Analytics tiles and Overview widget.
    const base = computeEmailStats(filteredComms);

    // Augment opens with email_history aggregate (capped at delivered) so a
    // recipient who opened on a device the tracking pixel mis-classified as
    // a bot still counts when the provider's own open log saw them.
    const ehInWindow = (emailHistory as any[]).filter(e => {
      if (!cutoff) return true;
      return e.sent_at && isAfter(new Date(e.sent_at), cutoff);
    });
    const openedFromHistory = ehInWindow.filter(e => e.opened_at || (e.unique_opens ?? 0) > 0).length;
    const opened = Math.min(base.delivered, Math.max(openedFromHistory, base.opened));

    const inbound = filteredComms.filter((c: any) => c.communication_type === "Email" && c.delivery_status === "received");

    return {
      sent: base.sent,
      delivered: base.delivered,
      bounced: base.bounced,
      failed: base.failed,
      opened,
      replied: base.replied,
      manualLogged: base.manualLogged,
      inboundCount: inbound.length,
      totalLogged: base.sent + base.manualLogged,
    };
  }, [filteredComms, emailHistory, cutoff]);

  const callStats = useMemo(() => {
    const calls = filteredComms.filter(c => c.communication_type === "Call" || c.communication_type === "Phone");
    const interested = calls.filter(c => c.call_outcome === "Interested").length;
    return { total: calls.length, interested, rate: pct(interested, calls.length) };
  }, [filteredComms]);

  const linkedInStats = useMemo(() => {
    const li = filteredComms.filter(c => c.communication_type === "LinkedIn");
    const responded = li.filter(c => c.linkedin_status === "Responded").length;
    return { total: li.length, responded, rate: pct(responded, li.length) };
  }, [filteredComms]);

  const responded = contacts.filter(c => c.stage === "Responded" || c.stage === "Qualified" || c.stage === "Converted");
  const dealsWon = deals.filter(d => d.stage === "Won");
  const totalDealValue = deals.reduce((s, d) => s + (Number(d.total_contract_value) || 0), 0);

  // ───── Hero KPIs ─────
  // Bug #1: prev-period replies must be computed the same way as current
  // (distinct inbound conv ids minus bounced conv ids), not raw inbound count.
  // Prev-period stats use the same unified rules so trend deltas are consistent
  // with the headline numbers (no apples-to-oranges comparisons).
  const prevStats = useMemo(() => computeEmailStats(prevPeriodComms), [prevPeriodComms]);
  const prevReplies = prevStats.replied;
  const prevSent = prevStats.sent;

  const replyRatePct = pct(emailStats.replied, emailStats.sent);
  const bounceRatePct = pct(emailStats.bounced, emailStats.sent);

  const goSetupAudience = () => onDrilldown?.({ tab: "setup", section: "audience" });
  type OutreachStatus = "all" | "sent" | "delivered" | "opened" | "replied" | "failed" | "bounced" | "notReplied" | "needsFollowup";
  const goOutreach = (status?: OutreachStatus, channel: "email" | "linkedin" | "call" = "email") => {
    onDrilldown?.({ tab: "monitoring", view: "outreach", channel, status: status ?? "all" });
  };
  const goDeals = (extra: string = "") => navigate(`/deals?campaign=${campaignId}${extra}`);

  const heroKpis = useMemo(() => {
    const tiles: Array<Parameters<typeof HeroKpiTile>[0]> = [
      {
        label: "Reach (Contacts)", value: contacts.length, icon: Users, accent: "primary",
        sublabel: `${accounts.length} account${accounts.length === 1 ? "" : "s"}`,
        onClick: onDrilldown ? goSetupAudience : undefined,
      },
      {
        label: "Emails Sent", value: emailStats.sent, icon: Send, accent: "primary",
        sublabel: emailStats.manualLogged > 0 ? `+${emailStats.manualLogged} manual` : undefined,
        delta: dateRange !== "all" ? trendDelta(emailStats.sent, prevSent) : undefined,
        onClick: onDrilldown ? () => goOutreach("sent") : undefined,
      },
      {
        label: "Reply Rate", value: `${replyRatePct}%`, icon: Reply, accent: "success",
        sublabel: `${emailStats.replied}/${emailStats.sent} replied`,
        delta: dateRange !== "all" ? trendDelta(emailStats.replied, prevReplies) : undefined,
        onClick: onDrilldown ? () => goOutreach("replied") : undefined,
      },
      {
        label: "Bounce Rate", value: `${bounceRatePct}%`, icon: AlertTriangle, accent: "failed",
        sublabel: `${emailStats.bounced}/${emailStats.sent} bounced`,
        onClick: onDrilldown ? () => goOutreach("bounced") : undefined,
      },
      {
        label: "Deals Won", value: dealsWon.length, icon: Trophy, accent: "call",
        sublabel: `of ${deals.length} created`,
        onClick: () => goDeals(dealsWon.length > 0 ? "&stage=Won" : ""),
      },
      {
        label: "Pipeline", value: `€${totalDealValue.toLocaleString()}`, icon: DollarSign, accent: "linkedin",
        onClick: () => goDeals(),
      },
    ];
    return tiles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.length, accounts.length, emailStats, dealsWon.length, deals.length, totalDealValue, prevSent, prevReplies, dateRange, replyRatePct, bounceRatePct, onDrilldown, campaignId]);

  // ───── Funnel ─────
  // Bug #5: clamp Won against the pre-clamped Created so a Won deal that
  // skipped Qualified is still counted, then propagate non-increasing.
  const funnel = useMemo(() => {
    const targeted = contacts.length;
    const contacted = contacts.filter(c => c.stage !== "Not Contacted").length;
    const respondedC = responded.length;
    const qualified = contacts.filter(c => c.stage === "Qualified" || c.stage === "Converted").length;
    const created = deals.length;
    const won = Math.min(dealsWon.length, created);
    const raw = [
      { label: "Targeted", value: targeted, icon: Target, status: undefined as undefined | "all" | "sent" | "replied", goto: "audience" as const },
      { label: "Contacted", value: contacted, icon: Send, status: "sent" as const, goto: "outreach" as const },
      { label: "Responded", value: respondedC, icon: Reply, status: "replied" as const, goto: "outreach" as const },
      { label: "Qualified", value: qualified, icon: TrendingUp, status: undefined, goto: "audience" as const },
      { label: "Deal Created", value: created, icon: BarChart3, status: undefined, goto: "deals" as const },
      { label: "Won", value: won, icon: Trophy, status: undefined, goto: "dealsWon" as const },
    ];
    for (let i = 1; i < raw.length; i++) {
      raw[i].value = Math.min(raw[i].value, raw[i - 1].value);
    }
    return raw;
  }, [contacts, responded.length, deals.length, dealsWon.length]);

  // ───── Channel mix ─────
  // Bug #9: filter empty BEFORE the col-span decision (was filtering after).
  const channelData = useMemo(() => {
    type Row = { name: string; value: number; fill: string; channel: "email" | "call" | "linkedin" };
    const data: Row[] = [
      showEmailCh ? { name: "Email", value: filteredComms.filter(c => c.communication_type === "Email").length, fill: CHART.primary as string, channel: "email" } : null,
      showCallCh ? { name: "Call", value: callStats.total, fill: CHART.call as string, channel: "call" } : null,
      showLinkedInCh ? { name: "LinkedIn", value: linkedInStats.total, fill: CHART.linkedin as string, channel: "linkedin" } : null,
    ].filter((x): x is Row => !!x && x.value > 0);
    return data;
  }, [filteredComms, callStats.total, linkedInStats.total, showEmailCh, showCallCh, showLinkedInCh]);

  // ───── Timeline ─────
  const timelineData = useMemo(() => {
    if (filteredComms.length === 0) return [];
    const map: Record<string, { week: string; ts: number; Email: number; Call: number; LinkedIn: number }> = {};
    filteredComms.forEach((c: any) => {
      if (!c.communication_date) return;
      const d = new Date(c.communication_date);
      const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());
      const ts = startOfDay(ws).getTime();
      const key = format(ws, "dd MMM");
      if (!map[key]) map[key] = { week: key, ts, Email: 0, Call: 0, LinkedIn: 0 };
      const t = c.communication_type === "Phone" ? "Call" : c.communication_type as "Email" | "Call" | "LinkedIn";
      if (map[key][t] !== undefined) map[key][t]++;
    });
    return Object.values(map).sort((a, b) => a.ts - b.ts);
  }, [filteredComms]);

  // ───── Per-template performance ─────
  // Bug #6: tids on campaign_communications are mostly UUIDs, but legacy rows
  // can carry the template_name string. Resolve by id first, then by name.
  const templatePerf = useMemo(() => {
    const byId = new Map<string, string>();
    const byName = new Map<string, string>();
    (templates as any[]).forEach(t => {
      byId.set(t.id, t.template_name || "(unnamed)");
      if (t.template_name) byName.set(t.template_name, t.template_name);
    });
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const agg: Record<string, { id: string; name: string; deleted: boolean; sent: number; opened: number; replied: number; bounced: number }> = {};
    // Use the same deduped outbound set + bounced/replied conv id sets as the
    // headline KPI tile so per-template Sent sums to the headline number.
    const baseStats = computeEmailStats(filteredComms);
    const seenDedupe = new Set<string>();
    const dedupedOutbound = filteredComms.filter((c: any) => {
      if (c.communication_type !== "Email") return false;
      if (c.sent_via !== "azure" && c.sent_via !== "manual" && c.sent_via) return false;
      // Exclude bounce / failed rows from the per-template send count
      if (isBounce(c) || isFailedSend(c)) return false;
      const k = String(c.internet_message_id || c.message_id || c.send_request_id || c.id);
      if (seenDedupe.has(k)) return false;
      seenDedupe.add(k);
      return true;
    });
    dedupedOutbound.forEach((c: any) => {
      const tid = (c.template_id || "").toString().trim() || "__none__";
      const resolved = tid === "__none__"
        ? { name: "Ad-hoc / no template", deleted: false }
        : byId.has(tid)
          ? { name: byId.get(tid)!, deleted: false }
          : byName.has(tid)
            ? { name: byName.get(tid)!, deleted: false }
            : isUuid(tid)
              ? { name: "(deleted template)", deleted: true }
              : { name: tid, deleted: false };
      if (!agg[tid]) agg[tid] = { id: tid, name: resolved.name, deleted: resolved.deleted, sent: 0, opened: 0, replied: 0, bounced: 0 };
      const row = agg[tid];
      row.sent++;
      if (c.opened_at || (c.open_count ?? 0) > 0) row.opened++;
      if (c.conversation_id && baseStats.repliedConvIds.has(c.conversation_id)) row.replied++;
      if (c.conversation_id && baseStats.bouncedConvIds.has(c.conversation_id)) row.bounced++;
    });
    return Object.values(agg).sort((a, b) => b.sent - a.sent);
  }, [filteredComms, templates]);

  // ───── Breakdowns ─────
  const breakdownByRegion = useMemo(() => {
    const map: Record<string, { name: string; contacts: number; replies: number }> = {};
    contacts.forEach(c => {
      const region = c.accounts?.region || c.contacts?.region || "Unknown";
      if (!map[region]) map[region] = { name: region, contacts: 0, replies: 0 };
      map[region].contacts++;
      if (c.stage === "Responded" || c.stage === "Qualified" || c.stage === "Converted") map[region].replies++;
    });
    return Object.values(map).sort((a, b) => b.contacts - a.contacts).slice(0, 8);
  }, [contacts]);

  const breakdownByIndustry = useMemo(() => {
    const map: Record<string, { name: string; contacts: number; replies: number }> = {};
    contacts.forEach(c => {
      const ind = c.accounts?.industry || "Unknown";
      if (!map[ind]) map[ind] = { name: ind, contacts: 0, replies: 0 };
      map[ind].contacts++;
      if (c.stage === "Responded" || c.stage === "Qualified" || c.stage === "Converted") map[ind].replies++;
    });
    return Object.values(map).sort((a, b) => b.contacts - a.contacts).slice(0, 8);
  }, [contacts]);

  const breakdownByAccount = useMemo(() => {
    const map: Record<string, { id: string | null; name: string; touches: number; replies: number }> = {};
    filteredComms.forEach((c: any) => {
      const name = c.accounts?.account_name || "Unknown";
      const id = c.account_id || null;
      if (!map[name]) map[name] = { id, name, touches: 0, replies: 0 };
      map[name].touches++;
      if (isInbound(c) || c.email_status === "Replied" || c.call_outcome === "Interested" || c.linkedin_status === "Responded") {
        map[name].replies++;
      }
    });
    return Object.values(map).sort((a, b) => b.replies - a.replies || b.touches - a.touches).slice(0, 5);
  }, [filteredComms]);

  // Export removed — Outreach toolbar is now the single export surface.


  // Funnel row click handler
  const onFunnelRowClick = (stage: typeof funnel[number]) => {
    if (!onDrilldown && stage.goto !== "deals" && stage.goto !== "dealsWon") return;
    if (stage.goto === "audience") onDrilldown?.({ tab: "setup", section: "audience" });
    else if (stage.goto === "outreach") onDrilldown?.({ tab: "monitoring", view: "outreach", channel: "email", status: stage.status ?? "all" });
    else if (stage.goto === "deals") goDeals();
    else if (stage.goto === "dealsWon") goDeals(stage.value > 0 ? "&stage=Won" : "");
  };

  // Email Performance tile click → matching outreach status filter
  const emailTileClick = (status: "sent" | "delivered" | "opened" | "replied" | "bounced" | "failed") => {
    onDrilldown?.({ tab: "monitoring", view: "outreach", channel: "email", status });
  };

  const breakdownsSummary = `${breakdownByRegion.length} region${breakdownByRegion.length === 1 ? "" : "s"} · ${breakdownByIndustry.length} industr${breakdownByIndustry.length === 1 ? "y" : "ies"} · ${breakdownByAccount.length} top accounts`;

  // ────────────────────────── Render ──────────────────────────
  return (
    <div className="space-y-3">
      {/* TOOLBAR — matches Outreach toolbar style. Toggle + filters all inline. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border bg-muted/30 px-2 py-1.5">
        {viewMode && onViewModeChange && (
          <div className="inline-flex h-7 shrink-0 items-center rounded-md border bg-background p-0.5 text-xs shadow-sm">
            <button
              type="button"
              onClick={() => onViewModeChange("outreach")}
              className={`h-6 shrink-0 whitespace-nowrap rounded-sm px-3 transition-colors ${viewMode === "outreach" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Outreach
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("analytics")}
              className={`h-6 shrink-0 whitespace-nowrap rounded-sm px-3 transition-colors ${viewMode === "analytics" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Analytics
            </button>
          </div>
        )}
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
          <SelectTrigger className="h-7 w-[130px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7" className="text-xs">Last 7 days</SelectItem>
            <SelectItem value="30" className="text-xs">Last 30 days</SelectItem>
            <SelectItem value="90" className="text-xs">Last 90 days</SelectItem>
            <SelectItem value="all" className="text-xs">All time</SelectItem>
          </SelectContent>
        </Select>
        <div className="inline-flex h-7 shrink-0 items-center rounded-md border bg-muted/40 p-0.5 text-xs">
          {(["all", "email", "call", "linkedin"] as ChannelFilter[])
            .filter(c => c === "all"
              || (c === "email" && showEmailCh)
              || (c === "call" && showCallCh)
              || (c === "linkedin" && showLinkedInCh))
            .map(c => (
              <button
                key={c}
                onClick={() => setChannelFilter(c)}
                className={`h-6 shrink-0 whitespace-nowrap rounded-sm px-2.5 capitalize transition-colors ${channelFilter === c ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {c === "all" ? "All Channels" : c}
              </button>
            ))}
        </div>
      </div>

      {/* ZONE A — Feature-rich KPIs (Hero + Email Performance merged) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {heroKpis.map(k => <HeroKpiTile key={k.label} {...k} />)}
      </div>
      {(emailStats.sent > 0 || emailStats.manualLogged > 0) && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { key: "sent",      label: "Sent",      value: emailStats.sent,      color: CHART.primary,  icon: Send,           tint: "from-sky-500/10 to-sky-500/0       border-sky-500/30" },
            { key: "delivered", label: "Delivered", value: emailStats.delivered, color: CHART.success,  icon: Inbox,          tint: "from-emerald-500/10 to-emerald-500/0 border-emerald-500/30" },
            { key: "opened",    label: "Opened",    value: emailStats.opened,    color: CHART.opened,   icon: Eye,            tint: "from-amber-500/10 to-amber-500/0   border-amber-500/30" },
            { key: "replied",   label: "Replied",   value: emailStats.replied,   color: CHART.linkedin, icon: Reply,          tint: "from-violet-500/10 to-violet-500/0 border-violet-500/30" },
            { key: "bounced",   label: "Bounced",   value: emailStats.bounced,   color: CHART.failed,   icon: AlertTriangle,  tint: "from-rose-500/10 to-rose-500/0     border-rose-500/30" },
            { key: "failed",    label: "Failed",    value: emailStats.failed,    color: CHART.failed,   icon: XCircle,        tint: "from-rose-500/10 to-rose-500/0     border-rose-500/30" },
          ].map(s => (
            <button
              key={s.label}
              type="button"
              onClick={() => emailTileClick(s.key as any)}
              disabled={!onDrilldown}
              className={`rounded-md border bg-gradient-to-br p-2 text-left transition-all enabled:hover:shadow-sm enabled:hover:-translate-y-0.5 disabled:cursor-default ${s.tint}`}
            >
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-medium uppercase tracking-wide">{s.label}</span>
                <s.icon className="h-3 w-3" style={{ color: s.color }} />
              </div>
              <div className="text-lg font-bold tabular-nums leading-tight mt-0.5" style={{ color: s.color }}>{s.value}</div>
            </button>
          ))}
        </div>
      )}

      {/* ZONE B — Funnel (narrow) + Email Rates / Channel Mix side car */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="border-border/60 shadow-sm lg:col-span-2">
          <CardHeader className="p-3 pb-1.5">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-primary" /> Conversion Funnel
              {emailStats.manualLogged > 0 && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="ml-1 h-4 text-[10px] font-normal">+{emailStats.manualLogged} manual</Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-[220px]">
                      {emailStats.manualLogged} manually logged email{emailStats.manualLogged === 1 ? "" : "s"} (not provider-sent, excluded from rates).
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            {funnel[0].value === 0 ? (
              <EmptyHint
                icon={Users}
                message="Add contacts to this campaign to see the funnel"
                ctaLabel={onDrilldown ? "Open audience" : undefined}
                onCta={onDrilldown ? goSetupAudience : undefined}
              />
            ) : (
              <div className="space-y-2">
                {funnel.map((stage, i) => {
                  const max = funnel[0].value || 1;
                  const widthPct = pct(stage.value, max);
                  const prev = i > 0 ? funnel[i - 1].value : stage.value;
                  const conv = pct(stage.value, prev);
                  const Icon = stage.icon;
                  const clickable = !!onDrilldown || stage.goto === "deals" || stage.goto === "dealsWon";
                  return (
                    <div
                      key={stage.label}
                      className={`flex items-center gap-2 rounded px-1 py-0.5 ${clickable ? "cursor-pointer hover:bg-muted/30" : ""}`}
                      onClick={clickable ? () => onFunnelRowClick(stage) : undefined}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : -1}
                      onKeyDown={clickable ? (e) => { if (e.key === "Enter") onFunnelRowClick(stage); } : undefined}
                    >
                      <div className="w-24 text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
                        <Icon className="h-3 w-3" /> {stage.label}
                      </div>
                      <div className="flex-1 bg-muted rounded h-5 overflow-hidden relative">
                        <div
                          className="h-full rounded flex items-center justify-end pr-2 transition-all"
                          style={{
                            width: `${stage.value === 0 ? 0 : Math.max(widthPct, 4)}%`,
                            background: `linear-gradient(90deg, ${CHART.primary}, hsl(var(--primary) / 0.7))`,
                          }}
                        >
                          <span className="text-[11px] font-semibold text-primary-foreground tabular-nums">{stage.value}</span>
                        </div>
                      </div>
                      <div className="w-9 text-[11px] text-muted-foreground tabular-nums text-right shrink-0">{widthPct}%</div>
                      {i > 0 && (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal shrink-0 hidden sm:inline-flex">
                          <ArrowRight className="h-2.5 w-2.5 mr-0.5" />{conv}%
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Side car — Email Rates (when email sent) else Channel Mix else empty hint */}
        {emailStats.sent > 0 ? (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="p-3 pb-1.5">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-primary" /> Email Rates
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1 space-y-2.5">
              <RateRow label="Delivery Rate" num={emailStats.delivered} den={emailStats.sent} color={CHART.success}
                hint="Delivered / Sent. Delivered = Sent - Bounced - Failed." />
              <RateRow label="Open Rate" num={emailStats.opened} den={emailStats.delivered} color={CHART.opened}
                hint="Unique opens / Delivered (capped at 100%)." />
              <RateRow label="Reply Rate" num={emailStats.replied} den={emailStats.sent} color={CHART.linkedin}
                hint="Distinct conversations with >= 1 inbound (non-NDR) message / Sent." />
              <RateRow label="Bounce Rate" num={emailStats.bounced} den={emailStats.sent} color={CHART.failed}
                hint="Hard bounces only (Failed sends tracked separately)." />
            </CardContent>
          </Card>
        ) : channelData.length >= 2 ? (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="p-3 pb-1.5">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-primary" /> Channel Mix
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1">
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={channelData} cx="50%" cy="50%" innerRadius={36} outerRadius={60} paddingAngle={3} dataKey="value" stroke="none">
                    {channelData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <RechartsTooltip
                    formatter={(v: number, n: string) => [`${v} messages`, n]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-1">
                {channelData.map(c => {
                  const total = channelData.reduce((s, x) => s + x.value, 0);
                  const clickable = !!onDrilldown;
                  return (
                    <div
                      key={c.name}
                      className={`flex items-center justify-between text-xs rounded px-1 py-0.5 ${clickable ? "cursor-pointer hover:bg-muted/30" : ""}`}
                      onClick={clickable ? () => onDrilldown!({ tab: "monitoring", view: "outreach", channel: c.channel }) : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ background: c.fill }} />
                        <span className="text-muted-foreground">{c.name}</span>
                      </div>
                      <span className="tabular-nums font-medium">{c.value} <span className="text-muted-foreground">({pct(c.value, total)}%)</span></span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/60 shadow-sm border-dashed">
            <CardContent className="p-3 h-full flex items-center justify-center">
              <EmptyHint
                icon={Mail}
                message="No outreach yet"
                ctaLabel={onDrilldown ? "Send your first message" : undefined}
                onCta={onDrilldown ? () => onDrilldown({ tab: "monitoring", view: "outreach", channel: "email" }) : undefined}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Channel Mix as standalone row when both Email Rates and Mix should show */}
      {emailStats.sent > 0 && channelData.length >= 2 && (
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-3 pb-1.5">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-primary" /> Channel Mix
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={channelData} cx="50%" cy="50%" innerRadius={36} outerRadius={60} paddingAngle={3} dataKey="value" stroke="none">
                    {channelData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <RechartsTooltip
                    formatter={(v: number, n: string) => [`${v} messages`, n]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="md:col-span-2 space-y-1">
                {channelData.map(c => {
                  const total = channelData.reduce((s, x) => s + x.value, 0);
                  const clickable = !!onDrilldown;
                  return (
                    <div
                      key={c.name}
                      className={`flex items-center justify-between text-xs rounded px-1 py-0.5 ${clickable ? "cursor-pointer hover:bg-muted/30" : ""}`}
                      onClick={clickable ? () => onDrilldown!({ tab: "monitoring", view: "outreach", channel: c.channel }) : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ background: c.fill }} />
                        <span className="text-muted-foreground">{c.name}</span>
                      </div>
                      <span className="tabular-nums font-medium">{c.value} <span className="text-muted-foreground">({pct(c.value, total)}%)</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}


      {/* ZONE D — Trends */}
      {timelineData.length > 1 && (
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-3 pb-1.5">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-primary" /> Outreach Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={timelineData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
                {showEmailCh && <Area type="monotone" dataKey="Email" stackId="1" stroke={CHART.primary} fill={CHART.primary} fillOpacity={0.35} strokeWidth={2} />}
                {showCallCh && <Area type="monotone" dataKey="Call" stackId="1" stroke={CHART.call} fill={CHART.call} fillOpacity={0.35} strokeWidth={2} />}
                {showLinkedInCh && <Area type="monotone" dataKey="LinkedIn" stackId="1" stroke={CHART.linkedin} fill={CHART.linkedin} fillOpacity={0.35} strokeWidth={2} />}
                <Legend iconSize={8} formatter={(v: string) => <span className="text-xs text-muted-foreground">{v}</span>} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ZONE E — Template Performance + Breakdowns side-by-side on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-3 pb-1.5">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-primary" /> Template Performance
              <span className="text-[10px] text-muted-foreground font-normal">
                · {templatePerf.length} used
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-1">
            {templatePerf.length === 0 ? (
              <EmptyHint icon={Mail} message="No template-attributed sends yet" />
            ) : (
              <div className="space-y-0.5">
                <div className="grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium px-1 pb-1">
                  <div className="col-span-5">Template</div>
                  <div className="col-span-1 text-right">Sent</div>
                  <div className="col-span-2 text-right">Open</div>
                  <div className="col-span-2 text-right">Reply</div>
                  <div className="col-span-2 text-right">Bounce</div>
                </div>
                {templatePerf.map(t => {
                  const openRate = pct(t.opened, t.sent);
                  const replyRate = pct(t.replied, t.sent);
                  const bounceRate = pct(t.bounced, t.sent);
                  const clickable = !!onDrilldown;
                  return (
                    <div
                      key={t.id}
                      className={`grid grid-cols-12 gap-2 items-center text-xs px-1 py-1 rounded ${clickable ? "cursor-pointer hover:bg-muted/30" : ""}`}
                      onClick={clickable ? () => onDrilldown!({ tab: "monitoring", view: "outreach", channel: "email", status: "sent" }) : undefined}
                      title={t.name}
                    >
                      <div className="col-span-5 truncate font-medium flex items-center gap-1">
                        {t.deleted && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
                        <span className="truncate">{t.name}</span>
                      </div>
                      <div className="col-span-1 text-right tabular-nums">{t.sent}</div>
                      <div className="col-span-2 text-right tabular-nums">
                        <span style={{ color: CHART.opened }}>{openRate}%</span>
                      </div>
                      <div className="col-span-2 text-right tabular-nums">
                        <span style={{ color: CHART.success }}>{replyRate}%</span>
                      </div>
                      <div className="col-span-2 text-right tabular-nums">
                        <span style={{ color: bounceRate > 5 ? CHART.failed : "hsl(var(--muted-foreground))" }}>{bounceRate}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader
            className="p-3 pb-1.5 cursor-pointer select-none hover:bg-muted/30 transition-colors"
            onClick={() => setBreakdownsOpen(o => !o)}
          >
            <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <Filter className="h-3.5 w-3.5 text-primary" />
                <span>Breakdowns</span>
                <span className="text-[11px] font-normal text-muted-foreground truncate">· {breakdownsSummary}</span>
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${breakdownsOpen ? "rotate-180" : ""}`} />
            </CardTitle>
          </CardHeader>
          {breakdownsOpen && (
            <CardContent className="p-3 pt-1">
              <Tabs defaultValue="region">
                <TabsList className="h-7">
                  <TabsTrigger value="region" className="h-6 text-xs">By Region</TabsTrigger>
                  <TabsTrigger value="industry" className="h-6 text-xs">By Industry</TabsTrigger>
                  <TabsTrigger value="accounts" className="h-6 text-xs">Top Accounts</TabsTrigger>
                </TabsList>
                <TabsContent value="region" className="mt-2">
                  <BreakdownTable
                    rows={breakdownByRegion.map(r => ({ key: r.name, name: r.name, primary: r.contacts, secondary: r.replies }))}
                    primaryLabel="Contacts" secondaryLabel="Replies" emptyHint="No region data on linked accounts"
                    onRowClick={onDrilldown ? () => onDrilldown({ tab: "setup", section: "audience" }) : undefined}
                  />
                </TabsContent>
                <TabsContent value="industry" className="mt-2">
                  <BreakdownTable
                    rows={breakdownByIndustry.map(r => ({ key: r.name, name: r.name, primary: r.contacts, secondary: r.replies }))}
                    primaryLabel="Contacts" secondaryLabel="Replies" emptyHint="No industry data on linked accounts"
                    onRowClick={onDrilldown ? () => onDrilldown({ tab: "setup", section: "audience" }) : undefined}
                  />
                </TabsContent>
                <TabsContent value="accounts" className="mt-2">
                  <BreakdownTable
                    rows={breakdownByAccount.map(r => ({ key: r.name, name: r.name, primary: r.touches, secondary: r.replies, accountId: r.id }))}
                    primaryLabel="Touchpoints" secondaryLabel="Replies" emptyHint="No outreach yet"
                    onRowClick={(row) => row.accountId ? navigate(`/accounts/${row.accountId}`) : undefined}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          )}
        </Card>
      </div>

    </div>
  );
}

interface BreakdownRow { key: string; name: string; primary: number; secondary: number; accountId?: string | null }

function BreakdownTable({ rows, primaryLabel, secondaryLabel, emptyHint, onRowClick }: {
  rows: BreakdownRow[];
  primaryLabel: string;
  secondaryLabel: string;
  emptyHint: string;
  onRowClick?: (row: BreakdownRow) => void;
}) {
  if (rows.length === 0) return <EmptyHint icon={Filter} message={emptyHint} />;
  const max = Math.max(...rows.map(r => r.primary), 1);
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium px-1">
        <div className="col-span-5">Name</div>
        <div className="col-span-5">{primaryLabel}</div>
        <div className="col-span-2 text-right">{secondaryLabel}</div>
      </div>
      {rows.map(r => {
        const clickable = !!onRowClick;
        return (
          <div
            key={r.key}
            className={`grid grid-cols-12 gap-2 items-center text-xs px-1 py-1 rounded ${clickable ? "cursor-pointer hover:bg-muted/30" : ""}`}
            onClick={clickable ? () => onRowClick?.(r) : undefined}
          >
            <div className="col-span-5 truncate font-medium" title={r.name}>{r.name}</div>
            <div className="col-span-5 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct(r.primary, max)}%`, background: CHART.primary }} />
              </div>
              <span className="tabular-nums w-8 text-right">{r.primary}</span>
            </div>
            <div className="col-span-2 text-right tabular-nums text-muted-foreground">{r.secondary}</div>
          </div>
        );
      })}
    </div>
  );
}
