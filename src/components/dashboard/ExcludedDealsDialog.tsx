import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";
import type { ExcludedDeal, ExclusionReason } from "@/hooks/useYearlyRevenueData";

const REASON_LABEL: Record<ExclusionReason, string> = {
  missingDates: "Missing dates",
  missingAmount: "Missing amount",
};

export const FIELD_LABEL: Record<string, string> = {
  start_date: "Project start date",
  end_date: "Project end date",
  project_duration: "Project duration",
  proposal_sent_date: "Proposal sent date",
  expected_closing_date: "Expected close date",
  expected_signing_date: "Expected signing date",
  budget: "Budget amount",
  final_tcv: "Final TCV",
  total_revenue: "Total revenue",
  total_contract_value: "Total contract value",
};

type FilterKey = "all" | ExclusionReason;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deals: ExcludedDeal[];
}

const ExcludedDealsDialog = ({ open, onOpenChange, deals }: Props) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: deals.length,
      missingDates: 0,
      missingAmount: 0,
    };
    deals.forEach((d) => {
      c[d.reason] += 1;
    });
    return c;
  }, [deals]);

  // Reset filter when the dialog opens so each launch starts clean.
  useEffect(() => {
    if (open) setFilter("all");
  }, [open]);

  // Auto-recover if the active filter's count drops to 0 (e.g. after fixes).
  useEffect(() => {
    if (filter !== "all" && counts[filter] === 0) setFilter("all");
  }, [filter, counts]);

  const filtered = filter === "all" ? deals : deals.filter((d) => d.reason === filter);

  const goToDeal = (deal: ExcludedDeal) => {
    onOpenChange(false);
    const params = new URLSearchParams({ highlight: deal.id });
    if (deal.missingFields.length > 0) params.set("fix", deal.missingFields.join(","));
    navigate(`/deals?${params.toString()}`);
  };

  // Only render chips for reasons that actually have deals.
  const filters: FilterKey[] = (["all", "missingDates", "missingAmount"] as FilterKey[]).filter(
    (f) => f === "all" || counts[f] > 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            Deals excluded from the forecast
          </DialogTitle>
          <DialogDescription>
            These deals are missing required fields, so they aren't counted in the Pipeline
            forecast. Open a deal to fill in the highlighted fields.
          </DialogDescription>
        </DialogHeader>

        {deals.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <CheckCircle2 className="w-8 h-8 text-[hsl(var(--success))]" />
            <p className="text-sm font-medium">Nothing to fix</p>
            <p className="text-xs text-muted-foreground">
              Every pipeline deal has the fields it needs.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {filters.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}
                  className="h-7 text-xs"
                >
                  {f === "all" ? "All" : REASON_LABEL[f]} ({counts[f]})
                </Button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} deal{filtered.length === 1 ? "" : "s"}
            </p>

            <ScrollArea className="max-h-[52vh] pr-3 -mr-3">
              <ul className="flex flex-col gap-2">
                {filtered.map((deal) => (
                  <li key={deal.id}>
                    <button
                      type="button"
                      onClick={() => goToDeal(deal)}
                      aria-label={`Fix ${deal.name} — ${REASON_LABEL[deal.reason]}`}
                      className="group flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{deal.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {REASON_LABEL[deal.reason]}
                          </Badge>
                          {deal.missingFields.map((f) => (
                            <span
                              key={f}
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                            >
                              {FIELD_LABEL[f] ?? f}
                            </span>
                          ))}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ExcludedDealsDialog;
