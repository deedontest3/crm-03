import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Inbox,
  Mail,
  Phone,
  Linkedin,
  MessageSquare,
  Clock,
  ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getEmailThreads } from "../overviewMetrics";

type Filter = "all" | "email" | "call" | "linkedin" | "replied";

interface Item {
  key: string;
  type: "Email" | "Call" | "LinkedIn";
  contactName: string;
  accountName: string;
  subject: string;
  msgCount: number;
  status: "Replied" | "Sent" | "Opened" | "Failed" | "Logged";
  date: string | null;
  threadId?: string;
  contactId?: string | null;
}

interface Props {
  communications: any[];
  /** Channels enabled for the campaign — controls visible chips and item types. */
  enabledChannels?: Array<"Email" | "Phone" | "LinkedIn">;
  onOpenThread: (threadId: string) => void;
  onOpenAll: () => void;
  onOpenCall?: (contactId?: string | null) => void;
  onOpenLinkedIn?: (contactId?: string | null) => void;
}

const initial = (s?: string) =>
  (s || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

const statusClass = (s: Item["status"]) => {
  switch (s) {
    case "Replied":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20";
    case "Failed":
      return "bg-destructive/15 text-destructive ring-1 ring-destructive/20";
    case "Opened":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/20";
    case "Sent":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/20";
    default:
      return "bg-muted text-muted-foreground ring-1 ring-border";
  }
};

const channelTone = (t: Item["type"]) => {
  switch (t) {
    case "Email":
      return { icon: "text-blue-600 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900/40", avatar: "from-blue-200 to-blue-50 dark:from-blue-900/60 dark:to-blue-950/30 text-blue-700 dark:text-blue-200 ring-blue-500/20" };
    case "Call":
      return { icon: "text-emerald-600 dark:text-emerald-300", bg: "bg-emerald-100 dark:bg-emerald-900/40", avatar: "from-emerald-200 to-emerald-50 dark:from-emerald-900/60 dark:to-emerald-950/30 text-emerald-700 dark:text-emerald-200 ring-emerald-500/20" };
    case "LinkedIn":
      return { icon: "text-indigo-600 dark:text-indigo-300", bg: "bg-indigo-100 dark:bg-indigo-900/40", avatar: "from-indigo-200 to-indigo-50 dark:from-indigo-900/60 dark:to-indigo-950/30 text-indigo-700 dark:text-indigo-200 ring-indigo-500/20" };
    default:
      return { icon: "text-muted-foreground", bg: "bg-muted", avatar: "from-muted to-muted text-muted-foreground ring-border" };
  }
};

export function RecentActivityPanel({
  communications,
  enabledChannels,
  onOpenThread,
  onOpenAll,
  onOpenCall,
  onOpenLinkedIn,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  // Resolve channel visibility flags. Default to all-enabled for back-compat.
  const showEmail = !enabledChannels || enabledChannels.includes("Email");
  const showCall = !enabledChannels || enabledChannels.includes("Phone");
  const showLinkedIn = !enabledChannels || enabledChannels.includes("LinkedIn");

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    // Email threads — only when Email channel is enabled.
    if (showEmail) {
      const threads = getEmailThreads(communications);
      threads.forEach((t) => {
        const last = t.messages[t.messages.length - 1];
        const status: Item["status"] = t.hasReply
          ? "Replied"
          : t.hasFailed
          ? "Failed"
          : t.messages.some((m: any) => m.opened_at)
          ? "Opened"
          : "Sent";
        out.push({
          key: `email-${t.threadId}`,
          type: "Email",
          contactName: last?.contacts?.contact_name || "Unknown",
          accountName: last?.accounts?.account_name || "",
          subject: t.subject || "Email",
          msgCount: t.messages.length,
          status,
          date: t.lastDate,
          threadId: t.threadId,
          contactId: t.contactId,
        });
      });
    }
    // Calls + LinkedIn rows — drop entries whose channel is disabled.
    communications.forEach((c: any) => {
      if (c.communication_type === "Email") return;
      const type =
        c.communication_type === "Phone" ? "Call" : c.communication_type;
      if (type !== "Call" && type !== "LinkedIn") return;
      if (type === "Call" && !showCall) return;
      if (type === "LinkedIn" && !showLinkedIn) return;
      out.push({
        key: `${type}-${c.id}`,
        type: type as "Call" | "LinkedIn",
        contactName: c.contacts?.contact_name || "Unknown",
        accountName: c.accounts?.account_name || "",
        subject:
          c.subject ||
          c.notes ||
          c.call_outcome ||
          c.linkedin_status ||
          `${type} activity`,
        msgCount: 1,
        status: "Logged",
        date: c.communication_date,
        contactId: c.contact_id,
      });
    });
    return out
      .sort(
        (a, b) =>
          new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      )
      .slice(0, 50);
  }, [communications, showEmail, showCall, showLinkedIn]);

  // Reset filter if its channel becomes disabled.
  useEffect(() => {
    if (filter === "email" && !showEmail) setFilter("all");
    else if (filter === "call" && !showCall) setFilter("all");
    else if (filter === "linkedin" && !showLinkedIn) setFilter("all");
  }, [filter, showEmail, showCall, showLinkedIn]);

  const filtered = items.filter((i) => {
    if (filter === "all") return true;
    if (filter === "replied") return i.status === "Replied";
    if (filter === "email") return i.type === "Email";
    if (filter === "call") return i.type === "Call";
    if (filter === "linkedin") return i.type === "LinkedIn";
    return true;
  });

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: items.length },
    showEmail && {
      id: "email" as const,
      label: "Email",
      count: items.filter((i) => i.type === "Email").length,
    },
    showCall && {
      id: "call" as const,
      label: "Calls",
      count: items.filter((i) => i.type === "Call").length,
    },
    showLinkedIn && {
      id: "linkedin" as const,
      label: "LinkedIn",
      count: items.filter((i) => i.type === "LinkedIn").length,
    },
    {
      id: "replied" as const,
      label: "Replied",
      count: items.filter((i) => i.status === "Replied").length,
    },
  ].filter(Boolean) as { id: Filter; label: string; count: number }[];

  return (
    <Card className="relative flex flex-col h-full w-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500" />
      <CardContent className="p-3 flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-5 w-5 rounded-md bg-indigo-500/15 flex items-center justify-center">
            <Inbox className="h-3 w-3 text-indigo-600 dark:text-indigo-300" />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Recent Activity
          </h3>
          <button
            onClick={onOpenAll}
            className="ml-auto text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1"
          >
            View all <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                filter === c.id
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {c.label} <span className="opacity-70">{c.count}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-auto -mx-1 px-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No activity yet
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((i) => {
                const Icon =
                  i.type === "Email"
                    ? Mail
                    : i.type === "Call"
                    ? Phone
                    : i.type === "LinkedIn"
                    ? Linkedin
                    : MessageSquare;
                const tone = channelTone(i.type);
                const clickable =
                  (i.type === "Email" && !!i.threadId) ||
                  (i.type === "Call" && !!onOpenCall) ||
                  (i.type === "LinkedIn" && !!onOpenLinkedIn);
                const handleClick = () => {
                  if (i.type === "Email" && i.threadId) onOpenThread(i.threadId);
                  else if (i.type === "Call") onOpenCall?.(i.contactId);
                  else if (i.type === "LinkedIn") onOpenLinkedIn?.(i.contactId);
                };
                return (
                  <li
                    key={i.key}
                    onClick={handleClick}
                    className={`grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                      clickable
                        ? "cursor-pointer hover:bg-gradient-to-r hover:from-muted/70 hover:to-muted/20"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <div className={`h-6 w-6 rounded-full bg-gradient-to-br ${tone.avatar} ring-1 flex items-center justify-center text-[10px] font-semibold shrink-0`}>
                      {initial(i.contactName)}
                    </div>
                    <div className={`h-5 w-5 rounded-md ${tone.bg} flex items-center justify-center shrink-0`}>
                      <Icon className={`h-3 w-3 ${tone.icon}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {i.contactName}
                        {i.accountName && (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            · {i.accountName}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-muted-foreground">
                        {i.subject}
                        {i.msgCount > 1 && (
                          <span className="ml-1 inline-flex items-center px-1 rounded bg-muted text-[9px]">
                            {i.msgCount} msgs
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[9px] font-semibold ${statusClass(
                        i.status
                      )}`}
                    >
                      {i.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                      <Clock className="h-2.5 w-2.5" />
                      {i.date
                        ? formatDistanceToNow(new Date(i.date), {
                            addSuffix: false,
                          })
                        : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
