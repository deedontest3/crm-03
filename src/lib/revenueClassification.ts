/**
 * Shared revenue-bucket classification used by the dashboard hook and the
 * quarter drill-down dialog. Keeps the two surfaces aligned.
 */
import type { DealStage } from "@/types/deal";
import {
  getOfferedRevenueWindow,
  getRevenueWindow,
  type RevenueWindow,
} from "@/lib/revenueSchedule";

export type RevenueBucket = "actual" | "commit" | "pipeline" | "excluded";

/**
 * Stage → bucket mapping. "actual" vs "commit" for Won is decided later
 * based on whether the cell's fiscal quarter is in the past.
 *
 *  - Won              → actual / commit
 *  - Verbal Approval  → commit (100% — effectively closed business)
 *  - Qualified..Negotiation → pipeline (weighted by probability)
 *  - Lead/Discussions → not forecasted yet because the CRM form has no forecast amount/date fields
 *  - Lost/Hold/Dropped → excluded
 */
export const classifyStageForRevenue = (stage: DealStage | string | null | undefined): RevenueBucket => {
  switch (stage) {
    case "Won":
      return "actual"; // refined per-cell
    case "Verbal Approval":
      return "commit";
    case "Qualified":
    case "RFQ":
    case "Offered":
    case "Negotiation":
      return "pipeline";
    default:
      return "excluded";
  }
};

/** Stages that contribute to weighted/best-case pipeline.
 *  Excludes Lead and Discussions because their stage forms do not contain
 *  forecast amount/date inputs. */
export const PIPELINE_REVENUE_STAGES: DealStage[] = [
  "Qualified",
  "RFQ",
  "Offered",
  "Negotiation",
];

/** Stages that flow into the Commit bucket via the offered schedule rows
 *  (Won uses its own schedule). */
export const COMMIT_PIPELINE_STAGES: DealStage[] = ["Verbal Approval"];

/**
 * Stage-owned amount to use for revenue dashboards. This deliberately follows
 * the CRM pipeline forms instead of guessing from later-stage fields:
 *   Qualified           → budget
 *   RFQ / Offered       → total_contract_value
 *   Negotiation / VA    → final_tcv
 *   Won                 → total_revenue/final_tcv/TCV fallback
 */
export const dealRevenueAmount = (deal: {
  stage?: DealStage | string | null;
  budget?: number | null;
  final_tcv?: number | null;
  total_revenue?: number | null;
  total_contract_value?: number | null;
}): number => {
  const positive = (value: unknown): number => {
    const n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  };

  switch (deal.stage) {
    case "Qualified":
      return positive(deal.budget);
    case "RFQ":
    case "Offered":
      return positive(deal.total_contract_value);
    case "Negotiation":
    case "Verbal Approval":
      return positive(deal.final_tcv);
  }

  const f = Number(deal.final_tcv);
  if (isFinite(f) && f > 0) return f;
  const t = Number(deal.total_revenue);
  if (isFinite(t) && t > 0) return t;
  const c = Number(deal.total_contract_value);
  if (isFinite(c) && c > 0) return c;
  return 0;
};

/**
 * Pipeline window precedence (non-Won deals only):
 *   1) Offered/RFQ window (start_date + end_date|project_duration)
 *   2) Proposal-sent + project_duration (Offered fallback)
 *   3) Single-cell at expected_closing_date
 *
 * NOTE: implementation_start_date / signed_contract_date are Won-stage fields and
 * MUST NOT be used here — a deal rolled back from Won would otherwise inherit a
 * stale window. For Won deals use `deriveWonWindow` instead.
 */
