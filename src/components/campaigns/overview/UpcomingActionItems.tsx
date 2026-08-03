import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { ListChecks, Plus, AlertCircle } from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";

interface Props {
  campaignId: string;
  onOpenActionItems: () => void;
}

const initials = (s?: string) =>
  (s || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function UpcomingActionItems({ campaignId, onOpenActionItems }: Props) {
  const { data: items = [] } = useQuery({
    queryKey: ["campaign-upcoming-action-items", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("action_items")
        .select("id, title, status, priority, due_date, assigned_to")
        .eq("module_type", "campaigns")
        .eq("module_id", campaignId)
        .neq("status", "Completed")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(8);
      if (error) throw error;
      return data || [];
    },
  });

  const pill = (due?: string | null) => {
    if (!due) return { cls: "bg-muted text-muted-foreground", label: "No date" };
    const d = parseISO(due);
    const diff = differenceInDays(d, new Date());
    if (diff < 0)
      return {
        cls: "bg-destructive/15 text-destructive",
        label: `${Math.abs(diff)}d overdue`,
      };
    if (diff === 0)
      return { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Today" };
    if (diff <= 3)
      return {
        cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        label: `${diff}d`,
      };
    return {
      cls: "bg-muted text-muted-foreground",
      label: format(d, "d MMM"),
    };
  };

  const priorityBar = (p?: string) => {
    const v = (p || "").toLowerCase();
    if (v === "high" || v === "urgent") return "bg-rose-500";
    if (v === "medium") return "bg-amber-500";
    if (v === "low") return "bg-slate-400";
    return "bg-slate-300";
  };

  const overdueCount = items.filter((t: any) => {
    if (!t.due_date) return false;
    return differenceInDays(parseISO(t.due_date), new Date()) < 0;
  }).length;

  return (
    <Card className="relative h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 via-rose-500 to-violet-500" />
      <CardContent className="p-3 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-5 w-5 rounded-md bg-amber-500/15 flex items-center justify-center">
            <ListChecks className="h-3 w-3 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Upcoming Action Items
          </h3>
          {items.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[9px] font-semibold tabular-nums">
              {items.length}
            </span>
          )}
          {overdueCount > 0 && (
            <span
              title={`${overdueCount} overdue`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive text-[9px] font-semibold"
            >
              <AlertCircle className="h-2.5 w-2.5" />
              {overdueCount}
            </span>
          )}
          <button
            onClick={onOpenActionItems}
            className="ml-auto text-[11px] text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Open
          </button>
        </div>
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-2">
              <ListChecks className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              No upcoming action items
            </p>
            <button
              onClick={onOpenActionItems}
              className="mt-2 text-[11px] text-primary hover:underline"
            >
              + Add one
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-1 flex-1 overflow-auto -mx-1 px-1">
            {items.map((t: any, idx: number) => {
              const p = pill(t.due_date);
              return (
                <li
                  key={t.id}
                  onClick={onOpenActionItems}
                  className={`relative flex items-center gap-2 text-[11px] hover:bg-muted/60 rounded-md pl-2.5 pr-1.5 py-1.5 cursor-pointer overflow-hidden ${
                    idx % 2 === 1 ? "bg-muted/20" : ""
                  }`}
                >
                  <span className={`absolute left-0 top-1 bottom-1 w-1 rounded-r ${priorityBar(t.priority)}`} />
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 tabular-nums ${p.cls}`}
                  >
                    {p.label}
                  </span>
                  <span className="truncate flex-1 font-medium">{t.title}</span>
                  {t.assigned_to && (
                    <span
                      title={t.assigned_to}
                      className="h-5 w-5 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20 flex items-center justify-center text-[8px] font-semibold text-primary shrink-0"
                    >
                      {initials(t.assigned_to)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
