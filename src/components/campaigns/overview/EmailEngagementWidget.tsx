import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Mail } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip } from "recharts";
import { computeEmailStats } from "../emailMetrics";

const COLORS = {
  Awaiting: "hsl(217, 91%, 60%)",
  Replied: "hsl(142, 71%, 45%)",
  Failed: "hsl(0, 72%, 51%)",
  Opened: "hsl(199, 89%, 48%)",
  Delivered: "hsl(160, 60%, 45%)",
  Bounced: "hsl(25, 85%, 55%)",
  Sent: "hsl(220, 13%, 50%)",
};

interface Props {
  communications: any[];
  onDrilldown?: (status: "sent" | "replied" | "failed" | "bounced") => void;
}

/**
 * Per-campaign Email Engagement widget — same metrics shape as the global
 * dashboard widget but scoped to a single campaign's communications.
 */
export function EmailEngagementWidget({ communications, onDrilldown }: Props) {
  const metrics = useMemo(() => {
    // Unified rules — matches Outreach chips and Analytics tiles exactly.
    const s = computeEmailStats(communications);
    const replyRate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
    const openRate = s.sent > 0 ? Math.round((s.opened / s.sent) * 100) : 0;
    const deliveryRate = s.sent > 0 ? Math.round((s.delivered / s.sent) * 100) : 0;
    return {
      sent: s.sent,
      replied: s.replied,
      failed: s.failed,
      bounced: s.bounced,
      opened: s.opened,
      delivered: s.delivered,
      replyRate,
      openRate,
      deliveryRate,
    };
  }, [communications]);

  const chartData = useMemo(() => {
    const awaiting = Math.max(0, metrics.sent - metrics.replied - metrics.failed - metrics.bounced);
    const arr = [
      { name: "Awaiting reply", value: awaiting, fill: COLORS.Awaiting },
      { name: "Replied", value: metrics.replied, fill: COLORS.Replied },
      { name: "Failed", value: metrics.failed, fill: COLORS.Failed },
      { name: "Bounced", value: metrics.bounced, fill: COLORS.Bounced },
    ].filter((d) => d.value > 0);
    return arr;
  }, [metrics]);

  if (metrics.sent === 0) {
    return (
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">Email Engagement</h3>
          </div>
          <p className="text-[11px] text-muted-foreground">No emails sent yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-emerald-500 to-amber-500" />
      <CardContent className="p-3 h-full">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-5 w-5 rounded-md bg-blue-500/15 flex items-center justify-center">
            <Mail className="h-3 w-3 text-blue-600 dark:text-blue-300" />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wider">Email Engagement</h3>
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {metrics.sent} total
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Donut */}
          <div className="relative w-[110px] h-[110px] shrink-0 drop-shadow-[0_4px_8px_rgba(0,0,0,0.08)]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={32}
                  outerRadius={52}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                  className="cursor-pointer"
                  onClick={(seg: any) => {
                    const n = (seg?.name || "").toLowerCase();
                    if (n === "replied") onDrilldown?.("replied");
                    else if (n === "failed") onDrilldown?.("failed");
                    else if (n === "bounced") onDrilldown?.("bounced");
                    else onDrilldown?.("sent");
                  }}
                >
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <RTooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-lg font-bold leading-none tabular-nums bg-gradient-to-br from-emerald-500 to-blue-500 bg-clip-text text-transparent">
                {metrics.replyRate}%
              </span>
              <span className="text-[9px] text-muted-foreground mt-0.5 font-medium uppercase tracking-wider">Reply</span>
            </div>
          </div>

          {/* Metric grid */}
          <div className="flex-1 grid grid-cols-2 gap-x-2 gap-y-1 min-w-0 text-[11px]">
            <Row color={COLORS.Sent} label="Sent" value={metrics.sent} onClick={() => onDrilldown?.("sent")} />
            <Row color={COLORS.Replied} label="Replied" value={metrics.replied} sub={`${metrics.replyRate}%`} onClick={() => onDrilldown?.("replied")} />
            <Row color={COLORS.Opened} label="Opened" value={metrics.opened} sub={`${metrics.openRate}%`} />
            <Row color={COLORS.Delivered} label="Delivered" value={metrics.delivered} sub={`${metrics.deliveryRate}%`} />
            <Row color={COLORS.Failed} label="Failed" value={metrics.failed} onClick={() => onDrilldown?.("failed")} />
            {metrics.bounced > 0 && (
              <Row color={COLORS.Bounced} label="Bounced" value={metrics.bounced} onClick={() => onDrilldown?.("bounced")} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  color,
  label,
  value,
  sub,
  onClick,
}: {
  color: string;
  label: string;
  value: number;
  sub?: string;
  onClick?: () => void;
}) {
  const Cmp: any = onClick ? "button" : "div";
  return (
    <Cmp
      onClick={onClick}
      className={`flex items-center gap-1.5 min-w-0 rounded px-1 -mx-1 py-0.5 text-left transition-all ${
        onClick ? "hover:bg-muted/60 hover:ring-1 hover:ring-border cursor-pointer" : ""
      }`}
    >
      <span className="h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-background shadow-sm" style={{ background: color }} />
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="ml-auto tabular-nums font-semibold">{value}</span>
      {sub && <span className="text-muted-foreground tabular-nums text-[10px]">({sub})</span>}
    </Cmp>
  );
}
