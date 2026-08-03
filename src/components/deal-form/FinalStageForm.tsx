import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StageProbabilityBadge } from "./StageProbabilityBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Deal, DealStage, getStageLabel } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { DealDocumentsSection } from "./DealDocumentsSection";
import { useEffect, useMemo, useState } from "react";
import {
  useDealRevenueSchedule,
  useDebouncedCallback,
  useScheduleCells,
} from "@/hooks/useDealRevenueSchedule";
import { useDealOfferedSchedule } from "@/hooks/useDealOfferedSchedule";
import { compareSchedules } from "@/lib/scheduleCompare";

import {
  AlertCircle,
  CalendarRange,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Lock,
  GitCompare,
  X,
} from "lucide-react";
import {
  getRevenueWindow,
  isQuarterAllowed,
  reconcileTCV,
  getOrphanedCells,
  formatMoney,
  quarterLabel,
  type Currency,
} from "@/lib/revenueSchedule";
import { formatCalendarQuarter } from "@/lib/fiscalYear";
import { recomputeDateErrors } from "@/lib/dealDateValidation";
import { formatDealDate } from "@/lib/dealDate";

interface FinalStageFormProps {
  formData: Partial<Deal> & { id?: string };
  onFieldChange: (field: string, value: any) => void;
  fieldErrors: Record<string, string>;
  stage: DealStage;
  isCurrent?: boolean;
}

const QUARTERS: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

