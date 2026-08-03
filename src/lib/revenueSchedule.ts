/**
 * Pure helpers for the Won-stage Revenue Schedule.
 * Tests live in revenueSchedule.test.ts.
 */

export type Currency = 'EUR' | 'USD' | 'INR';

export interface QuarterKey {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}

export interface RevenueWindow {
  /** Inclusive start (year, quarter). null when no anchor date provided. */
  start: QuarterKey | null;
  /** Inclusive end (year, quarter). null when no end can be computed. */
  end: QuarterKey | null;
  /** Years covered by the window, sorted ascending. Empty when window is null. */
  years: number[];
  /** Total quarters in the window (inclusive). 0 when null. */
  quarterCount: number;
}

export interface DealLike {
  signed_contract_date?: string;
  implementation_start_date?: string;
  end_date?: string;
  project_duration?: number; // months
  total_contract_value?: number;
  currency_type?: Currency;
  start_date?: string; // RFQ start date — used for the Offered forecast window
}

const parseDate = (s?: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

export const dateToQuarter = (d: Date): QuarterKey => ({
  year: d.getFullYear(),
  quarter: (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4,
});

/**
 * For a start anchor: round UP to the next full quarter when the date is
 * not the first day of its quarter. This matches typical project-billing
 * practice — partial first quarters are excluded from the recognition window.
 */
export const dateToQuarterCeil = (d: Date): QuarterKey => {
  const month = d.getMonth();
  const day = d.getDate();
  const currentQ = Math.floor(month / 3) + 1; // 1..4
  const quarterStartMonth = (currentQ - 1) * 3;
  const isQuarterStart = month === quarterStartMonth && day === 1;
  if (isQuarterStart) {
    return { year: d.getFullYear(), quarter: currentQ as 1 | 2 | 3 | 4 };
  }
  const next = currentQ + 1;
  if (next > 4) return { year: d.getFullYear() + 1, quarter: 1 };
  return { year: d.getFullYear(), quarter: next as 1 | 2 | 3 | 4 };
};

export const cmpQuarter = (a: QuarterKey, b: QuarterKey): number =>
  a.year === b.year ? a.quarter - b.quarter : a.year - b.year;

import { formatCalendarQuarter } from './fiscalYear';

/**
 * User-facing label for a stored calendar quarter — rendered in the project's
 * Financial Year (Apr–Mar) convention. Storage values remain calendar.
 */
export const quarterLabel = (q: QuarterKey): string =>
  formatCalendarQuarter(q.year, q.quarter);

/**
 * Compute the revenue-recognition window:
 *   start = implementation_start_date OR signed_contract_date
 *   end   = end_date OR (start + project_duration months - 1 day)
 */
export const getRevenueWindow = (deal: DealLike): RevenueWindow => {
  const startDate =
    parseDate(deal.implementation_start_date) || parseDate(deal.signed_contract_date);
  let endDate = parseDate(deal.end_date);

  if (!endDate && startDate && deal.project_duration && deal.project_duration > 0) {
    endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + Math.ceil(deal.project_duration));
    endDate.setDate(endDate.getDate() - 1);
  }

  if (!startDate && !endDate) {
    return { start: null, end: null, years: [], quarterCount: 0 };
  }

  const start = startDate ? dateToQuarterCeil(startDate) : dateToQuarter(endDate!);
  const end = endDate ? dateToQuarter(endDate) : start;

  // Guard against inverted dates — keep window empty so UI can flag the error
  if (cmpQuarter(start, end) > 0) {
    return { start, end, years: [], quarterCount: 0 };
  }

  const years: number[] = [];
  for (let y = start.year; y <= end.year; y++) years.push(y);
  const quarterCount =
    (end.year - start.year) * 4 + (end.quarter - start.quarter) + 1;

  return { start, end, years, quarterCount };
};

/**
 * Offered-stage window — anchored on RFQ Start Date / End Date.
 * Falls back to project_duration months when end_date is missing.
 */
export const getOfferedRevenueWindow = (deal: DealLike): RevenueWindow => {
  const startDate = parseDate(deal.start_date);
  let endDate = parseDate(deal.end_date);

  if (!endDate && startDate && deal.project_duration && deal.project_duration > 0) {
    endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + Math.ceil(deal.project_duration));
    endDate.setDate(endDate.getDate() - 1);
  }

  if (!startDate && !endDate) {
    return { start: null, end: null, years: [], quarterCount: 0 };
  }

  const start = startDate ? dateToQuarterCeil(startDate) : dateToQuarter(endDate!);
  const end = endDate ? dateToQuarter(endDate) : start;

  if (cmpQuarter(start, end) > 0) {
    return { start, end, years: [], quarterCount: 0 };
  }

  const years: number[] = [];
  for (let y = start.year; y <= end.year; y++) years.push(y);
  const quarterCount = (end.year - start.year) * 4 + (end.quarter - start.quarter) + 1;
  return { start, end, years, quarterCount };
};

export const isQuarterAllowed = (
  year: number,
  quarter: 1 | 2 | 3 | 4,
  window: RevenueWindow
): boolean => {
  if (!window.start || !window.end) return true; // no window → no restriction
  const q: QuarterKey = { year, quarter };
  return cmpQuarter(q, window.start) >= 0 && cmpQuarter(q, window.end) <= 0;
};

export interface ScheduleCell extends QuarterKey {
  revenue: number;
}

export const getOrphanedCells = (
  cells: ScheduleCell[],
  window: RevenueWindow
): ScheduleCell[] =>
  cells.filter(
    (c) => c.revenue > 0 && !isQuarterAllowed(c.year, c.quarter, window)
  );

export type ReconcileState = 'match' | 'under' | 'over' | 'no-tcv';
export interface ReconcileResult {
  state: ReconcileState;
  sum: number;
  tcv: number;
  delta: number;       // sum - tcv (signed)
  deltaAbs: number;
  deltaPct: number;    // |delta| / tcv * 100, 0 when tcv = 0
}

export const reconcileTCV = (sum: number, tcv?: number): ReconcileResult => {
  const t = Number(tcv) || 0;
  const s = Number(sum) || 0;
  const delta = s - t;
  const deltaAbs = Math.abs(delta);
  const deltaPct = t > 0 ? (deltaAbs / t) * 100 : 0;
  if (t <= 0) return { state: 'no-tcv', sum: s, tcv: t, delta, deltaAbs, deltaPct };
  if (deltaAbs <= 1) return { state: 'match', sum: s, tcv: t, delta, deltaAbs, deltaPct };
  return {
    state: delta > 0 ? 'over' : 'under',
    sum: s,
    tcv: t,
    delta,
    deltaAbs,
    deltaPct,
  };
};

const CURRENCY_LOCALE: Record<Currency, string> = {
  EUR: 'en-IE',
  USD: 'en-US',
  INR: 'en-IN',
};

export const formatMoney = (amount: number, currency: Currency = 'EUR'): string => {
  const locale = CURRENCY_LOCALE[currency] || 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
};

/** Months between two ISO dates, rounded up. Returns 0 when invalid. */
export const monthsBetween = (startISO?: string, endISO?: string): number => {
  const s = parseDate(startISO);
  const e = parseDate(endISO);
  if (!s || !e || e < s) return 0;
  const months =
    (e.getFullYear() - s.getFullYear()) * 12 +
    (e.getMonth() - s.getMonth()) +
    (e.getDate() >= s.getDate() ? 0 : -1) +
    1; // inclusive
  return Math.max(months, 0);
};
