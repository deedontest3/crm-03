import { format, isValid, parse } from "date-fns";

export const DATE_DISPLAY_FORMAT = "dd/MM/yyyy";
export const DATE_DISPLAY_PLACEHOLDER = "DD/MM/YYYY";

/**
 * Parse any date input the app uses (ISO yyyy-MM-dd, dd/MM/yyyy, or a Date)
 * into a Date object. Returns null if invalid/empty.
 */
export function parseDealDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // ISO yyyy-MM-dd (also handles full ISO datetimes)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
    return isValid(d) ? d : null;
  }
  // dd/MM/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const d = parse(trimmed, "dd/MM/yyyy", new Date());
    return isValid(d) ? d : null;
  }
  const d = new Date(trimmed);
  return isValid(d) ? d : null;
}

/** Display a date as DD/MM/YYYY. Returns "" for invalid/empty. */
export function formatDealDate(value: unknown): string {
  const d = parseDealDate(value);
  return d ? format(d, DATE_DISPLAY_FORMAT) : "";
}

/** Display a date+time as DD/MM/YYYY HH:mm. Returns "" for invalid/empty. */
export function formatDealDateTime(value: unknown): string {
  const d = parseDealDate(value);
  return d ? format(d, `${DATE_DISPLAY_FORMAT} HH:mm`) : "";
}

/** ISO yyyy-MM-dd for storage. */
export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Duration in whole months between two dates, derived from the actual day span
 * and rounded to the nearest month. Calendar-month subtraction under-reports
 * (02/11/2026 → 29/01/2027 is 88 days ≈ 3 months, not 2).
 * Returns null when either date is missing/invalid or end < start.
 */
export function monthsBetweenRounded(start: unknown, end: unknown): number | null {
  const s = parseDealDate(start);
  const e = parseDealDate(end);
  if (!s || !e || e < s) return null;
  const days = (e.getTime() - s.getTime()) / 86400000;
  return Math.max(Math.round(days / 30.4375), 0);
}