export const derivePipelineWindow = (deal: {
  stage?: DealStage | string | null;
  start_date?: string | null;
  end_date?: string | null;
  project_duration?: number | null;
  expected_closing_date?: string | null;
  proposal_sent_date?: string | null;
  expected_signing_date?: string | null;
}): RevenueWindow | null => {
  const singleCell = (anchor?: string | null): RevenueWindow | null => {
    if (!anchor) return null;
    const d = new Date(anchor);
    if (isNaN(d.getTime())) return null;
    const q = (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
    const key = { year: d.getFullYear(), quarter: q };
    return { start: key, end: key, years: [d.getFullYear()], quarterCount: 1 };
  };

  if (deal.stage === "Qualified") {
    return singleCell(deal.expected_closing_date);
  }

  const offered = getOfferedRevenueWindow({
    start_date: deal.start_date ?? undefined,
    end_date: deal.end_date ?? undefined,
    project_duration: deal.project_duration ?? undefined,
  });
  if (offered.start && offered.end && offered.quarterCount > 0) return offered;

  if (deal.proposal_sent_date && deal.project_duration && deal.project_duration > 0) {
    const proposalWin = getOfferedRevenueWindow({
      start_date: deal.proposal_sent_date,
      project_duration: deal.project_duration,
    });
    if (proposalWin.start && proposalWin.end && proposalWin.quarterCount > 0) return proposalWin;
  }

  if (deal.stage === "Verbal Approval") {
    return singleCell(deal.expected_signing_date) || singleCell(deal.expected_closing_date);
  }

  return singleCell(deal.expected_closing_date);
};

/**
 * Won-deal window precedence (Won-stage only):
 *   1) Implementation/signed window
 *   2) Offered window
 *   3) Single-cell at signed_contract_date / expected_closing_date
 */
export const deriveWonWindow = (deal: {
  start_date?: string | null;
  end_date?: string | null;
  project_duration?: number | null;
  implementation_start_date?: string | null;
  signed_contract_date?: string | null;
  expected_closing_date?: string | null;
}): RevenueWindow | null => {
  const impl = getRevenueWindow({
    implementation_start_date: deal.implementation_start_date ?? undefined,
    signed_contract_date: deal.signed_contract_date ?? undefined,
    end_date: deal.end_date ?? undefined,
    project_duration: deal.project_duration ?? undefined,
  });
  if (impl.start && impl.end && impl.quarterCount > 0) return impl;

  const offered = getOfferedRevenueWindow({
    start_date: deal.start_date ?? undefined,
    end_date: deal.end_date ?? undefined,
    project_duration: deal.project_duration ?? undefined,
  });
  if (offered.start && offered.end && offered.quarterCount > 0) return offered;

  const anchor = deal.signed_contract_date || deal.expected_closing_date;
  if (anchor) {
    const d = new Date(anchor);
    if (!isNaN(d.getTime())) {
      const q = (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
      const key = { year: d.getFullYear(), quarter: q };
      return { start: key, end: key, years: [d.getFullYear()], quarterCount: 1 };
    }
  }
  return null;
};

/**
 * Centralised probability weight (0..1). Per-deal `probability` override wins;
 * otherwise the default for the stage. Single source of truth — do not duplicate.
 */
import { STAGE_PROBABILITY, type DealStage as _DealStage } from "@/types/deal";

export const probabilityWeight = (
  stage: string | null | undefined,
  dealProb: number | null | undefined,
): number => {
  if (typeof dealProb === "number" && !isNaN(dealProb)) {
    return Math.max(0, Math.min(100, dealProb)) / 100;
  }
  const s = (stage || "") as _DealStage;
  const pct = STAGE_PROBABILITY[s];
  return typeof pct === "number" ? pct / 100 : 0;
};

/**
 * Weight applied when bucketing a Verbal Approval deal into Commit.
 * Keeps STAGE_PROBABILITY['Verbal Approval'] consistent on the dashboard.
 */
export const VERBAL_APPROVAL_COMMIT_WEIGHT =
  (STAGE_PROBABILITY["Verbal Approval"] ?? 90) / 100;

/** Expand a window into its inclusive list of (year, quarter) cells. */
export const windowCells = (
  win: RevenueWindow,
): Array<{ year: number; quarter: 1 | 2 | 3 | 4 }> => {
  if (!win.start || !win.end || win.quarterCount <= 0) return [];
  const out: Array<{ year: number; quarter: 1 | 2 | 3 | 4 }> = [];
  let y = win.start.year;
  let q = win.start.quarter as number;
  for (let i = 0; i < win.quarterCount; i++) {
    out.push({ year: y, quarter: q as 1 | 2 | 3 | 4 });
    q += 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
  }
  return out;
};
