import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { useUserRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AppLoader } from "@/components/ui/loader";

interface Props {
  /** Year of the fixed rate currently stored (from rates' fetched_at). */
  storedYear: number | null;
  onUpdated: () => void;
  /** Existing rates so dialog can pre-fill. */
  currentRates?: Record<string, number>;
}

const fmt4 = (n: number) => (Number.isFinite(n) && n > 0 ? Number(n.toFixed(4)).toString() : "");

/**
 * Shown on/after Jan 1 of a new calendar year when the pinned currency rate
 * still belongs to the previous year. Lets an admin enter the new fixed rates
 * for USD↔EUR and USD↔INR.
 */
const FixedRateBanner = ({ storedYear, onUpdated, currentRates }: Props) => {
  const { isAdminOrAbove } = useUserRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();


  const needsUpdate = storedYear !== null && currentYear > storedYear;

  const [open, setOpen] = useState(false);
  const [usdToEur, setUsdToEur] = useState(() => fmt4(currentRates?.EUR ?? NaN));
  const [eurToUsd, setEurToUsd] = useState(() => {
    const e = currentRates?.EUR;
    return e ? fmt4(1 / e) : "";
  });
  // Pinned cross-rate: 1 EUR = X INR. USD->INR is derived as eurRate * eurToInr
  // so the invariant holds whenever an admin edits either the EUR or INR field.
  const [eurToInr, setEurToInr] = useState(() => {
    const e = currentRates?.EUR;
    const i = currentRates?.INR;
    return e && i ? fmt4(i / e) : "105";
  });
  const [saving, setSaving] = useState(false);

  if (!needsUpdate) return null;

  const onUsdEurChange = (v: string) => {
    setUsdToEur(v);
    const n = parseFloat(v);
    setEurToUsd(Number.isFinite(n) && n > 0 ? (1 / n).toFixed(4) : "");
  };

  const onEurUsdChange = (v: string) => {
    setEurToUsd(v);
    const n = parseFloat(v);
    setUsdToEur(Number.isFinite(n) && n > 0 ? (1 / n).toFixed(4) : "");
  };

  const handleSave = async () => {
    const eurRate = parseFloat(usdToEur);
    const eurInr = parseFloat(eurToInr);
    if (!Number.isFinite(eurRate) || eurRate <= 0) {
      toast({ title: "Enter a valid USD→EUR rate", variant: "destructive" });
      return;
    }
    const inrRate = Number.isFinite(eurInr) && eurInr > 0 ? eurRate * eurInr : NaN;
    setSaving(true);
    try {
      const rows: Array<{ base: string; quote: string; rate: number; fetched_at: string; source: string }> = [
        { base: "USD", quote: "EUR", rate: eurRate, fetched_at: new Date().toISOString(), source: `fixed-rate-${currentYear}` },
      ];
      if (Number.isFinite(inrRate) && inrRate > 0) {
        rows.push({ base: "USD", quote: "INR", rate: inrRate, fetched_at: new Date().toISOString(), source: `fixed-rate-${currentYear}` });
      }
      const { error } = await (supabase as any).from("currency_rates").upsert(rows, { onConflict: "base,quote" });
      if (error) throw error;
      toast({ title: "Rates updated", description: `1 USD = ${eurRate.toFixed(4)} EUR${Number.isFinite(inrRate) && inrRate > 0 ? ` · 1 EUR = ${eurInr.toFixed(2)} INR` : ""}` });
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["currency-rates"] });
      onUpdated();

    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">It's {currentYear} — the fixed exchange rates are from {storedYear}.</p>
          <p className="text-xs opacity-90">
            {isAdminOrAbove
              ? "Set this year's USD↔EUR rate and the 1 EUR = X INR cross-rate to keep conversions accurate."
              : "Ask an admin to set this year's USD↔EUR and 1 EUR = X INR rates."}
          </p>
        </div>
      </div>

      {isAdminOrAbove && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 flex-shrink-0">Update rates</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set fixed rates for {currentYear}</DialogTitle>
              <DialogDescription>
                Enter this year's USD↔EUR rate and the 1 EUR = X INR cross-rate. Editing one EUR field auto-fills its inverse; USD→INR is derived automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <span className="w-24 text-sm text-muted-foreground">1 USD =</span>
                <Input type="number" inputMode="decimal" value={usdToEur} onChange={(e) => onUsdEurChange(e.target.value)} placeholder="0.8767" />
                <span className="text-sm text-muted-foreground">EUR</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-24 text-sm text-muted-foreground">1 EUR =</span>
                <Input type="number" inputMode="decimal" value={eurToUsd} onChange={(e) => onEurUsdChange(e.target.value)} placeholder="1.1406" />
                <span className="text-sm text-muted-foreground">USD</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-24 text-sm text-muted-foreground">1 EUR =</span>
                <Input type="number" inputMode="decimal" value={eurToInr} onChange={(e) => setEurToInr(e.target.value)} placeholder="105" />
                <span className="text-sm text-muted-foreground">INR</span>
              </div>
              <p className="text-xs text-muted-foreground">
                USD → INR is derived automatically ({(parseFloat(usdToEur) * parseFloat(eurToInr) || 0).toFixed(4)} INR per USD).
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <AppLoader variant="inline" className="mr-2" />}
                Save rates
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default FixedRateBanner;
