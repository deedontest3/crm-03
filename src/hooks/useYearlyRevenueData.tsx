import { supabase } from "@/integrations/supabase/client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  calendarToFiscal,
  dateToFiscal,
  fiscalYearRange,
  fiscalToCalendar,
} from "@/lib/fiscalYear";
import { convert, type Currency } from "@/lib/currencyConvert";
import { fetchAllPaged } from "@/lib/paginatedFetch";

import {
  PIPELINE_REVENUE_STAGES,
  COMMIT_PIPELINE_STAGES,
  dealRevenueAmount,
  derivePipelineWindow,
  deriveWonWindow,
  windowCells,
  probabilityWeight,
  VERBAL_APPROVAL_COMMIT_WEIGHT,
} from "@/lib/revenueClassification";

interface QuarterlyData {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
}

interface YearlyRevenueData {
  year: number;
  target: number;
  /** Currency the annual/quarter targets were entered in. Does not change with the display filter. */
  targetCurrency: Currency;
  /** True when we aggregated BU targets stored in more than one currency (converted into displayCurrency). */
  targetCurrencyMixed: boolean;
  /** Per-quarter targets when explicitly set; null entries fall back to an even split. */
  quarterTargets: { q1: number | null; q2: number | null; q3: number | null; q4: number | null };
  /** Won revenue scheduled in a fiscal quarter that is strictly in the past. */
  actualRevenue: QuarterlyData;
  /** Won + Verbal Approval revenue in the current or future fiscal quarters (100% weight). */
  committedRevenue: QuarterlyData;
  /** Non-final stages × probability. Excludes Hold/Lost/Dropped, Lead, and Verbal Approval. */
  pipelineRevenue: QuarterlyData;
  /** Same as pipelineRevenue but unweighted (best case). */
  bestCasePipeline: QuarterlyData;
  /** Pipeline revenue that was rolled forward from a past quarter into the current FQ. */
  slippedRevenue: QuarterlyData;
  /** Back-compat: committed + weighted pipeline. */
  projectedRevenue: QuarterlyData;
  totalActual: number;
  totalCommitted: number;
  totalPipeline: number;
  totalBestCase: number;
  totalSlipped: number;
  totalProjected: number;
  hasDeals: boolean;
  displayCurrency: Currency;
  /** Distinct deal currencies that could not be converted (missing FX rate). */
  unconvertibleCurrencies: string[];
  /** Number of deals affected by missing rates. */
  unconvertibleDealCount: number;
  hasUnconvertible: boolean;
  /** True when the display currency itself has no rate — numbers are not trustworthy. */
  ratesUnusable: boolean;
  /** Pipeline / VA deals dropped because we couldn't derive a window or an amount. */
  excludedDealCount: number;
  excludedReasons: { missingDates: number; missingAmount: number };
  /** Per-deal detail for the excluded deals, used by the "fix these" dialog. */
  excludedDeals: ExcludedDeal[];
  /** True when any paginated fetch hit the safety cap — numbers may be understated. */
  dataTruncated: boolean;
}


export type ExclusionReason = "missingAmount" | "missingDates";

export interface ExcludedDeal {
  id: string;
  name: string;
  stage: string | null;
  reason: ExclusionReason;
  /** DB field names that need to be filled for this deal. */
  missingFields: string[];
}

const fqKey = (fq: 1 | 2 | 3 | 4): keyof QuarterlyData =>
  fq === 1 ? "q1" : fq === 2 ? "q2" : fq === 3 ? "q3" : "q4";

const emptyQuarters = (): QuarterlyData => ({ q1: 0, q2: 0, q3: 0, q4: 0 });

/** Clamp negatives — Quarterly Breakdown only displays positive expected revenue. */
const clampPositive = (n: number): number => (isFinite(n) && n > 0 ? n : 0);

interface Args {
  selectedYear: number;
  bus?: string[];
  displayCurrency?: Currency;
  rates?: Record<string, number>;
}

