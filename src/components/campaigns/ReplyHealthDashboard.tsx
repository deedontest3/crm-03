import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, CartesianGrid } from "recharts";
import { FileDown, ShieldCheck, AlertTriangle, Activity, TrendingDown } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format, subDays } from "date-fns";

const REASON_LABELS: Record<string, string> = {
  chronology: "Chronology",
  subject_mismatch: "Subject mismatch",
  contact_mismatch: "Contact mismatch",
  ambiguous_candidates: "Ambiguous",
  no_eligible_parent: "No eligible parent",
};

interface Props {
  campaignId: string;
}

export function ReplyHealthDashboard({ campaignId }: Props) {
  const navigate = useNavigate();
  const [range, setRange] = useState<"7" | "30" | "90">("30");

  const { from, to } = useMemo(() => {
    const days = parseInt(range, 10);
    return {
      from: subDays(new Date(), days).toISOString(),
      to: new Date().toISOString(),
    };
  }, [range]);

  const { data: validReplies = [] } = useQuery({
    queryKey: ["reply-health-valid", campaignId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_communications")
        .select("id, communication_date, notes")
        .eq("campaign_id", campaignId)
        .eq("sent_via", "graph-sync")
        .gte("communication_date", from)
        .lte("communication_date", to);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: skipped = [] } = useQuery({
    queryKey: ["reply-health-skipped", campaignId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_reply_skip_log")
        .select("*")
        .eq("campaign_id", campaignId)
        .gte("created_at", from)
        .lte("created_at", to);
      if (error) throw error;
      return data || [];
    },
  });

  const totalValid = validReplies.length;
  const totalSkipped = skipped.length;
  const skipRate = totalValid + totalSkipped === 0 ? 0 : Math.round((totalSkipped / (totalValid + totalSkipped)) * 100);
  const activeGuards = useMemo(() => new Set(skipped.map((s: any) => s.skip_reason)).size, [skipped]);

  // Time series: per-day valid vs skipped
  const series = useMemo(() => {
    const days = parseInt(range, 10);
    const buckets = new Map<string, { day: string; valid: number; skipped: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "MMM dd");
      buckets.set(d, { day: d, valid: 0, skipped: 0 });
    }
    for (const v of validReplies) {
      if (!v.communication_date) continue;
      const d = format(new Date(v.communication_date), "MMM dd");
      const b = buckets.get(d);
      if (b) b.valid++;
    }
    for (const s of skipped) {
      const d = format(new Date(s.created_at), "MMM dd");
      const b = buckets.get(d);
      if (b) b.skipped++;
    }
    return Array.from(buckets.values());
  }, [validReplies, skipped, range]);

  // Reason breakdown
  const reasonData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of skipped) counts.set(s.skip_reason, (counts.get(s.skip_reason) || 0) + 1);
    return Array.from(counts.entries())
      .map(([k, v]) => ({ reason: REASON_LABELS[k] || k, count: v }))
      .sort((a, b) => b.count - a.count);
  }, [skipped]);

  // Top offenders
  const offenders = useMemo(() => {
    const map = new Map<string, { sender: string; conv: string; count: number }>();
    for (const s of skipped) {
      const key = `${s.sender_email || "?"}::${s.conversation_id || "?"}`;
      const existing = map.get(key);
      if (existing) existing.count++;
      else map.set(key, { sender: s.sender_email || "—", conv: s.conversation_id || "—", count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [skipped]);

  const downloadPdf = async () => {
    try {
      toast({ title: "Generating PDF…" });
      const { data, error } = await supabase.functions.invoke("email-skip-report", {
        body: { campaign_id: campaignId, from, to },
      });
      if (error) throw error;
      const blob = data instanceof Blob ? data : new Blob([data as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reply-health-${from.slice(0, 10)}-to-${to.slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "PDF failed", description: e?.message || "Could not generate PDF.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Reply Health</h2>
          <p className="text-xs text-muted-foreground">Validity of inbound replies attached to this campaign.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as "7" | "30" | "90")}>
            <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={downloadPdf} className="h-8 gap-1">
            <FileDown className="h-3.5 w-3.5" /> PDF report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={ShieldCheck} label="Valid replies" value={totalValid} tone="positive" />
        <Kpi icon={AlertTriangle} label="Skipped replies" value={totalSkipped} tone="warning" />
        <Kpi icon={TrendingDown} label="Skip rate" value={`${skipRate}%`} tone={skipRate > 20 ? "warning" : "neutral"} />
        <Kpi icon={Activity} label="Active guards" value={activeGuards} tone="neutral" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Valid vs skipped per day</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="valid" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Valid" />
                <Line type="monotone" dataKey="skipped" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="Skipped" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Skips by reason</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={reasonData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="reason" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="count" fill="hsl(var(--destructive))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Top offending senders / conversations</CardTitle>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate("/settings/email-skip-audit")}>
            View full audit log →
          </Button>
        </CardHeader>
        <CardContent>
          {offenders.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">No skipped replies in this window.</p>
          ) : (
            <div className="space-y-1">
              {offenders.map((o, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{o.sender}</div>
                    <div className="text-muted-foreground font-mono text-[10px] truncate">{o.conv}</div>
                  </div>
                  <Badge variant="outline" className="ml-2">{o.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone: "positive" | "warning" | "neutral" }) {
  const toneClass =
    tone === "positive" ? "text-primary" :
    tone === "warning" ? "text-destructive" :
    "text-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default ReplyHealthDashboard;