export const FinalStageForm = ({ formData, onFieldChange, fieldErrors, stage, isCurrent = true }: FinalStageFormProps) => {
  const dealId = formData.id;
  const currency: Currency = (formData.currency_type as Currency) || 'EUR';
  const fmt = (n: number) => formatMoney(n, currency);

  const { rows, upsertCell, deleteMany } = useDealRevenueSchedule(dealId);
  const { get, set, total, totalByYear, yearsWithData } = useScheduleCells(rows);
  const { rows: offeredRows } = useDealOfferedSchedule(dealId);

  // Won vs Offered variance (only meaningful on Won stage)
  const variance = useMemo(() => {
    if (stage !== 'Won') return null;
    const wonCells = Array.from(yearsWithData).flatMap((y) =>
      ([1,2,3,4] as const).map((q) => ({ year: y, quarter: q, revenue: get(y, q) }))
    );
    return compareSchedules(offeredRows as any, wonCells as any);
  }, [stage, offeredRows, yearsWithData, get]);

  // Per-deal dismissal of the Won-vs-Offered variance warning. Stored with
  // a signature hash so a *new* mismatch re-surfaces the callout.
  const varianceSignature = useMemo(() => {
    if (!variance?.hasDifference) return '';
    const parts = variance.perQuarterDiffs
      .map((d) => `${d.year}Q${d.quarter}:${d.delta}`)
      .join('|');
    return `${variance.totalDelta}#${parts}`;
  }, [variance]);

  const dismissKey = dealId ? `finlytic:variance-dismissed:${dealId}` : '';
  const [dismissedSig, setDismissedSig] = useState<string>(() => {
    if (typeof globalThis === 'undefined' || !dismissKey) return '';
    try { return globalThis.localStorage?.getItem(dismissKey) || ''; } catch { return ''; }
  });
  useEffect(() => {
    if (typeof globalThis === 'undefined' || !dismissKey) return;
    try { setDismissedSig(globalThis.localStorage?.getItem(dismissKey) || ''); } catch { /* ignore */ }
  }, [dismissKey]);
  const varianceDismissed =
    !!varianceSignature && dismissedSig === varianceSignature;
  const dismissVariance = () => {
    if (!dismissKey || !varianceSignature) return;
    try { globalThis.localStorage?.setItem(dismissKey, varianceSignature); } catch { /* ignore */ }
    setDismissedSig(varianceSignature);
  };

  // Won-vs-Offered variance is shown inline in the amber callout below;
  // no toast on mount to avoid duplicate noise when entering the Won view.

  const debouncedUpsert = useDebouncedCallback((year: number, quarter: 1|2|3|4, revenue: number) => {
    if (!dealId) return;
    upsertCell({ year, quarter, revenue }).catch(console.error);
  }, 450);

  // Revenue window anchored on implementation_start_date
  const window = useMemo(() => getRevenueWindow(formData), [
    formData.implementation_start_date,
    formData.signed_contract_date,
    formData.end_date,
    formData.project_duration,
  ]);

  // Years to render = years in window ∪ years with existing data
  const years = useMemo(() => {
    const fromWindow = window.years;
    const union = Array.from(new Set([...fromWindow, ...yearsWithData])).sort();
    if (union.length === 0) union.push(new Date().getFullYear());
    return union;
  }, [window.years, yearsWithData]);

  // Mirror schedule total into deals.total_revenue
  useEffect(() => {
    if (stage === 'Won' && total !== (Number(formData.total_revenue) || 0)) {
      onFieldChange('total_revenue', total);
    }
  }, [total, stage, formData.total_revenue, onFieldChange]);

  const wonShowPoNumber =
    formData.po_status && formData.po_status !== 'Not Required';
  const baseFieldsByStage: Record<string, string[]> = {
    Won: [
      'signed_contract_date',
      'implementation_start_date',
      'end_date',
      'project_duration',
      'handoff_status',
      'po_status',
      ...(wonShowPoNumber ? ['po_number'] : []),
      'won_reason',
    ],
    Lost: ['lost_reason'],
    Dropped: ['drop_reason'],
  };
  const fields = baseFieldsByStage[stage] || [];

  // Reconciliation against TCV
  const recon = reconcileTCV(total, formData.total_contract_value);

  // Orphan cells (revenue outside window)
  const orphanCells = useMemo(() => {
    if (!window.start || !window.end) return [];
    const all: { year: number; quarter: 1|2|3|4; revenue: number }[] = [];
    for (const y of yearsWithData) {
      for (const q of QUARTERS) {
        const v = get(y, q);
        if (v > 0) all.push({ year: y, quarter: q, revenue: v });
      }
    }
    return getOrphanedCells(all, window);
  }, [get, yearsWithData, window]);

  const orphanKeys = useMemo(
    () => new Set(orphanCells.map((c) => `${c.year}-${c.quarter}`)),
    [orphanCells]
  );

  const handleClearOrphans = async () => {
    if (orphanCells.length === 0 || !dealId) return;
    // Optimistic UI
    orphanCells.forEach((c) => set(c.year, c.quarter, 0));
    try {
      await deleteMany(orphanCells.map((c) => ({ year: c.year, quarter: c.quarter })));
    } catch (e) {
      console.error('Failed to clear orphan cells', e);
    }
  };

  // Live per-field date-order errors (recomputed every render from form state)
  const liveDateErrors = useMemo(() => recomputeDateErrors(formData), [
    formData.signed_contract_date,
    formData.implementation_start_date,
    formData.start_date,
    formData.end_date,
  ]);

  // Human-readable contract window explanation for the orphan callout
  const windowAnchorStart = formData.implementation_start_date || formData.signed_contract_date || null;
  const windowAnchorEnd = formData.end_date || null;
  const windowAnchorStartLabel = formData.implementation_start_date
    ? 'Project Start Date'
    : formData.signed_contract_date
      ? 'Signed Contract Date'
      : null;



  const spanWarning = window.years.length > 8;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">{getStageLabel(stage)} Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage={stage} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {fields.map(field => (
            <FormFieldRenderer
              key={field}
              field={field}
              value={formData[field as keyof Deal]}
              onChange={onFieldChange}
              error={fieldErrors[field] ?? liveDateErrors[field]}

            />
          ))}
        </div>


        {stage === 'Won' && (
          <div className="pt-2 border-t border-border">
            <DealDocumentsSection
              dealId={dealId}
              requireSignedContract
              showSignedContractSlot
              showPoSlot={!!wonShowPoNumber}
            />
          </div>
        )}



        {stage === 'Won' && (
          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold">Revenue Schedule</h3>
            </div>





            {!dealId && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>Save the deal first to enter quarterly revenue per year.</span>
              </div>
            )}

            {dealId && !window.start && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>
                  Set <strong>Implementation Start Date</strong> (and <strong>End Date</strong> or{' '}
                  <strong>Project Duration</strong>) to generate the revenue schedule.
                </span>
              </div>
            )}

            {dealId && recon.state !== 'no-tcv' && (
              <div
                className={
                  recon.state === 'match'
                    ? 'flex items-center gap-2 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs'
                    : recon.state === 'over'
                    ? 'flex items-center gap-2 px-2 py-1 rounded-md bg-destructive/10 border border-destructive/30 text-xs'
                    : 'flex items-center gap-2 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs'
                }
              >
                {recon.state === 'match' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : recon.state === 'over' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-destructive shrink-0" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                )}
                <span className="flex-1 font-medium">
                  {recon.state === 'match' && 'Schedule matches TCV'}
                  {recon.state === 'over' && `Over TCV by ${fmt(recon.deltaAbs)} (${recon.deltaPct.toFixed(1)}%)`}
                  {recon.state === 'under' && `${fmt(recon.deltaAbs)} remaining (${recon.deltaPct.toFixed(1)}%)`}
                </span>
                <span className="text-muted-foreground">
                  TCV {fmt(recon.tcv)} · Scheduled {fmt(recon.sum)}
                </span>
              </div>
            )}

            {dealId && stage === 'Won' && variance?.hasDifference && offeredRows.length > 0 && !varianceDismissed && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm">
                <GitCompare className="w-4 h-4 mt-0.5 text-amber-500" />
                <div className="flex-1">
                  <div className="font-medium">
                    Won revenue differs from the Offered forecast (Δ {fmt(Math.abs(variance.totalDelta))} across {variance.perQuarterDiffs.length} quarter{variance.perQuarterDiffs.length > 1 ? 's' : ''}).
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <div>Offered Σ: {fmt(variance.totalOffered)} · Won Σ: {fmt(variance.totalWon)}</div>
                    {variance.perQuarterDiffs.slice(0, 6).map((d) => (
                      <div key={`${d.year}-${d.quarter}`}>
                        {formatCalendarQuarter(d.year, d.quarter)}: forecast {fmt(d.offered)} → won {fmt(d.won)} ({d.delta >= 0 ? '+' : ''}{fmt(d.delta)})
                      </div>
                    ))}
                    {variance.perQuarterDiffs.length > 6 && (
                      <div>… and {variance.perQuarterDiffs.length - 6} more</div>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 -mt-0.5 -mr-1 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                  onClick={dismissVariance}
                  aria-label="Dismiss variance warning"
                  title="Dismiss — won't show again unless the mismatch changes"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            {dealId && orphanCells.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="font-medium">
                    {orphanCells.length} quarter{orphanCells.length > 1 ? 's have' : ' has'} revenue outside the contract window
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Highlighted below:{' '}
                    {orphanCells.map((c) => `${formatCalendarQuarter(c.year, c.quarter)} (${fmt(c.revenue)})`).join(', ')}
                  </div>
                  {window.start && window.end && (
                    <div className="text-xs text-muted-foreground pt-1">
                      <span className="font-medium text-foreground">Why:</span>{' '}
                      contract window is{' '}
                      <span className="font-medium text-foreground">
                        {formatCalendarQuarter(window.start.year, window.start.quarter)} – {formatCalendarQuarter(window.end.year, window.end.quarter)}
                      </span>
                      {windowAnchorStart && windowAnchorEnd && windowAnchorStartLabel && (
                        <> (derived from <span className="font-medium text-foreground">{windowAnchorStartLabel}</span> {formatDealDate(windowAnchorStart)} → <span className="font-medium text-foreground">Project End Date</span> {formatDealDate(windowAnchorEnd)})</>
                      )}
                      . Revenue in quarters outside this range won't roll into TCV reporting.
                    </div>
                  )}
                </div>
                <Button type="button" size="sm" variant="outline" onClick={handleClearOrphans}>Clear</Button>
              </div>
            )}

            {dealId && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {years.map((year) => {
                  const isYearInWindow = window.years.includes(year);
                  // Show: allowed quarters in-window, any quarter with a value, plus any orphan quarter
                  const visibleQuarters = QUARTERS.filter(
                    (q) =>
                      (isYearInWindow && isQuarterAllowed(year, q, window)) ||
                      get(year, q) > 0 ||
                      orphanKeys.has(`${year}-${q}`)
                  );
                  if (visibleQuarters.length === 0) return null;

                  return (
                    <div
                      key={year}
                      className={`rounded-lg border p-4 ${
                        isYearInWindow ? 'border-border bg-muted/20' : 'border-amber-500/40 bg-amber-500/5'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-base">Calendar {year}</span>
                          {!isYearInWindow && (
                            <span className="text-[10px] uppercase tracking-wider text-amber-500 border border-amber-500/40 rounded px-1.5 py-0.5">
                              outside contract
                            </span>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          Σ <span className="font-semibold text-foreground">{fmt(totalByYear(year))}</span>
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {visibleQuarters.map((q) => {
                          const v = get(year, q);
                          const isOrphan = orphanKeys.has(`${year}-${q}`);
                          return (
                            <div key={q} className="space-y-1">
                              <Label className={`text-xs flex items-center gap-1.5 ${isOrphan ? 'text-amber-600 dark:text-amber-500 font-medium' : 'text-muted-foreground'}`}>
                                {formatCalendarQuarter(year, q)}
                                {isOrphan && (
                                  <span className="text-[10px] uppercase tracking-wider border border-amber-500/50 rounded px-1 py-0.5">
                                    outside window
                                  </span>
                                )}
                              </Label>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={v === 0 ? '' : v}
                                placeholder="0"
                                aria-invalid={isOrphan || undefined}
                                title={isOrphan && window.start && window.end
                                  ? `This quarter is outside the contract window (${formatCalendarQuarter(window.start.year, window.start.quarter)} – ${formatCalendarQuarter(window.end.year, window.end.quarter)}).`
                                  : undefined}
                                className={isOrphan ? 'border-amber-500/70 bg-amber-500/10 focus-visible:ring-amber-500/40' : ''}
                                onChange={(e) => {
                                  const raw = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                  const next = isNaN(raw) ? 0 : Math.max(0, Math.min(9_999_999_999, raw));
                                  set(year, q, next);
                                  debouncedUpsert(year, q, next);
                                }}
                                onBlur={(e) => {
                                  const raw = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                  const next = isNaN(raw) ? 0 : Math.max(0, Math.min(9_999_999_999, raw));
                                  if (dealId) upsertCell({ year, quarter: q, revenue: next }).catch(console.error);
                                }}
                              />
                            </div>
                          );
                        })}

                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {dealId && (
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="text-sm text-muted-foreground">Total Revenue (auto)</span>
                <span className="text-lg font-bold">{fmt(total)}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