/**
 * `selectedYear` is the FINANCIAL YEAR start year (Apr–Mar convention).
 * Args.bus: empty/undefined = all BUs.
 * Args.displayCurrency: target currency. All deal amounts are converted into it.
 */
export const useYearlyRevenueData = ({
  selectedYear,
  bus = [],
  displayCurrency = "EUR",
  rates,
}: Args) => {
  // Stable cache key — avoids React Query re-fetching on every parent render.
  const ratesKey = useMemo(
    () =>
      rates
        ? Object.entries(rates)
            .map(([k, v]) => `${k}:${v}`)
            .sort()
            .join(",")
        : "no-rates",
    [rates],
  );
  const busKey = useMemo(() => (bus || []).slice().sort().join(","), [bus]);

  const { data: revenueData, isLoading, isFetching, error } = useQuery({
    queryKey: ["yearly-revenue-fy", selectedYear, busKey, displayCurrency, ratesKey],
    enabled: !!rates,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<YearlyRevenueData> => {
      fiscalYearRange(selectedYear); // for type-validation; window comes from calendarToFiscal
      const now = new Date();
      const todayFiscal = dateToFiscal(now);
      const ratesMap = rates || {};
      const displayHasRate = !!ratesMap[displayCurrency];
      const ratesUnusable = !displayHasRate;

      const actualRevenue = emptyQuarters();
      const committedRevenue = emptyQuarters();
      const pipelineRevenue = emptyQuarters();
      const bestCasePipeline = emptyQuarters();
      const slippedRevenue = emptyQuarters();
      let totalActualRevenue = 0;
      let totalCommitted = 0;
      let totalPipeline = 0;
      let totalBestCase = 0;
      let totalSlipped = 0;
      let hasAnyDeal = false;
      const missingCurrencies = new Set<string>();
      const affectedDealIds = new Set<string>();
      const excludedIds = new Set<string>();
      const excludedReasons = { missingDates: 0, missingAmount: 0 };
      const excludedDeals: ExcludedDeal[] = [];
      const dealName = (deal: any): string =>
        deal?.project_name || deal?.deal_name || deal?.customer_name || "Untitled deal";
      /**
       * Suggest the minimum set of empty date fields the user needs to fill so the
       * deal enters the forecast, based on its current stage. Mirrors the fallback
       * order in derivePipelineWindow / deriveWonWindow — we only surface fields
       * the stage's form actually exposes.
       */
      const suggestedDateFields = (deal: any): string[] => {
        const stage = deal?.stage as string | null | undefined;
        const empty = (f: string) => !deal?.[f];
        const pick = (fields: string[]) => fields.filter(empty);
        switch (stage) {
          case "Qualified":
            return pick(["expected_closing_date"]);
          case "RFQ":
          case "Offered":
          case "Negotiation":
            if (deal?.start_date && !deal?.end_date && !deal?.project_duration) {
              return pick(["end_date", "project_duration"]);
            }
            return pick(["start_date", "end_date"]);
          case "Verbal Approval":
            return pick(["expected_signing_date"]);
          default:
            return [];
        }
      };
      /**
       * Suggest the single amount field the stage's form expects. Any one of the
       * three amount fields satisfies dealRevenueAmount, so we point users at the
       * one that belongs to their current stage rather than listing all three.
       */
      const suggestedAmountField = (deal: any): string[] => {
        const stage = deal?.stage as string | null | undefined;
        if (stage === "Qualified") return ["budget"];
        if (stage === "RFQ" || stage === "Offered") return ["total_contract_value"];
        if (stage === "Negotiation" || stage === "Verbal Approval") return ["final_tcv"];
        return [];
      };
      const markExcluded = (
        deal: any,
        reason: ExclusionReason,
      ) => {
        const id = deal?.id as string | undefined;
        if (!id || excludedIds.has(id)) return;
        excludedIds.add(id);
        excludedReasons[reason] += 1;
        const missingFields =
          reason === "missingAmount"
            ? suggestedAmountField(deal)
            : suggestedDateFields(deal);
        excludedDeals.push({
          id,
          name: dealName(deal),
          stage: deal?.stage ?? null,
          reason,
          missingFields,
        });
      };


      const conv = (
        amt: number,
        from: string | null | undefined,
        dealId: string | null | undefined,
      ): number => {
        if (ratesUnusable) {
          if (from) missingCurrencies.add(from.toUpperCase());
          if (dealId) affectedDealIds.add(dealId);
          return 0;
        }
        const v = convert(amt, from, displayCurrency, ratesMap);
        if (v === null) {
          if (from) missingCurrencies.add(from.toUpperCase());
          if (dealId) affectedDealIds.add(dealId);
          return 0;
        }
        return v;
      };

      const buFilter = bus && bus.length > 0 ? bus : null;
      /**
       * Share of a deal's revenue attributable to the current BU filter.
       * Deals tagged with multiple BUs are split evenly across those BUs so
       * per-BU views sum back to the deal total (no double counting).
       * - No filter: full amount (1).
       * - Deal has no BU + filter active: 0 (unassigned deals hidden in scoped view).
       * - Deal has no BU + no filter: 1.
       */
      const buShare = (b: string[] | string | null | undefined): number => {
        const arr = Array.isArray(b) ? b : b ? [b] : [];
        if (arr.length === 0) return buFilter ? 0 : 1;
        if (!buFilter) return 1;
        const matched = arr.filter((v) => buFilter.includes(v)).length;
        return matched === 0 ? 0 : matched / arr.length;
      };

      // Yearly + per-quarter target
      // Yearly + per-quarter target — now BU-scoped. Fetch all BU rows for the
      // year and aggregate based on the BU filter: single BU → that row, all/none
      // → sum across BU rows that exist.
      const { data: targetRows } = await supabase
        .from("yearly_revenue_targets")
        .select("business_unit, total_target, q1_target, q2_target, q3_target, q4_target, currency")
        .eq("year", selectedYear);

      const buList = ["EBU", "RT", "MBU"] as const;
      const selectedBus =
        bus && bus.length > 0 && bus.length < buList.length
          ? (bus as readonly string[])
          : buList;
      const rowsForSelection = (targetRows || []).filter((r: any) =>
        selectedBus.includes(r.business_unit),
      );

      // Currency-safe aggregation:
      //  - single BU row → keep its native currency and raw values.
      //  - multiple BU rows → convert each into `displayCurrency` before summing.
      //    If any row's currency is missing a rate, treat that row as 0 and
      //    surface via ratesUnusable/unconvertible signals.
      const isSingleRow = rowsForSelection.length === 1;
      const toDisplay = (amt: unknown, from: unknown): number => {
        const n = Number(amt);
        if (!isFinite(n) || n === 0) return 0;
        // Route through conv so missing FX rates surface via the same
        // unconvertible-currency signal the deal loop uses.
        return conv(n, (from as string) || displayCurrency, null);
      };
      const aggQ = (k: "q1_target" | "q2_target" | "q3_target" | "q4_target"): number | null => {
        let any = false;
        let s = 0;
        for (const r of rowsForSelection as any[]) {
          if (r?.[k] == null) continue;
          any = true;
          s += isSingleRow ? Number(r[k]) : toDisplay(r[k], r.currency);
        }
        return any ? s : null;
      };
      const totalTargetSum = (rowsForSelection as any[]).reduce((acc, r) => {
        const raw = Number(r?.total_target || 0);
        return acc + (isSingleRow ? raw : toDisplay(raw, r?.currency));
      }, 0);
      const distinctTargetCurrencies = Array.from(
        new Set(
          (rowsForSelection as any[])
            .map((r) => (r?.currency as string) || null)
            .filter(Boolean),
        ),
      );
      const targetCurrencyMixed =
        !isSingleRow && distinctTargetCurrencies.length > 1;
      const targetCurrency: Currency = isSingleRow
        ? (((rowsForSelection[0] as any)?.currency as Currency) || "EUR")
        : rowsForSelection.length === 0
          ? (((targetRows?.[0] as any)?.currency as Currency) || "EUR")
          : displayCurrency;

      const quarterTargets = {
        q1: aggQ("q1_target"),
        q2: aggQ("q2_target"),
        q3: aggQ("q3_target"),
        q4: aggQ("q4_target"),
      };


      // ±2 fiscal years so multi-year Won contracts and long project windows
      // near the FY boundary are not truncated. Calendar-year filter is a
      // superset of the fiscal window; final cell-level filter still applies.
      const yearWindow = [
        selectedYear - 2,
        selectedYear - 1,
        selectedYear,
        selectedYear + 1,
        selectedYear + 2,
      ];

      // ===========================================================
      // 1) WON — schedule rows (deal_revenue_schedule)
      // ===========================================================
      type WonScheduleRow = {
        deal_id: string;
        year: number;
        quarter: number;
        revenue: number;
        deals: { stage: string; currency_type: string | null; bu: string[] | string | null; archived_at: string | null } | null;
      };
      let wonScheduleRows: WonScheduleRow[] = [];
      let anyTruncated = false;
      try {
        const { rows, truncated } = await fetchAllPaged<WonScheduleRow>((from, to) =>
          supabase
            .from("deal_revenue_schedule" as any)
            .select("deal_id, year, quarter, revenue, deals!inner(stage, currency_type, bu, archived_at)")
            .in("year", yearWindow)
            .eq("deals.stage", "Won")
            .is("deals.archived_at", null)
            .range(from, to) as any,
        );
        anyTruncated = anyTruncated || truncated;
        // Defensive client-side re-filter: PostgREST embedded-resource filters
        // can leak rows whose parent deal is NOT Won or is archived (observed
        // with Dropped deals that retained schedule rows). Enforce here.
        wonScheduleRows = rows.filter(
          (r: any) => r?.deals?.stage === "Won" && r?.deals?.archived_at == null,
        );
      } catch { /* table may not exist */ }

      const wonCoveredCells = new Set<string>();
      const isViewingCurrentFy = selectedYear === todayFiscal.fy;

      const addWonCell = (
        dealId: string,
        calYear: number,
        calQ: 1 | 2 | 3 | 4,
        amount: number,
        ccy: string | null,
        bu: string[] | string | null,
      ) => {
        const share = buShare(bu);
        if (share === 0) return;
        const { fy, fq } = calendarToFiscal(calYear, calQ);
        if (fy !== selectedYear) return;
        const converted = clampPositive(conv(amount, ccy, dealId)) * share;
        if (converted === 0) return;
        hasAnyDeal = true;
        const qk = fqKey(fq);
        const isPastFq = fy < todayFiscal.fy || (fy === todayFiscal.fy && fq < todayFiscal.fq);
        if (isPastFq) {
          actualRevenue[qk] += converted;
          totalActualRevenue += converted;
        } else {
          committedRevenue[qk] += converted;
          totalCommitted += converted;
        }
      };

      /**
       * Commit-only bucket for Verbal Approval. Never lands in Actual.
       * Past-quarter cells roll forward into the current FQ when viewing the
       * current FY (mirrors pipeline slippage). Weighted by VA probability.
       */
      const addCommitCell = (
        dealId: string,
        calYear: number,
        calQ: 1 | 2 | 3 | 4,
        amount: number,
        ccy: string | null,
        bu: string[] | string | null,
        weight: number = VERBAL_APPROVAL_COMMIT_WEIGHT,
      ) => {
        const share = buShare(bu);
        if (share === 0) return;
        let { fy, fq } = calendarToFiscal(calYear, calQ);
        const isPastFq = fy < todayFiscal.fy || (fy === todayFiscal.fy && fq < todayFiscal.fq);
        if (isPastFq) {
          if (!isViewingCurrentFy) return; // skip slipped commit on other FYs
          fy = todayFiscal.fy;
          fq = todayFiscal.fq;
        }
        if (fy !== selectedYear) return;
        const converted = clampPositive(conv(amount, ccy, dealId)) * weight * share;
        if (converted === 0) return;
        hasAnyDeal = true;
        const qk = fqKey(fq);
        committedRevenue[qk] += converted;
        totalCommitted += converted;
      };

      wonScheduleRows.forEach((row) => {
        const cq = row.quarter as 1 | 2 | 3 | 4;
        if (![1, 2, 3, 4].includes(cq)) return;
        if (!row.deal_id) return;
        wonCoveredCells.add(`${row.deal_id}|${row.year}|${cq}`);
        addWonCell(
          row.deal_id,
          row.year,
          cq,
          Number(row.revenue) || 0,
          row.deals?.currency_type || null,
          row.deals?.bu ?? null,
        );
      });

      // ===========================================================
      // 1b) WON — TCV fallback for deals with NO schedule rows.
      // Rule: if a Won deal has any deal_revenue_schedule row, use ONLY the
      // schedule; do not spread TCV. Only deals with an empty schedule fall
      // back to spreading TCV across the project window (or, when the window
      // is ≤ 1 year, the legacy Q1..Q4 columns).
      // ===========================================================
      // Reuse wonScheduleRows for the set of scheduled deal ids — a separate
      // fetch was redundant and doubled round-trips. Note: yearWindow already
      // covers ±2 fiscal years around the selected year, which is enough to
      // decide "has any schedule row" for the selected FY's forecast.
      const dealsWithSchedule = new Set<string>(
        wonScheduleRows.map((r) => r.deal_id).filter(Boolean) as string[],
      );

      const { rows: legacyWon, truncated: wonTruncated } = await fetchAllPaged<any>((from, to) =>
        supabase
          .from("deals")
          .select(
            "id,deal_name,project_name,customer_name,bu,currency_type,quarterly_revenue_q1,quarterly_revenue_q2,quarterly_revenue_q3,quarterly_revenue_q4,signed_contract_date,implementation_start_date,expected_closing_date,start_date,end_date,project_duration,total_revenue,final_tcv,total_contract_value,stage",
          )
          .is("archived_at", null)
          .eq("stage", "Won")
          .range(from, to) as any,
      );
      anyTruncated = anyTruncated || wonTruncated;

      legacyWon?.forEach((deal: any) => {
        if (!deal.id) return;
        // Schedule takes precedence — skip TCV entirely when any schedule row exists.
        if (dealsWithSchedule.has(deal.id)) return;

        // Spread the authoritative amount across the project window.
        const win = deriveWonWindow(deal);
        const amount = dealRevenueAmount(deal);
        const cells = win ? windowCells(win) : [];
        if (amount > 0 && cells.length > 0) {
          const perCell = amount / cells.length;
          cells.forEach((c) => {
            addWonCell(deal.id, c.year, c.quarter, perCell, deal.currency_type, deal.bu);
          });
          return;
        }

        // Last-resort: legacy 4-bucket columns. ONLY safe when the project window
        // is ≤ 1 year; otherwise the year information is lost and we'd misattribute
        // multi-year contracts into a single calendar year.
        const windowYears = win ? win.years.length : 0;
        if (windowYears > 1) return;

        const anchor = deal.signed_contract_date || deal.expected_closing_date;
        if (!anchor) {
          // Won deal with no schedule, no window and no anchor — surface it so the
          // user can fix the missing dates.
          if (amount === 0) markExcluded(deal, "missingAmount");
          else markExcluded(deal, "missingDates");
          return;
        }
        const legacyValues = ([1, 2, 3, 4] as const).map((cq) =>
          Number(deal[`quarterly_revenue_q${cq}`]) || 0,
        );
        if (amount === 0 && legacyValues.every((v) => v === 0)) {
          markExcluded(deal, "missingAmount");
          return;
        }
        const calYear = new Date(anchor).getFullYear();
        ([1, 2, 3, 4] as const).forEach((cq, i) => {
          const v = legacyValues[i];
          if (!v) return;
          addWonCell(deal.id, calYear, cq, v, deal.currency_type, deal.bu);
        });
      });

      // ===========================================================
      // 2) COMMIT — Verbal Approval (weighted by VA probability, never Actual)
      // ===========================================================
      const vaCoveredCells = new Set<string>();
      try {
        const { rows: vaSchedule, truncated: vaSchedTrunc } = await fetchAllPaged<any>((from, to) =>
          supabase
            .from("deal_offered_schedule" as any)
            .select(
              "deal_id, year, quarter, revenue, deals!inner(stage, currency_type, bu, probability, archived_at)",
            )
            .in("year", yearWindow)
            .in("deals.stage", COMMIT_PIPELINE_STAGES as unknown as string[])
            .is("deals.archived_at", null)
            .range(from, to) as any,
        );
        anyTruncated = anyTruncated || vaSchedTrunc;
        vaSchedule.forEach((row: any) => {
          const cq = row.quarter as 1 | 2 | 3 | 4;
          if (![1, 2, 3, 4].includes(cq)) return;
          if (!row.deal_id) return;
          if (row.deals?.archived_at != null) return;
          vaCoveredCells.add(`${row.deal_id}|${row.year}|${cq}`);
          addCommitCell(
            row.deal_id,
            row.year,
            cq,
            Number(row.revenue) || 0,
            row.deals?.currency_type || null,
            row.deals?.bu ?? null,
            probabilityWeight(row.deals?.stage, (row.deals as any)?.probability),
          );
        });
      } catch { /* table may not exist */ }

      const { rows: vaDeals, truncated: vaTrunc } = await fetchAllPaged<any>((from, to) =>
        supabase
          .from("deals")
          .select(
            "id,deal_name,project_name,customer_name,bu,currency_type,stage,probability,budget,final_tcv,total_revenue,total_contract_value,start_date,end_date,project_duration,expected_closing_date,proposal_sent_date,expected_signing_date",
          )
          .is("archived_at", null)
          .in("stage", COMMIT_PIPELINE_STAGES as unknown as string[])
          .range(from, to) as any,
      );
      anyTruncated = anyTruncated || vaTrunc;
      vaDeals.forEach((deal: any) => {
        if (!deal.id) return;
        const amount = dealRevenueAmount(deal);
        if (amount === 0) {
          markExcluded(deal, "missingAmount");
          return;
        }
        const win = derivePipelineWindow(deal);
        const cells = win ? windowCells(win) : [];
        if (cells.length === 0) {
          markExcluded(deal, "missingDates");
          return;
        }
        const perCell = amount / cells.length;
        cells.forEach((c) => {
          const key = `${deal.id}|${c.year}|${c.quarter}`;
          if (vaCoveredCells.has(key)) return;
          vaCoveredCells.add(key);
          addCommitCell(
            deal.id,
            c.year,
            c.quarter,
            perCell,
            deal.currency_type,
            deal.bu,
            probabilityWeight(deal.stage, deal.probability),
          );
        });
      });


      // ===========================================================
      // 3) PIPELINE — Discussions..Negotiation, weighted by probability.
      //    When viewing the current FY, past-quarter cells roll forward
      //    into the current FQ (slippage). For other FYs, cells stay put
      //    so users see the native forecast for that year.
      // ===========================================================
      const pipelineCoveredCells = new Set<string>();

      const addPipelineCell = (
        dealId: string,
        calYear: number,
        calQ: 1 | 2 | 3 | 4,
        amount: number,
        ccy: string | null,
        bu: string[] | string | null,
        weight: number,
      ) => {
        const share = buShare(bu);
        if (share === 0) return;
        if (weight <= 0) return;
        let { fy, fq } = calendarToFiscal(calYear, calQ);
        const isPastFq = fy < todayFiscal.fy || (fy === todayFiscal.fy && fq < todayFiscal.fq);
        let slipped = false;
        if (isPastFq) {
          if (!isViewingCurrentFy) return; // historical FYs: don't roll forward
          fy = todayFiscal.fy;
          fq = todayFiscal.fq;
          slipped = true;
        }
        if (fy !== selectedYear) return;
        const baseConverted = clampPositive(conv(amount, ccy, dealId)) * share;
        if (baseConverted === 0) return;
        const weighted = baseConverted * weight;
        if (weighted === 0) return;
        hasAnyDeal = true;
        const qk = fqKey(fq);
        pipelineRevenue[qk] += weighted;
        bestCasePipeline[qk] += baseConverted;
        totalPipeline += weighted;
        totalBestCase += baseConverted;
        if (slipped) {
          slippedRevenue[qk] += weighted;
          totalSlipped += weighted;
        }
      };

      try {
        const { rows: offeredRows, truncated: offTrunc } = await fetchAllPaged<any>((from, to) =>
          supabase
            .from("deal_offered_schedule" as any)
            .select("deal_id, year, quarter, revenue, deals!inner(stage, currency_type, bu, probability, archived_at)")
            .in("year", yearWindow)
            .in("deals.stage", PIPELINE_REVENUE_STAGES as unknown as string[])
            .is("deals.archived_at", null)
            .range(from, to) as any,
        );
        anyTruncated = anyTruncated || offTrunc;
        offeredRows.forEach((row: any) => {
          const cq = row.quarter as 1 | 2 | 3 | 4;
          if (![1, 2, 3, 4].includes(cq)) return;
          if (!row.deal_id) return;
          if (row.deals?.archived_at != null) return;
          pipelineCoveredCells.add(`${row.deal_id}|${row.year}|${cq}`);
          const weight = probabilityWeight(row.deals?.stage, (row.deals as any)?.probability);
          addPipelineCell(
            row.deal_id,
            row.year,
            cq,
            Number(row.revenue) || 0,
            row.deals?.currency_type || null,
            row.deals?.bu ?? null,
            weight,
          );
        });
      } catch { /* table may not exist */ }

      // Pipeline fallback — uses derivePipelineWindow (Offered → proposal → expected_closing).
      // Won-stage columns (implementation_start_date / signed_contract_date) are intentionally
      // excluded so a deal rolled back from Won doesn't keep a stale window.
      const { rows: pipelineDeals, truncated: pipeTrunc } = await fetchAllPaged<any>((from, to) =>
        supabase
          .from("deals")
          .select(
            "id,deal_name,project_name,customer_name,stage,bu,currency_type,probability,budget,final_tcv,total_revenue,total_contract_value,start_date,end_date,project_duration,expected_closing_date,proposal_sent_date,expected_signing_date",
          )
          .is("archived_at", null)
          .in("stage", PIPELINE_REVENUE_STAGES as unknown as string[])
          .range(from, to) as any,
      );
      anyTruncated = anyTruncated || pipeTrunc;
      pipelineDeals.forEach((deal: any) => {
        if (!deal.id) return;
        const amount = dealRevenueAmount(deal);
        if (amount === 0) {
          markExcluded(deal, "missingAmount");
          return;
        }
        const weight = probabilityWeight(deal.stage, deal.probability);

        const win = derivePipelineWindow(deal);
        const cells = win ? windowCells(win) : [];
        if (cells.length === 0) {
          markExcluded(deal, "missingDates");
          return;
        }

        const openCells = cells.filter(
          (c) => !pipelineCoveredCells.has(`${deal.id}|${c.year}|${c.quarter}`),
        );
        if (openCells.length === 0) return;
        const perCellOriginal = amount / cells.length;
        openCells.forEach((c) => {
          addPipelineCell(
            deal.id,
            c.year,
            c.quarter,
            perCellOriginal,
            deal.currency_type,
            deal.bu,
            weight,
          );
        });
      });

      const projectedRevenue: QuarterlyData = {
        q1: committedRevenue.q1 + pipelineRevenue.q1,
        q2: committedRevenue.q2 + pipelineRevenue.q2,
        q3: committedRevenue.q3 + pipelineRevenue.q3,
        q4: committedRevenue.q4 + pipelineRevenue.q4,
      };
      const totalProjectedRevenue = totalCommitted + totalPipeline;

      const unconvertibleCurrencies = Array.from(missingCurrencies).sort();

      return {
        year: selectedYear,
        target: totalTargetSum,
        targetCurrency,
        targetCurrencyMixed,
        quarterTargets,

        actualRevenue,
        committedRevenue,
        pipelineRevenue,
        bestCasePipeline,
        slippedRevenue,
        projectedRevenue,
        totalActual: totalActualRevenue,
        totalCommitted,
        totalPipeline,
        totalBestCase,
        totalSlipped,
        totalProjected: totalProjectedRevenue,
        hasDeals: hasAnyDeal,
        displayCurrency,
        unconvertibleCurrencies,
        unconvertibleDealCount: affectedDealIds.size,
        hasUnconvertible: unconvertibleCurrencies.length > 0,
        ratesUnusable,
        excludedDealCount: excludedIds.size,
        excludedReasons,
        excludedDeals,
        dataTruncated: anyTruncated,
      };
    },
  });

  return { revenueData, isLoading, isFetching, error };
};

