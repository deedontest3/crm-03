/**
 * Indian/UK Financial Year helpers (Apr 1 → Mar 31).
 * The DB still stores calendar year/quarter; these helpers translate at the UI layer.
 *
 * Convention:
 *   `fy` = the START calendar year of the FY (e.g. fy=2025 ⇒ Apr 2025 – Mar 2026).
 *   Label "FY 2025-26" / short "FY25-26".
 */

export const FY_START_MONTH = 4; // 1-based: April

export interface FiscalKey {
  fy: number;
  fq: 1 | 2 | 3 | 4;
}

/** Date → fiscal {fy, fq}. */
export const dateToFiscal = (d: Date): FiscalKey => {
  const m = d.getMonth() + 1; // 1..12
  const y = d.getFullYear();
  if (m >= FY_START_MONTH) {
    const fq = (Math.floor((m - FY_START_MONTH) / 3) + 1) as 1 | 2 | 3 | 4;
    return { fy: y, fq };
  }
  // Jan–Mar belong to previous FY's Q4
  const monthsFromStart = m + 12 - FY_START_MONTH; // 9..11 for Jan..Mar
  const fq = (Math.floor(monthsFromStart / 3) + 1) as 1 | 2 | 3 | 4;
  return { fy: y - 1, fq };
};

/** Calendar (year, calendar-quarter 1..4) → fiscal {fy, fq}. */
export const calendarToFiscal = (year: number, calQ: 1 | 2 | 3 | 4): FiscalKey => {
  // Use the first month of the calendar quarter as a representative date.
  const month = (calQ - 1) * 3; // 0..9 (Jan, Apr, Jul, Oct)
  return dateToFiscal(new Date(year, month, 1));
};

/** Inverse: fiscal → calendar (year, calendar-quarter). */
export const fiscalToCalendar = (
  fy: number,
  fq: 1 | 2 | 3 | 4,
): { year: number; calQ: 1 | 2 | 3 | 4 } => {
  // fq=1 → Apr (month index 3) of fy
  const startMonthIdx = (FY_START_MONTH - 1) + (fq - 1) * 3; // 3,6,9,12
  const year = fy + Math.floor(startMonthIdx / 12);
  const month = startMonthIdx % 12; // 0-based
  const calQ = (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
  return { year, calQ };
};

/** ISO start/end dates (inclusive) for the FY. */
export const fiscalYearRange = (
  fy: number,
): { startISO: string; endISO: string } => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const startISO = `${fy}-${pad(FY_START_MONTH)}-01`;
  // end = day before next FY start
  const endDate = new Date(fy + 1, FY_START_MONTH - 1, 0); // last day of previous month
  const endISO = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`;
  return { startISO, endISO };
};

const two = (n: number) => (n % 100).toString().padStart(2, '0');

/** "FY 2025-26" */
export const fiscalLabel = (fy: number): string => `FY ${fy}-${two(fy + 1)}`;

/** "FY25-26" */
export const fiscalLabelShort = (fy: number): string => `FY${two(fy)}-${two(fy + 1)}`;

/** "Q1 FY25-26" */
export const fiscalQuarterLabel = (fy: number, fq: 1 | 2 | 3 | 4): string =>
  `Q${fq} ${fiscalLabelShort(fy)}`;

/** Convenience: calendar (year, calQ) formatted as fiscal label. */
export const formatCalendarQuarter = (year: number, calQ: 1 | 2 | 3 | 4): string => {
  const { fy, fq } = calendarToFiscal(year, calQ);
  return fiscalQuarterLabel(fy, fq);
};

/** "Apr - Jun" etc. for the fiscal quarter. */
export const fiscalQuarterMonths = (fq: 1 | 2 | 3 | 4): string => {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const startIdx = ((FY_START_MONTH - 1) + (fq - 1) * 3) % 12;
  const endIdx = (startIdx + 2) % 12;
  return `${MONTHS[startIdx]} - ${MONTHS[endIdx]}`;
};

export const currentFiscalYear = (): number => dateToFiscal(new Date()).fy;
