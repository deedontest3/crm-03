import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  calendarToFiscal,
  fiscalQuarterLabel,
  fiscalToCalendar,
  dateToFiscal,
  fiscalLabel,
} from "@/lib/fiscalYear";
import { convert, formatMoney, type Currency } from "@/lib/currencyConvert";
import { getStageLabel, STAGE_PROBABILITY, type DealStage } from "@/types/deal";
import {
  PIPELINE_REVENUE_STAGES,
  COMMIT_PIPELINE_STAGES,
  derivePipelineWindow,
  deriveWonWindow,
  windowCells,
  probabilityWeight,
} from "@/lib/revenueClassification";

export type AmountSource = "schedule" | "budget" | "final_tcv" | "total_revenue" | "total_contract_value";
export type WindowSource =
  | "schedule-row"
  | "implementation"
  | "offered"
  | "proposal+duration"
  | "expected_closing"
  | "signed_contract";
export type WeightSource = "deal.probability" | "stage-default" | "won-100" | "verbal-approval";
export type DrillKind = "actual" | "committed" | "pipeline" | "composed";

export interface DrillRow {
  dealId: string;
  dealName: string;
  account: string | null;
  bu: string[];
  stage: string;
  originalAmount: number;
  originalCurrency: string;
  convertedAmount: number;
  weightPct: number;
  calYear: number;
  calQ: 1 | 2 | 3 | 4;
  nativeFy: number;
  nativeFq: 1 | 2 | 3 | 4;
  slipped: boolean;
  amountSource: AmountSource;
  windowSource: WindowSource;
  windowCellsCount: number;
  weightSource: WeightSource;
  stageProbabilityPct: number;
  /** BU-share factor applied to convertedAmount (matched BUs / total BUs on deal). */
  buShare: number;
  /** Numerator/denominator for the BU share, for display (e.g. 1/2 BU). */
  buShareNum: number;
  buShareDen: number;
  /** Which sub-section the row belongs to (Commit grouping / composed routing). */
  section?: "actual" | "won-backlog" | "verbal-approval" | "pipeline";
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fy: number;
  fq: 1 | 2 | 3 | 4 | "all";
  kind: DrillKind;
  bus: string[];
  displayCurrency: Currency;
  rates: Record<string, number>;
  expectedTotal?: number;
  weightMode?: "weighted" | "best";
  expectedTotals?: { actual?: number; committed?: number; pipeline?: number };
}

const toBuArray = (b: string[] | string | null | undefined): string[] =>
  Array.isArray(b) ? b : b ? [b] : [];
const clampPositive = (n: number): number => (isFinite(n) && n > 0 ? n : 0);

const amountWithSource = (deal: any): { amount: number; source: AmountSource } => {
  const positive = (value: unknown) => {
    const n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  };
  if (deal?.stage === "Qualified") return { amount: positive(deal?.budget), source: "budget" };
  if (deal?.stage === "RFQ" || deal?.stage === "Offered") {
    return { amount: positive(deal?.total_contract_value), source: "total_contract_value" };
  }
  if (deal?.stage === "Negotiation" || deal?.stage === "Verbal Approval") {
    return { amount: positive(deal?.final_tcv), source: "final_tcv" };
  }
  const f = Number(deal?.final_tcv);
  if (isFinite(f) && f > 0) return { amount: f, source: "final_tcv" };
  const t = Number(deal?.total_revenue);
  if (isFinite(t) && t > 0) return { amount: t, source: "total_revenue" };
  const c = Number(deal?.total_contract_value);
  if (isFinite(c) && c > 0) return { amount: c, source: "total_contract_value" };
  return { amount: 0, source: "final_tcv" };
};

const wonWindowSource = (deal: any): WindowSource => {
  if (deal?.implementation_start_date || deal?.signed_contract_date) return "implementation";
  if (deal?.start_date && (deal?.end_date || deal?.project_duration)) return "offered";
  return "expected_closing";
};

const pipelineWindowSource = (deal: any): WindowSource => {
  if (deal?.stage === "Qualified") return "expected_closing";
  if (deal?.stage === "Verbal Approval" && deal?.expected_signing_date) return "signed_contract";
  if (deal?.start_date && (deal?.end_date || deal?.project_duration)) return "offered";
  if (deal?.proposal_sent_date && deal?.project_duration) return "proposal+duration";
  return "expected_closing";
};

