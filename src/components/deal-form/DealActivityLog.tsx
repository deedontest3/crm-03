import { useMemo, useState, useEffect, Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealActivityLog, DealActivityEntry } from "@/hooks/useDealActivityLog";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { History, Search, Download, ChevronDown, ChevronRight, ArrowRight, Pencil, Plus, Trash2, GitBranch } from "lucide-react";

interface DealActivityLogProps {
  dealId?: string;
  /** Height of the scroll area. Defaults to "h-72". */
  scrollHeight?: string;
  /** Hide the header row (used when parent supplies its own). */
  hideHeader?: boolean;
}

const formatValueFull = (v: any): string => {
  if (v === null || v === undefined) return "—";
  if (v === "") return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
};

const formatValueShort = (v: any): string => {
  const s = formatValueFull(v);
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
};

const humanizeField = (raw?: string | null): string => {
  if (!raw) return "Field";
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bTcv\b/g, "TCV")
    .replace(/\bRfq\b/g, "RFQ")
    .replace(/\bPo\b/g, "PO")
    .replace(/\bId\b/g, "ID");
};

const eventMeta = (
  e: DealActivityEntry
): { label: string; Icon: typeof Pencil; tone: string } => {
  switch (e.event_type) {
    case "created":
      return { label: "Deal created", Icon: Plus, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
    case "deleted":
      return { label: "Deal deleted", Icon: Trash2, tone: "bg-destructive/10 text-destructive" };
    case "stage_change":
      return { label: "Stage changed", Icon: GitBranch, tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400" };
    case "field_change":
      return { label: humanizeField(e.field_name), Icon: Pencil, tone: "bg-primary/10 text-primary" };
    default:
      return { label: e.event_type, Icon: Pencil, tone: "bg-muted text-muted-foreground" };
  }
};

const safeDate = (s: string): string => {
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
};

const formatTime = (s: string): string => {
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
};

const dayKey = (s: string): string => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toDateString();
};

const formatDayHeader = (s: string): string => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
};

const toCsv = (rows: DealActivityEntry[], nameMap: Record<string, string>): string => {
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ["created_at", "event_type", "field_name", "actor", "old_value", "new_value"];
  const body = rows.map((e) =>
    [
      safeDate(e.created_at),
      e.event_type,
      e.field_name ?? "",
      e.actor_id ? nameMap[e.actor_id] ?? e.actor_id : "System",
      formatValueFull(e.old_value),
      formatValueFull(e.new_value),
    ]
      .map(esc)
      .join(",")
  );
  return [head.join(","), ...body].join("\n");
};