export const useAvailableYears = () => {
  const { data: years, isLoading } = useQuery({
    queryKey: ["available-fiscal-years"],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<number[]> => {
      const yearSet = new Set<number>();
      yearSet.add(dateToFiscal(new Date()).fy);

      const { rows: deals } = await fetchAllPaged<any>((from, to) =>
        supabase
          .from("deals")
          .select("expected_closing_date,signed_contract_date,start_date,end_date")
          .is("archived_at", null)
          .range(from, to) as any,
      );
      deals.forEach((deal: any) => {
        if (deal.expected_closing_date)
          yearSet.add(dateToFiscal(new Date(deal.expected_closing_date)).fy);
        if (deal.signed_contract_date)
          yearSet.add(dateToFiscal(new Date(deal.signed_contract_date)).fy);
        if (deal.start_date)
          yearSet.add(dateToFiscal(new Date(deal.start_date)).fy);
        if (deal.end_date)
          yearSet.add(dateToFiscal(new Date(deal.end_date)).fy);
      });

      const { data: targets } = await supabase
        .from("yearly_revenue_targets")
        .select("year");
      targets?.forEach((t) => yearSet.add(t.year));

      try {
        const { rows: schedYears } = await fetchAllPaged<any>((from, to) =>
          supabase.from("deal_revenue_schedule" as any).select("year, quarter").range(from, to) as any,
        );
        schedYears.forEach((r: any) => {
          const cq = r.quarter as 1 | 2 | 3 | 4;
          if ([1, 2, 3, 4].includes(cq)) yearSet.add(calendarToFiscal(r.year, cq).fy);
          else yearSet.add(r.year);
        });
      } catch { /* table may not exist */ }

      try {
        const { rows: offeredYears } = await fetchAllPaged<any>((from, to) =>
          supabase.from("deal_offered_schedule" as any).select("year, quarter").range(from, to) as any,
        );
        offeredYears.forEach((r: any) => {
          const cq = r.quarter as 1 | 2 | 3 | 4;
          if ([1, 2, 3, 4].includes(cq)) yearSet.add(calendarToFiscal(r.year, cq).fy);
          else yearSet.add(r.year);
        });
      } catch { /* table may not exist */ }

      return Array.from(yearSet).sort((a, b) => b - a);
    },
  });

  return { years: years || [], isLoading };
};

export const useDashboardStats = () => {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: deals } = await supabase
        .from("deals")
        .select("stage,total_revenue")
        .is("archived_at", null);

      const totalDeals = deals?.length || 0;
      let totalRevenue = 0;
      let wonDeals = 0;
      deals?.forEach((deal: any) => {
        if (deal.stage === "Won") {
          wonDeals++;
          if (deal.total_revenue) {
            const revenue = Number(deal.total_revenue);
            if (!isNaN(revenue)) totalRevenue += revenue;
          }
        }
      });

      return { totalDeals, totalRevenue, wonDeals, todayMeetings: 0 };
    },
  });

  return { stats, isLoading };
};

export { fiscalToCalendar };