const weightSourceFor = (
  probability: number | null | undefined,
  ctx: "won" | "va" | "pipeline",
): WeightSource => {
  if (ctx === "won") return "won-100";
  if (typeof probability === "number" && !isNaN(probability)) return "deal.probability";
  if (ctx === "va") return "verbal-approval";
  return "stage-default";
};

const kindTitle = (k: DrillKind): string =>
  k === "actual" ? "Actual" : k === "committed" ? "Commit" : k === "pipeline" ? "Weighted pipeline" : "Total forecast";

const FORMULA: Record<Exclude<DrillKind, "composed">, string> = {
  actual:
    "Sum of Won revenue in past quarters. Amount comes from the schedule row when available; otherwise Final TCV (or Total Revenue, or TCV if missing) is spread across the project window.",
  committed:
    "Sum of Won future revenue (100%) plus Verbal Approval revenue weighted by probability.",
  pipeline:
    "Sum of open pipeline revenue weighted by probability. Past-quarter cells roll into the current fiscal quarter.",
};

const FORMULA_FULL: Record<Exclude<DrillKind, "composed">, string> = {
  actual:
    "Sums Won revenue per quarter cell before the current fiscal quarter. The amount uses the schedule row when the deal has a revenue schedule; otherwise Final TCV is used (falling back to Total Revenue, then TCV) and spread across the project window.",
  committed:
    "Sums Won future revenue at 100% plus Verbal Approval revenue weighted by the deal's own probability. If the deal has no probability set, the Verbal Approval default of 90% is used.",
  pipeline:
    "Sums open-pipeline revenue (Discussions through Negotiation) weighted by the deal's own probability, or the stage default if the deal has none. Past-quarter cells roll into the current fiscal quarter on the current fiscal year.",
};

function isPastFiscal(year: number, calQ: 1 | 2 | 3 | 4): boolean {
  const t = dateToFiscal(new Date());
  const k = calendarToFiscal(year, calQ);
  return k.fy < t.fy || (k.fy === t.fy && k.fq < t.fq);
}

