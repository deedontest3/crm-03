import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StageProbabilityBadge } from "./StageProbabilityBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Deal } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { DealDocumentsSection } from "./DealDocumentsSection";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useDebouncedCallback,
  useScheduleCells,
} from "@/hooks/useDealRevenueSchedule";
import { useDealOfferedSchedule } from "@/hooks/useDealOfferedSchedule";
import {
  AlertCircle,
  CalendarRange,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import {
  getOfferedRevenueWindow,
  isQuarterAllowed,
  getOrphanedCells,
  reconcileTCV,
  formatMoney,
  quarterLabel,
  type Currency,
} from "@/lib/revenueSchedule";
import { formatCalendarQuarter } from "@/lib/fiscalYear";

interface OfferedStageFormProps {
  formData: Partial<Deal> & { id?: string };
  onFieldChange: (field: string, value: any) => void;
  fieldErrors: Record<string, string>;
  isCurrent?: boolean;
}

const QUARTERS: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

export const OfferedStageForm = ({ formData, onFieldChange, fieldErrors, isCurrent = true }: OfferedStageFormProps) => {
  const row1Fields = ['current_status', 'proposal_version', 'proposal_sent_date', 'next_follow_up_date'];

  const dealId = formData.id;
  const currency: Currency = (formData.currency_type as Currency) || 'EUR';
  const fmt = (n: number) => formatMoney(n, currency);

  const { rows, upsertCell, deleteMany } = useDealOfferedSchedule(dealId);
  const { get, set, total, totalByYear, yearsWithData } = useScheduleCells(rows as any);

  const debouncedUpsert = useDebouncedCallback((year: number, quarter: 1|2|3|4, revenue: number) => {
    if (!dealId) return;
    upsertCell({ year, quarter, revenue }).catch(console.error);
  }, 450);

  const window = useMemo(() => getOfferedRevenueWindow(formData), [
    formData.start_date,
    formData.end_date,
    formData.project_duration,
  ]);

  const years = useMemo(() => {
    const fromWindow = window.years;
    const union = Array.from(new Set([...fromWindow, ...yearsWithData])).sort();
    if (union.length === 0) union.push(new Date().getFullYear());
    return union;
  }, [window.years, yearsWithData]);

  const recon = reconcileTCV(total, formData.total_contract_value);

  // Detect forecast cells that fall outside the current RFQ window (e.g. after
  // dates change) and ask the user before deleting them. Previously these were
  // deleted silently, so a transient/incorrect date edit permanently wiped a
  // filled-in forecast with no confirmation. Orphaned cells stay visible with
  // an "outside RFQ window" badge until the user decides.
  type OrphanCell = { year: number; quarter: 1|2|3|4 };
  const [orphanConfirm, setOrphanConfirm] = useState<OrphanCell[] | null>(null);
  const clearingRef = useRef(false);
  // Signature of an orphan set the user chose to keep, so we don't re-prompt
  // for the same set on every render.
  const dismissedSigRef = useRef<string | null>(null);

  const orphanSignature = (cells: OrphanCell[]) =>
    cells.map((c) => `${c.year}-${c.quarter}`).sort().join(',');

  useEffect(() => {
    if (!dealId || !window.start || clearingRef.current || orphanConfirm) return;
    const all: { year: number; quarter: 1|2|3|4; revenue: number }[] = [];
    for (const y of yearsWithData) {
      for (const q of QUARTERS) {
        const v = get(y, q);
        if (v > 0) all.push({ year: y, quarter: q, revenue: v });
      }
    }
    const orphans = getOrphanedCells(all, window).map((c) => ({ year: c.year, quarter: c.quarter as 1|2|3|4 }));
    if (orphans.length === 0) {
      dismissedSigRef.current = null;
      return;
    }
    // Don't re-prompt for a set the user already chose to keep.
    if (dismissedSigRef.current === orphanSignature(orphans)) return;
    setOrphanConfirm(orphans);
  }, [dealId, window, yearsWithData, get, set, orphanConfirm]);

  const confirmClearOrphans = () => {
    if (!orphanConfirm) return;
    const orphans = orphanConfirm;
    clearingRef.current = true;
    orphans.forEach((c) => set(c.year, c.quarter, 0));
    setOrphanConfirm(null);
    deleteMany(orphans.map((c) => ({ year: c.year, quarter: c.quarter })))
      .catch((e) => console.error('Failed to clear orphan cells', e))
      .finally(() => { clearingRef.current = false; });
  };

  const keepOrphans = () => {
    if (orphanConfirm) dismissedSigRef.current = orphanSignature(orphanConfirm);
    setOrphanConfirm(null);
  };


  const dateErrors: string[] = [];
  if (formData.start_date && formData.end_date &&
    new Date(formData.start_date) > new Date(formData.end_date)) {
    dateErrors.push("RFQ End Date must be on or after Start Date.");
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">Offered Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage="Offered" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {row1Fields.map(field => (
            <FormFieldRenderer
              key={field}
              field={field}
              value={formData[field as keyof Deal]}
              onChange={onFieldChange}
              error={fieldErrors[field]}
            />
          ))}
        </div>


        <div className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold">Revenue Schedule (Forecast)</h3>
            </div>
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
                <span className="font-medium">
                  {recon.state === 'match' && 'Forecast matches TCV'}
                  {recon.state === 'over' && `Over TCV by ${fmt(recon.deltaAbs)} (${recon.deltaPct.toFixed(1)}%)`}
                  {recon.state === 'under' && `${fmt(recon.deltaAbs)} remaining (${recon.deltaPct.toFixed(1)}%)`}
                </span>
                <span className="text-muted-foreground">
                  TCV {fmt(recon.tcv)} · Forecast {fmt(recon.sum)}
                </span>
              </div>
            )}
          </div>

          {dealId && Number(formData.total_contract_value) > 0 && total === 0 && window.start && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/40 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 text-destructive" />
              <span className="text-destructive">
                Forecast required — enter at least one non-zero quarterly forecast before saving Offered.
              </span>
            </div>
          )}

          {dateErrors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 text-destructive" />
              <span className="text-destructive">{err}</span>
            </div>
          ))}


          {!dealId && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <span>Save the deal first to enter the quarterly forecast.</span>
            </div>
          )}

          {dealId && !window.start && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border border-border text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <span>
                Set <strong>Start Date</strong> and <strong>End Date</strong> on the RFQ stage to generate the forecast schedule.
              </span>
            </div>
          )}



          {dealId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {years.map((year) => {
                const isYearInWindow = window.years.includes(year);
                const visibleQuarters = isYearInWindow
                  ? QUARTERS.filter((q) => isQuarterAllowed(year, q, window))
                  : QUARTERS.filter((q) => get(year, q) > 0);
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
                            outside RFQ window
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
                        return (
                          <div key={q} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              {formatCalendarQuarter(year, q)}
                            </Label>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={v === 0 ? '' : v}
                              placeholder="0"
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
              <span className="text-sm text-muted-foreground">Total Forecast Revenue (auto)</span>
              <span className="text-lg font-bold">{fmt(total)}</span>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-border">
          <DealDocumentsSection dealId={dealId} showProposalSlot />
        </div>
      </CardContent>

      <AlertDialog open={!!orphanConfirm} onOpenChange={(o) => { if (!o) keepOrphans(); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove out-of-window forecast?</AlertDialogTitle>
            <AlertDialogDescription>
              {orphanConfirm?.length === 1
                ? '1 quarterly forecast entry now falls outside the current RFQ date window.'
                : `${orphanConfirm?.length ?? 0} quarterly forecast entries now fall outside the current RFQ date window.`}
              {' '}Removing them permanently deletes those saved revenue figures. Keep them if the date change was temporary or you still need those values.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={keepOrphans}>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={confirmClearOrphans}>Remove forecast</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