export const DealActivityLog = ({ dealId, scrollHeight = "h-72", hideHeader = false }: DealActivityLogProps) => {
  const { entries, loading, error } = useDealActivityLog(dealId);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const actorIds = useMemo(
    () => Array.from(new Set(entries.map((e) => e.actor_id).filter(Boolean))) as string[],
    [entries]
  );
  const { displayNames } = useUserDisplayNames(actorIds);

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return entries;
    const q = debouncedQuery.toLowerCase();
    return entries.filter((e) =>
      [
        e.event_type,
        e.field_name ?? "",
        formatValueShort(e.old_value),
        formatValueShort(e.new_value),
        e.actor_id ? displayNames[e.actor_id] ?? "" : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [entries, debouncedQuery, displayNames]);

  if (!dealId) return null;

  const handleExport = () => {
    const csv = toCsv(filtered, displayNames);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deal-activity-${dealId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-base font-semibold">
            <History className="w-4 h-4" />
            Logs
            <Badge variant="secondary" className="ml-1">{entries.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64 max-w-full">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search activity…"
                aria-label="Search logs"
                className="pl-7 h-8 text-sm"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={filtered.length === 0}
              aria-label="Export logs as CSV"
              className="h-8"
            >
              <Download className="w-3.5 h-3.5 mr-1" /> Export
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && entries.length === 0 && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      )}
      {!loading && entries.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      )}
      {!loading && entries.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No entries match your search.</p>
      )}
      {filtered.length > 0 && (
        <ScrollArea className={`${scrollHeight} pr-3`}>
          <div className="space-y-4">
            {(() => {
              const groups: { day: string; items: DealActivityEntry[] }[] = [];
              for (const e of filtered) {
                const key = dayKey(e.created_at);
                const last = groups[groups.length - 1];
                if (last && last.day === key) last.items.push(e);
                else groups.push({ day: key, items: [e] });
              }
              return groups.map((g) => (
                <div key={g.day}>
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1 mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {formatDayHeader(g.items[0].created_at)}
                    </div>
                  </div>
                  <ul className="divide-y divide-border rounded-md border border-border bg-card">
                    {g.items.map((e) => {
                      const resolvedName = e.actor_id ? displayNames[e.actor_id] : null;
                      const meta = eventMeta(e);
                      const Icon = meta.Icon;
                      const isExpanded = !!expanded[e.id];
                      const oldShort = formatValueShort(e.old_value);
                      const newShort = formatValueShort(e.new_value);
                      const canExpand =
                        e.event_type === "field_change" &&
                        (formatValueFull(e.old_value).length > 120 ||
                          formatValueFull(e.new_value).length > 120);
                      return (
                        <li key={e.id} className="p-3 hover:bg-muted/40 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className={`shrink-0 rounded-full p-1.5 ${meta.tone}`}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                <div className="text-sm font-medium truncate">
                                  {e.event_type === "field_change" ? (
                                    <>
                                      <span className="text-muted-foreground font-normal">Updated </span>
                                      {meta.label}
                                    </>
                                  ) : (
                                    meta.label
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground shrink-0 tabular-nums">
                                  {formatTime(e.created_at)}
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                by{" "}
                                <span className="text-foreground/80 font-medium">
                                  {e.actor_id ? (
                                    resolvedName ?? (
                                      <Skeleton className="inline-block h-3 w-16 align-middle" />
                                    )
                                  ) : (
                                    "System"
                                  )}
                                </span>
                              </div>
                              {(e.event_type === "field_change" || e.event_type === "stage_change") && (
                                <div className="mt-2">
                                  {isExpanded ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <div>
                                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">From</div>
                                        <pre className="bg-muted/60 p-2 rounded text-[11px] whitespace-pre-wrap break-words">
                                          {formatValueFull(e.old_value)}
                                        </pre>
                                      </div>
                                      <div>
                                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">To</div>
                                        <pre className="bg-primary/5 p-2 rounded text-[11px] whitespace-pre-wrap break-words">
                                          {formatValueFull(e.new_value)}
                                        </pre>
                                      </div>
                                    </div>
                                  ) : e.event_type === "stage_change" ? (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <Badge variant="outline">{oldShort}</Badge>
                                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                      <Badge>{newShort}</Badge>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 flex-wrap text-xs">
                                      <span className="px-2 py-0.5 rounded bg-muted/60 text-muted-foreground line-through max-w-[40ch] truncate">
                                        {oldShort}
                                      </span>
                                      <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                      <span className="px-2 py-0.5 rounded bg-primary/10 text-foreground font-medium max-w-[40ch] truncate">
                                        {newShort}
                                      </span>
                                    </div>
                                  )}
                                  {canExpand && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpanded((m) => ({ ...m, [e.id]: !isExpanded }))
                                      }
                                      className="mt-1 text-xs text-primary inline-flex items-center gap-0.5 hover:underline"
                                      aria-label={isExpanded ? "Collapse details" : "Expand details"}
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="w-3 h-3" />
                                      ) : (
                                        <ChevronRight className="w-3 h-3" />
                                      )}
                                      {isExpanded ? "Show less" : "Show full values"}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ));
            })()}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