const QuarterDrillDownDialog = ({
  open,
  onOpenChange,
  fy,
  fq,
  kind,
  bus,
  displayCurrency,
  rates,
  expectedTotal,
  weightMode = "weighted",
  expectedTotals,
}: Props) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DrillRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [localWeightMode, setLocalWeightMode] = useState<"weighted" | "best">(weightMode);

  useEffect(() => setLocalWeightMode(weightMode), [weightMode, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const todayFiscal = dateToFiscal(new Date());
      const isCurrentFy = fy === todayFiscal.fy;
      const treatAsCurrentFq =
        (kind === "pipeline" || kind === "composed") &&
        isCurrentFy &&
        (fq === "all" || fq === todayFiscal.fq);

      const collected: DrillRow[] = [];
      const buFilter = bus && bus.length > 0 ? bus : null;
      const buShareOf = (b: string[] | string | null | undefined): { share: number; num: number; den: number } => {
        const arr = toBuArray(b);
        if (arr.length === 0) return { share: buFilter ? 0 : 1, num: 0, den: 0 };
        if (!buFilter) return { share: 1, num: arr.length, den: arr.length };
        const matched = arr.filter((v) => buFilter.includes(v)).length;
        return { share: matched === 0 ? 0 : matched / arr.length, num: matched, den: arr.length };
      };

      const fqTargets: Array<1 | 2 | 3 | 4> = fq === "all" ? [1, 2, 3, 4] : [fq];
      const targetCandidates: Array<{ year: number; calQ: 1 | 2 | 3 | 4 }> = [];
      fqTargets.forEach((f) => {
        const m = fiscalToCalendar(fy, f);
        if (!targetCandidates.some((c) => c.year === m.year && c.calQ === m.calQ)) {
          targetCandidates.push(m);
        }
      });
      [fy - 1, fy, fy + 1].forEach((y) => {
        ([1, 2, 3, 4] as const).forEach((q) => {
          const k = calendarToFiscal(y, q);
          if (k.fy === fy && (fqTargets as number[]).includes(k.fq)) {
            if (!targetCandidates.some((c) => c.year === y && c.calQ === q)) {
              targetCandidates.push({ year: y, calQ: q });
            }
          }
        });
      });
      const targetSet = new Set(targetCandidates.map((c) => `${c.year}|${c.calQ}`));
      const yearWindow = treatAsCurrentFq
        ? [fy - 2, fy - 1, fy, fy + 1]
        : Array.from(new Set(targetCandidates.map((c) => c.year)));

      const wonCoveredCells = new Set<string>();
      const pipelineCoveredCells = new Set<string>();

      const isPastFqCell = (year: number, calQ: 1 | 2 | 3 | 4): boolean => {
        const k = calendarToFiscal(year, calQ);
        return k.fy < todayFiscal.fy || (k.fy === todayFiscal.fy && k.fq < todayFiscal.fq);
      };

      const pushRow = (p: {
        deal: any;
        dealId: string;
        calYear: number;
        calQ: 1 | 2 | 3 | 4;
        rawAmount: number;
        weight: number;
        slipped: boolean;
        amountSource: AmountSource;
        windowSource: WindowSource;
        windowCellsCount: number;
        weightSource: WeightSource;
        section?: DrillRow["section"];
      }) => {
        const bu = buShareOf(p.deal?.bu);
        if (bu.share === 0) return;
        const converted = convert(p.rawAmount, p.deal?.currency_type, displayCurrency, rates);
        if (converted === null) return;
        const base = clampPositive(converted);
        if (base === 0) return;
        const weighted = base * p.weight * bu.share;
        if (weighted === 0) return;
        const native = calendarToFiscal(p.calYear, p.calQ);
        collected.push({
          dealId: p.dealId,
          dealName: p.deal?.deal_name || p.deal?.project_name || "Untitled deal",
          account: p.deal?.customer_name || null,
          bu: toBuArray(p.deal?.bu),
          stage: p.deal?.stage || "",
          originalAmount: p.rawAmount,
          originalCurrency: p.deal?.currency_type || "EUR",
          convertedAmount: weighted,
          weightPct: Math.round(p.weight * 100),
          calYear: p.calYear,
          calQ: p.calQ,
          nativeFy: native.fy,
          nativeFq: native.fq as 1 | 2 | 3 | 4,
          slipped: p.slipped,
          amountSource: p.amountSource,
          windowSource: p.windowSource,
          windowCellsCount: p.windowCellsCount,
          weightSource: p.weightSource,
          stageProbabilityPct: STAGE_PROBABILITY[(p.deal?.stage || "") as DealStage] ?? 0,
          buShare: bu.share,
          buShareNum: bu.num,
          buShareDen: bu.den,
          section: p.section,
        });
      };

      const kinds: Array<"actual" | "committed" | "pipeline"> =
        kind === "composed" ? ["actual", "committed", "pipeline"] : [kind];

      // ============== WON schedule (Actual + Won-backlog Commit) ==============
      if (kinds.includes("actual") || kinds.includes("committed")) {
        try {
          const { data } = await supabase
            .from("deal_revenue_schedule" as any)
            .select(
              "deal_id, year, quarter, revenue, deals!inner(id, deal_name, project_name, customer_name, stage, currency_type, bu, archived_at)",
            )
            .in("year", yearWindow)
            .eq("deals.stage", "Won")
            .is("deals.archived_at", null);
          (data as any[] | null)?.forEach((r) => {
            // Defensive: PostgREST embedded-resource filter can leak non-Won
            // or archived parent rows. Re-enforce constraints client-side.
            if (r?.deals?.stage !== "Won") return;
            if (r?.deals?.archived_at != null) return;
            const cq = r.quarter as 1 | 2 | 3 | 4;
            if (![1, 2, 3, 4].includes(cq)) return;
            if (!r.deal_id) return;
            wonCoveredCells.add(`${r.deal_id}|${r.year}|${cq}`);
            if (!targetSet.has(`${r.year}|${cq}`)) return;
            if (buShareOf(r.deals?.bu).share === 0) return;
            const rev = Number(r.revenue) || 0;
            if (!rev) return;
            const past = isPastFqCell(r.year, cq);
            const which: "actual" | "committed" = past ? "actual" : "committed";
            if (!kinds.includes(which)) return;
            pushRow({
              deal: r.deals,
              dealId: r.deal_id,
              calYear: r.year,
              calQ: cq,
              rawAmount: rev,
              weight: 1,
              slipped: false,
              amountSource: "schedule",
              windowSource: "schedule-row",
              windowCellsCount: 1,
              weightSource: "won-100",
              section: which === "actual" ? "actual" : "won-backlog",
            });
          });
        } catch { /* ignore */ }

        // Deals with ANY schedule row use schedule ONLY — skip TCV fallback for them.
        const dealsWithSchedule = new Set<string>();
        try {
          const { data: schedIds } = await supabase
            .from("deal_revenue_schedule" as any)
            .select("deal_id, deals!inner(stage, archived_at)")
            .eq("deals.stage", "Won")
            .is("deals.archived_at", null);
          (schedIds as any[] | null)?.forEach((r) => {
            if (r?.deal_id && r?.deals?.stage === "Won" && r?.deals?.archived_at == null) dealsWithSchedule.add(r.deal_id);
          });
        } catch { /* ignore */ }

        const { data: legacyWon } = await supabase
          .from("deals")
          .select(
            "id, deal_name, project_name, customer_name, stage, bu, currency_type, quarterly_revenue_q1, quarterly_revenue_q2, quarterly_revenue_q3, quarterly_revenue_q4, signed_contract_date, implementation_start_date, expected_closing_date, start_date, end_date, project_duration, total_revenue, final_tcv, total_contract_value",
          )
        .is("archived_at", null)
          .eq("stage", "Won");
        legacyWon?.forEach((deal: any) => {
          if (!deal.id || buShareOf(deal.bu).share === 0) return;
          // Schedule wins — no TCV spread for deals that have any schedule row.
          if (dealsWithSchedule.has(deal.id)) return;

          const emitCell = (
            calYear: number,
            cq: 1 | 2 | 3 | 4,
            rawAmount: number,
            src: AmountSource,
            winSrc: WindowSource,
            cellsN: number,
          ) => {
            if (!rawAmount) return;
            if (!targetSet.has(`${calYear}|${cq}`)) return;
            const past = isPastFqCell(calYear, cq);
            const which: "actual" | "committed" = past ? "actual" : "committed";
            if (!kinds.includes(which)) return;
            pushRow({
              deal,
              dealId: deal.id,
              calYear,
              calQ: cq,
              rawAmount,
              weight: 1,
              slipped: false,
              amountSource: src,
              windowSource: winSrc,
              windowCellsCount: cellsN,
              weightSource: "won-100",
              section: which === "actual" ? "actual" : "won-backlog",
            });
          };

          const win = deriveWonWindow(deal);
          const { amount, source: amtSrc } = amountWithSource(deal);
          const winSrc = wonWindowSource(deal);
          const cells = win ? windowCells(win) : [];
          if (amount > 0 && cells.length > 0) {
            const perCell = amount / cells.length;
            if (perCell === 0) return;
            cells.forEach((c) => {
              emitCell(c.year, c.quarter as 1 | 2 | 3 | 4, perCell, amtSrc, winSrc, cells.length);
            });
            return;
          }

          const windowYears = win ? win.years.length : 0;
          if (windowYears > 1) return;
          const anchor = deal.signed_contract_date || deal.expected_closing_date;
          if (!anchor) return;
          const calYear = new Date(anchor).getFullYear();
          ([1, 2, 3, 4] as const).forEach((cq) => {
            const v = Number(deal[`quarterly_revenue_q${cq}`]) || 0;
            if (!v) return;
            emitCell(calYear, cq, v, "final_tcv", "signed_contract", 1);
          });
        });
      }

      // ============== VERBAL APPROVAL (Commit) ==============
      if (kinds.includes("committed")) {
        const vaCovered = new Set<string>();
        try {
          const { data: vaSchedule } = await supabase
            .from("deal_offered_schedule" as any)
            .select(
              "deal_id, year, quarter, revenue, deals!inner(id, deal_name, project_name, customer_name, stage, currency_type, bu, probability, archived_at)",
            )
            .in("year", yearWindow)
            .in("deals.stage", COMMIT_PIPELINE_STAGES as unknown as string[])
            .is("deals.archived_at", null);
          (vaSchedule as any[] | null)?.forEach((r) => {
            const cq = r.quarter as 1 | 2 | 3 | 4;
            if (![1, 2, 3, 4].includes(cq) || !r.deal_id) return;
            if (r?.deals?.archived_at != null) return;
            vaCovered.add(`${r.deal_id}|${r.year}|${cq}`);
            if (!targetSet.has(`${r.year}|${cq}`)) return;
            if (buShareOf(r.deals?.bu).share === 0) return;
            if (isPastFqCell(r.year, cq)) return;
            const rev = Number(r.revenue) || 0;
            if (!rev) return;
            const prob = (r.deals as any)?.probability;
            pushRow({
              deal: r.deals,
              dealId: r.deal_id,
              calYear: r.year,
              calQ: cq,
              rawAmount: rev,
              weight: probabilityWeight(r.deals?.stage, prob),
              slipped: false,
              amountSource: "schedule",
              windowSource: "schedule-row",
              windowCellsCount: 1,
              weightSource: weightSourceFor(prob, "va"),
              section: "verbal-approval",
            });
          });
        } catch { /* ignore */ }

        const { data: vaDeals } = await supabase
          .from("deals")
          .select(
            "id, deal_name, project_name, customer_name, stage, bu, currency_type, probability, budget, final_tcv, total_revenue, total_contract_value, start_date, end_date, project_duration, expected_closing_date, proposal_sent_date, expected_signing_date",
          )
        .is("archived_at", null)
          .in("stage", COMMIT_PIPELINE_STAGES as unknown as string[]);
        vaDeals?.forEach((deal: any) => {
          if (!deal.id || buShareOf(deal.bu).share === 0) return;
          const { amount, source: amtSrc } = amountWithSource(deal);
          if (amount <= 0) return;
          const win = derivePipelineWindow(deal);
          const winSrc = pipelineWindowSource(deal);
          const cells = win ? windowCells(win) : [];
          if (cells.length === 0) return;
          const perCell = amount / cells.length;
          if (perCell === 0) return;
          cells.forEach((c) => {
            const k = `${deal.id}|${c.year}|${c.quarter}`;
            if (vaCovered.has(k)) return;
            vaCovered.add(k);
            if (!targetSet.has(`${c.year}|${c.quarter}`)) return;
            if (isPastFqCell(c.year, c.quarter)) return;
            pushRow({
              deal,
              dealId: deal.id,
              calYear: c.year,
              calQ: c.quarter,
              rawAmount: perCell,
              weight: probabilityWeight(deal.stage, deal.probability),
              slipped: false,
              amountSource: amtSrc,
              windowSource: winSrc,
              windowCellsCount: cells.length,
              weightSource: weightSourceFor(deal.probability, "va"),
              section: "verbal-approval",
            });
          });
        });
      }

      // ============== PIPELINE ==============
      if (kinds.includes("pipeline")) {
        const accept = (year: number, calQ: 1 | 2 | 3 | 4): { keep: boolean; slipped: boolean } => {
          if (targetSet.has(`${year}|${calQ}`)) {
            if (!isPastFqCell(year, calQ)) return { keep: true, slipped: false };
            return { keep: false, slipped: false };
          }
          if (treatAsCurrentFq && isPastFqCell(year, calQ)) return { keep: true, slipped: true };
          return { keep: false, slipped: false };
        };
        const applyWeight = (w: number) => (localWeightMode === "best" ? 1 : w);

        try {
          const { data } = await supabase
            .from("deal_offered_schedule" as any)
            .select(
              "deal_id, year, quarter, revenue, deals!inner(id, deal_name, project_name, customer_name, stage, currency_type, bu, probability, archived_at)",
            )
            .in("year", yearWindow)
            .in("deals.stage", PIPELINE_REVENUE_STAGES as unknown as string[])
            .is("deals.archived_at", null);
          (data as any[] | null)?.forEach((r) => {
            const cq = r.quarter as 1 | 2 | 3 | 4;
            if (![1, 2, 3, 4].includes(cq) || !r.deal_id) return;
            if (r?.deals?.archived_at != null) return;
            pipelineCoveredCells.add(`${r.deal_id}|${r.year}|${cq}`);
            const d = accept(r.year, cq);
            if (!d.keep) return;
            if (buShareOf(r.deals?.bu).share === 0) return;
            const rev = Number(r.revenue) || 0;
            if (!rev) return;
            const prob = (r.deals as any)?.probability;
            const w = applyWeight(probabilityWeight(r.deals?.stage, prob));
            if (w <= 0) return;
            pushRow({
              deal: r.deals,
              dealId: r.deal_id,
              calYear: r.year,
              calQ: cq,
              rawAmount: rev,
              weight: w,
              slipped: d.slipped,
              amountSource: "schedule",
              windowSource: "schedule-row",
              windowCellsCount: 1,
              weightSource: weightSourceFor(prob, "pipeline"),
              section: "pipeline",
            });
          });
        } catch { /* ignore */ }

        const { data: pipelineDeals } = await supabase
          .from("deals")
          .select(
            "id, deal_name, project_name, customer_name, stage, bu, currency_type, probability, budget, final_tcv, total_revenue, total_contract_value, expected_closing_date, start_date, end_date, project_duration, proposal_sent_date, expected_signing_date",
          )
        .is("archived_at", null)
          .in("stage", PIPELINE_REVENUE_STAGES as unknown as string[]);
        pipelineDeals?.forEach((deal: any) => {
          if (!deal.id || buShareOf(deal.bu).share === 0) return;
          const { amount, source: amtSrc } = amountWithSource(deal);
          if (amount <= 0) return;
          const w = applyWeight(probabilityWeight(deal.stage, deal.probability));
          if (w <= 0) return;
          const win = derivePipelineWindow(deal);
          const winSrc = pipelineWindowSource(deal);
          const cells = win ? windowCells(win).map((c) => ({ year: c.year, q: c.quarter })) : [];
          if (cells.length === 0) return;
          const openCells = cells.filter((c) => !pipelineCoveredCells.has(`${deal.id}|${c.year}|${c.q}`));
          if (openCells.length === 0) return;
          const perCell = amount / cells.length;
          if (perCell === 0) return;
          openCells.forEach((c) => {
            const d = accept(c.year, c.q);
            if (!d.keep) return;
            pushRow({
              deal,
              dealId: deal.id,
              calYear: c.year,
              calQ: c.q,
              rawAmount: perCell,
              weight: w,
              slipped: d.slipped,
              amountSource: amtSrc,
              windowSource: winSrc,
              windowCellsCount: cells.length,
              weightSource: weightSourceFor(deal.probability, "pipeline"),
              section: "pipeline",
            });
          });
        });
      }

      if (!cancelled) {
        collected.sort((a, b) => Number(a.slipped) - Number(b.slipped) || b.convertedAmount - a.convertedAmount);
        setRows(collected);
        setLoading(false);
        if (typeof expectedTotal === "number") {
          const dt = collected.reduce((s, r) => s + r.convertedAmount, 0);
          if (Math.abs(dt - expectedTotal) > 1) {
            console.warn(
              `[QuarterDrillDown] Reconciliation mismatch (${kind} ${fq === "all" ? fiscalLabel(fy) : fiscalQuarterLabel(fy, fq)}): card=${expectedTotal} dialog=${dt} diff=${dt - expectedTotal}`,
            );
          }
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, fy, fq, kind, bus.join(","), displayCurrency, JSON.stringify(rates), expectedTotal, localWeightMode]);

  const total = (rows || []).reduce((s, r) => s + r.convertedAmount, 0);

  const openDeal = (id: string) => {
    if (!id) return;
    onOpenChange(false);
    navigate(`/deals?highlight=${id}`);
  };

  const weightSourceLabel = (r: DrillRow): string => {
    if (r.weightSource === "won-100") return "Won (100%)";
    if (r.weightSource === "deal.probability") return `Deal probability override (stage default ${r.stageProbabilityPct}%)`;
    if (r.weightSource === "verbal-approval") return "Verbal Approval default";
    return `Stage default (${r.stageProbabilityPct}%)`;
  };

  const amountSourceLabel = (s: AmountSource): string => {
    switch (s) {
      case "schedule": return "Schedule row";
      case "budget": return "Budget";
      case "final_tcv": return "Final TCV";
      case "total_revenue": return "Total Revenue";
      case "total_contract_value": return "TCV";
      default: return String(s);
    }
  };

  const windowSourceLabel = (s: WindowSource): string => {
    switch (s) {
      case "schedule-row": return "Schedule row";
      case "implementation": return "Implementation date";
      case "offered": return "Offered window";
      case "proposal+duration": return "Proposal + duration";
      case "expected_closing": return "Expected closing";
      case "signed_contract": return "Signed contract";
      default: return String(s);
    }
  };

  const renderTable = (list: DrillRow[], variant: "actual" | "committed" | "pipeline") => (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-background border-b z-10">
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Deal</th>
          <th className="py-2 pr-3 font-medium">Account</th>
          <th className="py-2 pr-3 font-medium">Stage</th>
          {variant === "pipeline" && <th className="py-2 pr-3 font-medium">Slipped</th>}
          <th className="py-2 pr-3 font-medium">Amount</th>
          <th className="py-2 pr-3 font-medium">Window</th>
          <th className="py-2 pr-3 text-right font-medium">Split</th>
          <th className="py-2 pr-3 text-right font-medium">Original</th>
          {variant !== "actual" && <th className="py-2 pr-3 text-right font-medium">Wt</th>}
          <th className="py-2 pl-3 text-right font-medium">In {displayCurrency}</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r, i) => (
          <tr
            key={`${r.dealId}-${r.calYear}-${r.calQ}-${i}`}
            className="even:bg-muted/30 hover:bg-muted/60 cursor-pointer"
            onClick={() => openDeal(r.dealId)}
          >
            <td className="py-1.5 pr-3 font-medium">{r.dealName}</td>
            <td className="py-1.5 pr-3 text-muted-foreground">{r.account || "—"}</td>
            <td className="py-1.5 pr-3 text-muted-foreground text-xs">{r.stage ? getStageLabel(r.stage as any) : ""}</td>
            {variant === "pipeline" && (
              <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                {r.slipped ? fiscalQuarterLabel(r.nativeFy, r.nativeFq) : "—"}
              </td>
            )}
            <td className="py-1.5 pr-3">
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{amountSourceLabel(r.amountSource)}</span>
            </td>
            <td className="py-1.5 pr-3">
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{windowSourceLabel(r.windowSource)}</span>
            </td>
            <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground tabular-nums">
              {(() => {
                const winPart = r.windowCellsCount > 1 ? `1/${r.windowCellsCount}` : null;
                const buPart = r.buShareDen > 1 && r.buShareNum < r.buShareDen
                  ? `${r.buShareNum}/${r.buShareDen} BU`
                  : null;
                if (winPart && buPart) return `${winPart} · ${buPart}`;
                return winPart || buPart || "—";
              })()}
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(r.originalAmount, r.originalCurrency)}</td>
            {variant !== "actual" && (
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground text-xs">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">{r.weightPct}%</span>
                  </TooltipTrigger>
                  <TooltipContent>{weightSourceLabel(r)}</TooltipContent>
                </Tooltip>
              </td>
            )}
            <td className="py-1.5 pl-3 text-right tabular-nums font-semibold">
              {formatMoney(r.convertedAmount, displayCurrency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const scopeLabel = fq === "all" ? fiscalLabel(fy) : fiscalQuarterLabel(fy, fq);

  const sectionRows = useMemo(() => {
    const list = rows || [];
    return {
      actual: list.filter((r) => r.section === "actual"),
      wonBacklog: list.filter((r) => r.section === "won-backlog"),
      verbalApproval: list.filter((r) => r.section === "verbal-approval"),
      pipelineNative: list.filter((r) => r.section === "pipeline" && !r.slipped),
      pipelineSlipped: list.filter((r) => r.section === "pipeline" && r.slipped),
    };
  }, [rows]);

  const totalOf = (arr: DrillRow[]) => arr.reduce((s, r) => s + r.convertedAmount, 0);
  const reconciles = (a: number, b: number) => Math.abs(a - b) <= 1;

  const ReconChip = ({ card, rowsTot }: { card?: number; rowsTot: number }) => {
    if (typeof card !== "number") return null;
    const diff = rowsTot - card;
    const ok = reconciles(rowsTot, card);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums cursor-help " +
              (ok
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300")
            }
          >
            <span className={"h-1.5 w-1.5 rounded-full " + (ok ? "bg-emerald-500" : "bg-amber-500")} />
            {ok ? "Reconciled" : `Δ ${formatMoney(diff, displayCurrency)}`}
          </div>
        </TooltipTrigger>
        <TooltipContent className="tabular-nums text-xs">
          Card {formatMoney(card, displayCurrency)} · Rows {formatMoney(rowsTot, displayCurrency)} · Δ {formatMoney(diff, displayCurrency)}
        </TooltipContent>
      </Tooltip>
    );
  };

  const FormulaPill = ({ k }: { k: Exclude<DrillKind, "composed"> }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block max-w-full truncate rounded border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground cursor-help">
          {FORMULA[k]}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-md text-xs">{FORMULA_FULL[k]}</TooltipContent>
    </Tooltip>
  );

  const SectionHeader = ({ title, list }: { title: string; list: DrillRow[] }) => (
    <div className="flex items-baseline justify-between border-b pb-1.5">
      <div className="text-sm font-semibold">
        {title} <span className="text-xs font-normal text-muted-foreground">· {list.length} {list.length === 1 ? "deal" : "deals"}</span>
      </div>
      <div className="text-sm font-semibold tabular-nums">{formatMoney(totalOf(list), displayCurrency)}</div>
    </div>
  );

  const SectionBlock = ({
    title,
    list,
    variant,
  }: {
    title: string;
    list: DrillRow[];
    variant: "actual" | "committed" | "pipeline";
  }) => (
    <div className="space-y-2">
      <SectionHeader title={title} list={list} />
      {list.length > 0 ? renderTable(list, variant) : (
        <div className="text-xs text-muted-foreground px-1 py-2">No rows.</div>
      )}
    </div>
  );

  const composedSectionTotal = (which: "actual" | "committed" | "pipeline") => {
    if (which === "actual") return totalOf(sectionRows.actual);
    if (which === "committed") return totalOf(sectionRows.wonBacklog) + totalOf(sectionRows.verbalApproval);
    return totalOf(sectionRows.pipelineNative) + totalOf(sectionRows.pipelineSlipped);
  };

  return (
    <TooltipProvider delayDuration={200}>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw]">
        <DialogHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2">
              {kindTitle(kind)} · {scopeLabel}
              {kind === "pipeline" && localWeightMode === "best" && (
                <Badge variant="outline" className="text-[10px]">best-case (100%)</Badge>
              )}
            </DialogTitle>
            {kind !== "composed" && !loading && <ReconChip card={expectedTotal} rowsTot={total} />}
          </div>
          {kind !== "composed" && (
            <div className="pt-1">
              <FormulaPill k={kind as Exclude<DrillKind, "composed">} />
            </div>
          )}
        </DialogHeader>

        {kind === "pipeline" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Weight mode:</span>
            <Button size="sm" variant={localWeightMode === "weighted" ? "default" : "outline"} onClick={() => setLocalWeightMode("weighted")}>
              Weighted
            </Button>
            <Button size="sm" variant={localWeightMode === "best" ? "default" : "outline"} onClick={() => setLocalWeightMode("best")}>
              Best case
            </Button>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="max-h-[72vh] overflow-auto space-y-4">
            {!rows || rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No deals contribute to this {fq === "all" ? "year" : "quarter"}.
              </div>
            ) : (
              <>
                {kind === "actual" && renderTable(rows, "actual")}

                {kind === "committed" && (
                  <div className="space-y-5">
                    <SectionBlock title="Won backlog (100%)" list={sectionRows.wonBacklog} variant="committed" />
                    <SectionBlock title="Verbal Approval (weighted)" list={sectionRows.verbalApproval} variant="committed" />
                  </div>
                )}

                {kind === "pipeline" && (
                  <div className="space-y-5">
                    {sectionRows.pipelineNative.length > 0 && (
                      <div className="space-y-2">
                        <SectionHeader title="In-quarter pipeline" list={sectionRows.pipelineNative} />
                        {renderTable(sectionRows.pipelineNative, "pipeline")}
                      </div>
                    )}
                    {sectionRows.pipelineSlipped.length > 0 && (
                      <div className="space-y-2">
                        <SectionHeader title="Slipped from earlier quarters" list={sectionRows.pipelineSlipped} />
                        {renderTable(sectionRows.pipelineSlipped, "pipeline")}
                      </div>
                    )}
                  </div>
                )}

                {kind === "composed" && (
                  <div className="space-y-8">
                    {(["actual", "committed", "pipeline"] as const).map((k) => (
                      <div key={k} className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold capitalize">{k === "committed" ? "Commit" : k === "pipeline" ? "Weighted pipeline" : "Actual"}</div>
                          <ReconChip card={expectedTotals?.[k]} rowsTot={composedSectionTotal(k)} />
                        </div>
                        <FormulaPill k={k} />
                        {k === "actual" && <SectionBlock title="Actual" list={sectionRows.actual} variant="actual" />}
                        {k === "committed" && (
                          <>
                            <SectionBlock title="Won backlog (100%)" list={sectionRows.wonBacklog} variant="committed" />
                            <SectionBlock title="Verbal Approval (weighted)" list={sectionRows.verbalApproval} variant="committed" />
                          </>
                        )}
                        {k === "pipeline" && (
                          <>
                            {sectionRows.pipelineNative.length > 0 && (
                              <div className="space-y-2">
                                <SectionHeader title="In-quarter pipeline" list={sectionRows.pipelineNative} />
                                {renderTable(sectionRows.pipelineNative, "pipeline")}
                              </div>
                            )}
                            {sectionRows.pipelineSlipped.length > 0 && (
                              <div className="space-y-2">
                                <SectionHeader title="Slipped from earlier quarters" list={sectionRows.pipelineSlipped} />
                                {renderTable(sectionRows.pipelineSlipped, "pipeline")}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t-2 pt-3">
                      <span className="font-semibold">Total forecast</span>
                      <span className="font-bold tabular-nums text-lg">{formatMoney(total, displayCurrency)}</span>
                    </div>
                  </div>
                )}

                {kind !== "composed" && (
                  <div className="flex items-center justify-between border-t-2 pt-3">
                    <span className="font-semibold">Total</span>
                    <span className="font-bold tabular-nums text-lg">{formatMoney(total, displayCurrency)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    </TooltipProvider>
  );
};

export default QuarterDrillDownDialog;

// Retained export in case any other file imports it (not currently used elsewhere).
export { isPastFiscal };