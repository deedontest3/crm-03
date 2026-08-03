import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { TrendingUp, Target, Calendar, Edit2, Check, X, AlertCircle } from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { useYearlyRevenueData, useAvailableYears } from "@/hooks/useYearlyRevenueData";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fiscalLabel, fiscalQuarterMonths, currentFiscalYear } from "@/lib/fiscalYear";
import { useCurrencyRates, formatMoney, currencySymbol, convert } from "@/lib/currencyConvert";

import RevenueFilters, { type BU, type DisplayCurrency } from "@/components/dashboard/RevenueFilters";
import QuarterDrillDownDialog, { type DrillKind } from "@/components/dashboard/QuarterDrillDownDialog";
import FixedRateBanner from "@/components/dashboard/FixedRateBanner";
import SavedRatesDialog from "@/components/dashboard/SavedRatesDialog";
import KpiCard from "@/components/dashboard/KpiCard";

function TargetProgress({
  value,
  target,
  targetSet,
  barClass,
}: {
  value: number;
  target: number;
  targetSet: boolean;
  barClass: string;
}) {
  if (!targetSet || target <= 0) return null;
  const pct = Math.max(0, (value / target) * 100);
  const clamped = Math.min(100, pct);
  return (
    <div className="mt-auto pt-3">
      <div className="flex h-5 items-end justify-between text-xs font-semibold text-muted-foreground mb-1">
        <span>of target</span>
        <span className="tabular-nums text-foreground">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${barClass} transition-all duration-500`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
import AnimatedNumber from "@/components/dashboard/AnimatedNumber";
import MiniStackedBar from "@/components/dashboard/MiniStackedBar";
import ExcludedDealsDialog from "@/components/dashboard/ExcludedDealsDialog";
import { ChevronRight } from "lucide-react";

interface YearlyRevenueSummaryProps {
  selectedYear?: number;
  onYearChange?: (year: number) => void;
  bus?: BU[];
  onBusChange?: (b: BU[]) => void;
  displayCurrency?: DisplayCurrency;
  onCurrencyChange?: (c: DisplayCurrency) => void;
  hideHeader?: boolean;
  /** Data-driven year list from Dashboard. Falls back to the fixed range. */
  availableYears?: number[];
}

const quarterColors = [
  { border: "border-l-blue-500", text: "text-blue-500", dot: "bg-blue-500" },
  { border: "border-l-teal-500", text: "text-teal-500", dot: "bg-teal-500" },
  { border: "border-l-cyan-500", text: "text-cyan-500", dot: "bg-cyan-500" },
  { border: "border-l-purple-500", text: "text-purple-500", dot: "bg-purple-500" },
];

const DEFAULT_YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];

const YearlyRevenueSummary = ({
  selectedYear: externalYear,
  onYearChange,
  bus: externalBus,
  onBusChange,
  displayCurrency: externalCurrency,
  onCurrencyChange,
  hideHeader,
  availableYears: propYears,
}: YearlyRevenueSummaryProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isLoading: yearsLoading } = useAvailableYears();

  const availableYears = propYears && propYears.length > 0 ? propYears : DEFAULT_YEARS;
  const cfy = currentFiscalYear();
  const defaultYear = availableYears.includes(cfy) ? cfy : availableYears[0] ?? 2025;
  const [internalYear, setInternalYear] = useState(defaultYear);
  const [internalBus, setInternalBus] = useState<BU[]>([]);
  const [internalCurrency, setInternalCurrency] = useState<DisplayCurrency>("EUR");

  const selectedYear = externalYear ?? internalYear;
  const setSelectedYear = onYearChange ?? setInternalYear;
  const bus = externalBus ?? internalBus;
  const setBus = onBusChange ?? setInternalBus;
  const displayCurrency = externalCurrency ?? internalCurrency;
  const setDisplayCurrency = onCurrencyChange ?? setInternalCurrency;

  const { data: ratesSnap, isLoading: ratesLoading, refetch: refetchRates } = useCurrencyRates();
  const rates = ratesSnap?.rates;

  const { revenueData, isLoading: dataLoading, isFetching: dataFetching } = useYearlyRevenueData({
    selectedYear,
    bus,
    displayCurrency,
    rates,
  });

  const [editingTarget, setEditingTarget] = useState(false);
  const [savedRatesOpen, setSavedRatesOpen] = useState(false);
  // BU-scoped editor. When one BU is selected we edit that single BU. When
  // "All BUs" is active we expose one row per BU (EBU / RT / MBU) so admins
  // can set each target inline. Keyed by BU.
  type BuDraft = { total: string; q1: string; q2: string; q3: string; q4: string; currency: DisplayCurrency };
  const emptyDraft: BuDraft = { total: "", q1: "", q2: "", q3: "", q4: "", currency: "EUR" };
  const [buDrafts, setBuDrafts] = useState<Record<BU, BuDraft>>({
    EBU: { ...emptyDraft },
    RT: { ...emptyDraft },
    MBU: { ...emptyDraft },
  });
  const [excludedOpen, setExcludedOpen] = useState(false);

  const [drill, setDrill] = useState<{
    fq: 1 | 2 | 3 | 4 | "all";
    kind: DrillKind;
    expectedTotal?: number;
    weightMode?: "weighted" | "best";
    expectedTotals?: { actual?: number; committed?: number; pipeline?: number };
  } | null>(null);

  const fmt = (n: number) => formatMoney(n, displayCurrency);


  const allBus: BU[] = ["EBU", "RT", "MBU"];
  const editableBus: BU[] =
    bus.length === 0 || bus.length === allBus.length ? allBus : bus;

  const openTargetEditor = async () => {
    try {
      const { data, error } = await supabase
        .from("yearly_revenue_targets")
        .select("business_unit, total_target, q1_target, q2_target, q3_target, q4_target, currency")
        .eq("year", selectedYear);
      if (error) throw error;
      const next: Record<BU, BuDraft> = {
        EBU: { ...emptyDraft, currency: displayCurrency },
        RT: { ...emptyDraft, currency: displayCurrency },
        MBU: { ...emptyDraft, currency: displayCurrency },
      };
      (data || []).forEach((r: any) => {
        const b = r.business_unit as BU;
        if (!allBus.includes(b)) return;
        next[b] = {
          total: r.total_target != null ? String(r.total_target) : "",
          q1: r.q1_target != null ? String(r.q1_target) : "",
          q2: r.q2_target != null ? String(r.q2_target) : "",
          q3: r.q3_target != null ? String(r.q3_target) : "",
          q4: r.q4_target != null ? String(r.q4_target) : "",
          currency: (r.currency as DisplayCurrency) || displayCurrency,
        };
      });
      setBuDrafts(next);
      setEditingTarget(true);
    } catch (e: any) {
      console.error("Failed to load target editor:", e);
      toast({ title: "Error", description: e?.message || "Failed to load current targets", variant: "destructive" });
    }
  };

  const handleEvenSplit = (b: BU) => {
    const n = Number(buDrafts[b].total);
    if (!isFinite(n) || n <= 0) return;
    const per = (n / 4).toFixed(0);
    setBuDrafts((s) => ({ ...s, [b]: { ...s[b], q1: per, q2: per, q3: per, q4: per } }));
  };

  const handleSaveTarget = async () => {
    if (!user) return;
    const toNum = (s: string) => {
      if (!s.trim()) return null;
      const v = Number(s);
      return isFinite(v) && v >= 0 ? v : null;
    };
    try {
      const rows = editableBus
        .filter((b) => buDrafts[b].total.trim() !== "")
        .map((b) => ({
          year: selectedYear,
          business_unit: b,
          total_target: Number(buDrafts[b].total),
          q1_target: toNum(buDrafts[b].q1),
          q2_target: toNum(buDrafts[b].q2),
          q3_target: toNum(buDrafts[b].q3),
          q4_target: toNum(buDrafts[b].q4),
          currency: buDrafts[b].currency,
          created_by: user.id,
        }));
      if (rows.length === 0) {
        setEditingTarget(false);
        return;
      }
      const { error } = await supabase
        .from("yearly_revenue_targets")
        .upsert(rows as any, { onConflict: "year,business_unit" });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["yearly-revenue-fy"] });
      await queryClient.invalidateQueries({ queryKey: ["available-fiscal-years"] });
      toast({ title: "Success", description: "Target updated successfully" });
      setEditingTarget(false);
    } catch (e: any) {
      console.error("Failed to update target:", e);
      toast({ title: "Error", description: e?.message || "Failed to update target", variant: "destructive" });
    }
  };





  // Only show the full skeleton on the very first load. On filter changes we keep
  // the previous data visible (via placeholderData: keepPreviousData) so the page
  // doesn't unmount/remount and the filter bar stays interactive.
  if ((yearsLoading || ratesLoading || dataLoading) && !revenueData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  const availableCurrencies: DisplayCurrency[] = (["EUR", "USD", "INR"] as const).filter(
    (c) => !!rates?.[c],
  );

  const filters = (
    <RevenueFilters
      years={availableYears}
      selectedYear={selectedYear}
      onYearChange={setSelectedYear}
      bus={bus}
      onBusChange={setBus}
      currency={displayCurrency}
      onCurrencyChange={setDisplayCurrency}
      availableCurrencies={availableCurrencies}
    />
  );

  const eurPerUsd = rates?.EUR;
  const inrPerUsd = rates?.INR;
  const storedRateYear = ratesSnap?.fetchedAt ? new Date(ratesSnap.fetchedAt).getFullYear() : null;
  const fmtRate = (n: number) => n.toFixed(4);
  const ratesNote =
    displayCurrency === "USD" && eurPerUsd
      ? `Fixed rate · 1 EUR = ${fmtRate(1 / eurPerUsd)} USD`
      : displayCurrency === "EUR" && eurPerUsd
      ? `Fixed rate · 1 USD = ${fmtRate(eurPerUsd)} EUR`
      : displayCurrency === "INR" && inrPerUsd && eurPerUsd
      ? `Fixed rate · 1 EUR = ${fmtRate(inrPerUsd / eurPerUsd)} INR`
      : displayCurrency === "INR" && inrPerUsd
      ? `Fixed rate · 1 USD = ${fmtRate(inrPerUsd)} INR`
      : `Converted to ${displayCurrency}`;


  if (revenueData && !revenueData.hasDeals && (revenueData.excludedDealCount ?? 0) === 0) {
    return (
      <div className="space-y-6">
        {!hideHeader && (
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-foreground">Revenue Analytics</h2>
            <div className="flex items-center gap-4">
              <NotificationBell placement="down" size="small" />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">{ratesNote}</span>
          {filters}
        </div>
        <Card className="py-12">
          <CardContent className="text-center">
            <div className="flex flex-col items-center gap-4">
              <AlertCircle className="w-16 h-16 text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold">No deals found for {fiscalLabel(selectedYear)}</h3>
                <p className="text-muted-foreground">
                  Try a different year or BU filter to see revenue analytics.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalActual = revenueData?.totalActual || 0;
  const totalCommitted = revenueData?.totalCommitted || 0;
  const totalPipeline = revenueData?.totalPipeline || 0;
  const totalBestCase = revenueData?.totalBestCase || 0;
  const totalForecast = totalActual + totalCommitted + totalPipeline;
  const target = revenueData?.target || 0;
  const targetSet = target > 0;
  const targetCurrency = revenueData?.targetCurrency || displayCurrency;
  const ratesMap = rates ?? {};
  const toDisplay = (amt: number): number => {
    const v = convert(amt, targetCurrency, displayCurrency, ratesMap);
    return v ?? amt;
  };
  const targetInDisplay = targetSet ? toDisplay(target) : 0;
  const quarterTargetEvenSplit = targetSet ? targetInDisplay / 4 : 0;
  const qTargetsData = revenueData?.quarterTargets;
  const quarterTargetFor = (q: "q1"|"q2"|"q3"|"q4") =>
    qTargetsData?.[q] != null ? toDisplay(Number(qTargetsData[q])) : quarterTargetEvenSplit;


  return (
    <div className="space-y-6">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <div />
          <div className="flex items-center gap-4">
            <NotificationBell placement="down" size="small" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button
          type="button"
          onClick={() => setSavedRatesOpen(true)}
          title="View all saved conversions"
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-3 py-1 font-manrope text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {ratesNote}
        </button>

        {filters}
      </div>

      <SavedRatesDialog open={savedRatesOpen} onOpenChange={setSavedRatesOpen} />



      <FixedRateBanner storedYear={storedRateYear} onUpdated={async () => { await refetchRates(); await queryClient.invalidateQueries({ queryKey: ["currency-rates"] }); await queryClient.invalidateQueries({ queryKey: ["yearly-revenue-fy"] }); }} currentRates={rates} />



      {revenueData?.ratesUnusable && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">No FX rate for {displayCurrency}</p>
            <p className="text-xs opacity-90">
              All converted values are 0 until rates are refreshed. Click "Refresh rates" above or check the currency_rates table.
            </p>
          </div>
        </div>
      )}

      {revenueData?.hasUnconvertible && !revenueData?.ratesUnusable && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">
              {revenueData.unconvertibleDealCount} deal{revenueData.unconvertibleDealCount === 1 ? "" : "s"} excluded — missing FX rate for {revenueData.unconvertibleCurrencies.join(", ")}
            </p>
            <p className="text-xs opacity-90">
              Quarter totals are understated. Refresh rates or add the missing currencies in currency_rates.
            </p>
          </div>
        </div>
      )}

      {revenueData && revenueData.excludedDealCount > 0 && (
        <button
          type="button"
          onClick={() => setExcludedOpen(true)}
          aria-label="View deals excluded from the forecast and fix their missing fields"
          className="flex w-full items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm text-amber-700 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 dark:text-amber-300"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {revenueData.excludedDealCount} pipeline deal{revenueData.excludedDealCount === 1 ? "" : "s"} excluded from the forecast
            </p>
            <p className="text-xs opacity-90">
              {[
                revenueData.excludedReasons.missingDates > 0 && `${revenueData.excludedReasons.missingDates} missing stage date`,
                revenueData.excludedReasons.missingAmount > 0 && `${revenueData.excludedReasons.missingAmount} missing stage amount`,
              ].filter(Boolean).join(" · ")}
              . Click to review and fix them.
            </p>
          </div>
          <span className="flex flex-shrink-0 items-center gap-1 self-center text-xs font-medium">
            View deals <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>
      )}


      {/* Summary Cards */}
      {revenueData?.dataTruncated && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Some deals were not loaded</p>
            <p className="text-xs opacity-90">
              The forecast pulled the maximum row cap. Reported totals may understate the pipeline — narrow the filter or contact an admin.
            </p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard
          accent="indigo"
          label="Annual Target"
          icon={<Target className="w-4 h-4" />}
          index={0}
          onClick={!editingTarget && targetSet ? openTargetEditor : undefined}
          headerAction={
            !editingTarget ? (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openTargetEditor(); }}>
                <Edit2 className="w-3 h-3" />
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleSaveTarget(); }}><Check className="w-3 h-3" /></Button>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditingTarget(false); }}><X className="w-3 h-3" /></Button>
              </div>
            )
          }
        >
          {editingTarget ? (
            <div className="space-y-3 max-h-[420px] overflow-auto pr-1" onClick={(e) => e.stopPropagation()}>
              {editableBus.map((b) => (
                <div key={b} className="space-y-1.5 border-b border-border/60 pb-2 last:border-b-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {b}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={buDrafts[b].currency}
                      onChange={(e) =>
                        setBuDrafts((s) => ({
                          ...s,
                          [b]: { ...s[b], currency: e.target.value as DisplayCurrency },
                        }))
                      }
                      className="h-9 px-2 rounded-md border bg-background text-sm font-medium text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring w-[92px]"
                      aria-label={`${b} target currency`}
                    >
                      {(availableCurrencies.length ? availableCurrencies : (["EUR","USD","INR"] as DisplayCurrency[])).map((c) => (
                        <option key={c} value={c}>{currencySymbol(c)} {c}</option>
                      ))}
                    </select>
                    <Input
                      value={buDrafts[b].total}
                      onChange={(e) => setBuDrafts((s) => ({ ...s, [b]: { ...s[b], total: e.target.value } }))}
                      placeholder="Annual target"
                      type="number"
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(["q1","q2","q3","q4"] as const).map((q) => (
                      <Input
                        key={q}
                        value={buDrafts[b][q]}
                        onChange={(e) => setBuDrafts((s) => ({ ...s, [b]: { ...s[b], [q]: e.target.value } }))}
                        placeholder={q.toUpperCase()}
                        type="number"
                        className="text-xs"
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEvenSplit(b)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Split annual evenly across quarters
                  </button>
                </div>
              ))}
            </div>
          ) : targetSet ? (
            <div className="space-y-1">
              <AnimatedNumber value={targetInDisplay} format={fmt} className="text-[28px] font-semibold tabular-nums leading-none tracking-tight" />
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {bus.length === 0 || bus.length === allBus.length ? "All BUs · EBU + RT + MBU" : bus.join(" + ")}
              </div>
              {revenueData?.targetCurrencyMixed && (
                <div className="text-[10px] text-muted-foreground italic">
                  Converted to {displayCurrency} using current rates
                </div>
              )}
            </div>



          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openTargetEditor(); }}
              className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
            >
              + Set annual target
            </button>
          )}
        </KpiCard>

        <KpiCard
          accent="emerald"
          label="Actual"
          index={1}
          icon={<span className="w-4 h-4 font-bold inline-flex items-center justify-center text-sm">{currencySymbol(displayCurrency)}</span>}
          onClick={() => setDrill({ fq: "all", kind: "actual", expectedTotal: totalActual })}
        >
          <AnimatedNumber value={totalActual} format={fmt} className="block text-[28px] font-semibold tabular-nums leading-none tracking-tight" />
          <TargetProgress value={totalActual} target={targetInDisplay} targetSet={targetSet} barClass="bg-emerald-500" />
        </KpiCard>

        <KpiCard
          accent="blue"
          label="Commit"
          index={2}
          icon={<TrendingUp className="w-4 h-4" />}
          onClick={() => setDrill({ fq: "all", kind: "committed", expectedTotal: totalCommitted })}
        >
          <AnimatedNumber value={totalCommitted} format={fmt} className="block text-[28px] font-semibold tabular-nums leading-none tracking-tight" />
          <TargetProgress value={totalCommitted} target={targetInDisplay} targetSet={targetSet} barClass="bg-blue-500" />
        </KpiCard>

        <KpiCard
          accent="amber"
          label="Weighted Pipeline"
          index={3}
          icon={<TrendingUp className="w-4 h-4" />}
          onClick={() => setDrill({ fq: "all", kind: "pipeline", expectedTotal: totalPipeline, weightMode: "weighted" })}
        >
          <AnimatedNumber value={totalPipeline} format={fmt} className="block text-[28px] font-semibold tabular-nums leading-none tracking-tight" />
          <TargetProgress value={totalPipeline} target={targetInDisplay} targetSet={targetSet} barClass="bg-amber-500" />
        </KpiCard>

        <KpiCard
          accent="purple"
          label="Total Forecast"
          index={4}
          icon={<Calendar className="w-4 h-4" />}
          onClick={() =>
            setDrill({
              fq: "all",
              kind: "composed",
              expectedTotal: totalForecast,
              expectedTotals: { actual: totalActual, committed: totalCommitted, pipeline: totalPipeline },
            })
          }
        >
          <AnimatedNumber value={totalForecast} format={fmt} className="block text-[28px] font-semibold tabular-nums leading-none tracking-tight" />
          <TargetProgress value={totalForecast} target={targetInDisplay} targetSet={targetSet} barClass="bg-purple-500" />
        </KpiCard>
      </div>



      {/* Quarterly Breakdown */}
      <Card className="relative overflow-hidden border border-border/70">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/[0.06] to-transparent"
        />
        <CardHeader className="relative">
          <CardTitle className="flex items-center gap-2.5 font-sora text-base font-semibold tracking-tight">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/20">
              <TrendingUp className="w-4 h-4" />
            </span>
            Quarterly Breakdown
            <span className="font-manrope text-xs font-medium text-muted-foreground">· {fiscalLabel(selectedYear)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="relative">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(["q1", "q2", "q3", "q4"] as const).map((quarter, index) => {
              const colors = quarterColors[index];
              const fq = (index + 1) as 1 | 2 | 3 | 4;
              const actual = revenueData?.actualRevenue[quarter] || 0;
              const committed = revenueData?.committedRevenue[quarter] || 0;
              const pipeline = revenueData?.pipelineRevenue[quarter] || 0;
              const qTarget = quarterTargetFor(quarter);
              const forecast = actual + committed + pipeline;
              return (
                <div
                  key={quarter}
                  style={{ animationDelay: `${index * 70}ms` }}
                  className={`group relative overflow-hidden animate-rise-in border-l-4 ${colors.border} bg-card/95 border border-border/70 rounded-lg p-4 space-y-3 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md`}
                >
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className={`font-sora font-semibold text-lg leading-none tracking-tight ${colors.text}`}>Q{fq}</h4>
                      <p className="font-manrope text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">{fiscalQuarterMonths(fq)}</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <button
                      type="button"
                      className="w-full flex justify-between items-center hover:bg-emerald-50 dark:hover:bg-emerald-950/30 px-2 py-1.5 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => actual > 0 && setDrill({ fq, kind: "actual", expectedTotal: actual })}
                      disabled={actual <= 0}
                    >
                      <span className="font-manrope text-sm text-muted-foreground flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                        Actual
                      </span>
                      <AnimatedNumber value={actual} format={fmt} className="font-sora text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400" />
                    </button>
                    <button
                      type="button"
                      className="w-full flex justify-between items-center hover:bg-blue-50 dark:hover:bg-blue-950/30 px-2 py-1.5 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => committed > 0 && setDrill({ fq, kind: "committed", expectedTotal: committed })}
                      disabled={committed <= 0}
                    >
                      <span className="font-manrope text-sm text-muted-foreground flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                        Commit
                      </span>
                      <AnimatedNumber value={committed} format={fmt} className="font-sora text-base font-semibold tabular-nums text-blue-600 dark:text-blue-400" />
                    </button>
                    <button
                      type="button"
                      className="w-full flex justify-between items-center hover:bg-amber-50 dark:hover:bg-amber-950/30 px-2 py-1.5 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => pipeline > 0 && setDrill({ fq, kind: "pipeline", expectedTotal: pipeline })}
                      disabled={pipeline <= 0}
                      title="Pipeline weighted by deal probability (falls back to stage default). Slipped past-quarter deals roll into the current quarter."
                    >
                      <span className="font-manrope text-sm text-muted-foreground flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                        Pipeline (wtd)
                      </span>
                      <AnimatedNumber value={pipeline} format={fmt} className="font-sora text-base font-semibold tabular-nums text-amber-600 dark:text-amber-400" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/60 pt-2">
                    <span className="font-manrope text-xs uppercase tracking-wider text-muted-foreground">Forecast</span>
                    <AnimatedNumber value={forecast} format={fmt} className="font-sora text-base font-semibold tabular-nums text-foreground" />
                  </div>
                </div>
              );
            })}
          </div>

        </CardContent>
      </Card>

      {drill && rates && (
        <QuarterDrillDownDialog
          open={!!drill}
          onOpenChange={(o) => { if (!o) setDrill(null); }}
          fy={selectedYear}
          fq={drill.fq}
          kind={drill.kind}
          bus={bus}
          displayCurrency={displayCurrency}
          rates={rates}
          expectedTotal={drill.expectedTotal}
          weightMode={drill.weightMode}
          expectedTotals={drill.expectedTotals}
        />
      )}

      <ExcludedDealsDialog
        open={excludedOpen}
        onOpenChange={setExcludedOpen}
        deals={revenueData?.excludedDeals ?? []}
      />
    </div>

  );
};

export default YearlyRevenueSummary;
