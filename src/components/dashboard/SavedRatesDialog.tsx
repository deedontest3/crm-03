import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppLoader } from "@/components/ui/loader";
import { AlertCircle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface RateRow {
  base: string;
  quote: string;
  rate: number;
  fetched_at: string;
}

const fmtRate = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—");

const SavedRatesDialog = ({ open, onOpenChange }: Props) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ["currency-rates-all"],
    enabled: open,
    queryFn: async (): Promise<RateRow[]> => {
      const { data, error } = await (supabase as any)
        .from("currency_rates")
        .select("base, quote, rate, fetched_at")
        .order("base", { ascending: true })
        .order("quote", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RateRow[];
    },
  });

  // USD-base rows from DB
  const usdRows = useMemo(
    () => (data ?? []).filter((r) => r.base === "USD"),
    [data],
  );

  const currencies = useMemo(() => {
    const set = new Set<string>(["USD"]);
    usdRows.forEach((r) => set.add(r.quote));
    return Array.from(set).sort();
  }, [usdRows]);

  // rates[c] = units of c per 1 USD
  const usdRates = useMemo(() => {
    const m: Record<string, { rate: number; fetched_at: string }> = {
      USD: { rate: 1, fetched_at: new Date().toISOString() },
    };
    usdRows.forEach((r) => {
      m[r.quote] = { rate: Number(r.rate), fetched_at: r.fetched_at };
    });
    return m;
  }, [usdRows]);

  // Build all directional pairs (from → to) via USD pivot
  const allPairs = useMemo<RateRow[]>(() => {
    const out: RateRow[] = [];
    for (const from of currencies) {
      for (const to of currencies) {
        if (from === to) continue;
        const rf = usdRates[from]?.rate;
        const rt = usdRates[to]?.rate;
        if (!rf || !rt) continue;
        // 1 `from` = (1/rf) USD = (rt/rf) `to`
        const rate = rt / rf;
        const fa = usdRates[from]?.fetched_at ?? "";
        const ta = usdRates[to]?.fetched_at ?? "";
        out.push({ base: from, quote: to, rate, fetched_at: fa > ta ? fa : ta });
      }
    }
    return out;
  }, [currencies, usdRates]);

  const grouped = useMemo(() => {
    const map = new Map<string, RateRow[]>();
    for (const row of allPairs) {
      const list = map.get(row.base) ?? [];
      list.push(row);
      map.set(row.base, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allPairs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Saved conversions</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <AppLoader variant="panel" label="Loading rates…" />
        ) : error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>Failed to load saved rates.</span>
          </div>
        ) : allPairs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No saved rates.
          </p>
        ) : (
          <div className="space-y-6 overflow-x-auto">
            {grouped.map(([base, rows]) => (
              <section key={base}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  From {base}
                </h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
                      <th className="py-2 pr-3 font-medium">Pair</th>
                      <th className="py-2 font-medium text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.base}-${r.quote}`} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">
                          1 {r.base} → {r.quote}
                        </td>
                        <td className="py-2 tabular-nums text-right">
                          {fmtRate(Number(r.rate))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SavedRatesDialog;
