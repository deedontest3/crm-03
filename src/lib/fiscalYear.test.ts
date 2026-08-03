import { describe, it, expect } from 'vitest';
import {
  dateToFiscal,
  calendarToFiscal,
  fiscalToCalendar,
  fiscalYearRange,
  fiscalLabel,
  fiscalLabelShort,
  fiscalQuarterMonths,
  formatCalendarQuarter,
} from './fiscalYear';

describe('dateToFiscal', () => {
  it('Apr 1 → Q1 of same FY', () => {
    expect(dateToFiscal(new Date(2025, 3, 1))).toEqual({ fy: 2025, fq: 1 });
  });
  it('Mar 31 → Q4 of previous FY', () => {
    expect(dateToFiscal(new Date(2026, 2, 31))).toEqual({ fy: 2025, fq: 4 });
  });
  it('Dec 31 → Q3', () => {
    expect(dateToFiscal(new Date(2025, 11, 31))).toEqual({ fy: 2025, fq: 3 });
  });
  it('Feb 29 leap → Q4 of prev FY', () => {
    expect(dateToFiscal(new Date(2024, 1, 29))).toEqual({ fy: 2023, fq: 4 });
  });
  it('Jul 15 → Q2', () => {
    expect(dateToFiscal(new Date(2025, 6, 15))).toEqual({ fy: 2025, fq: 2 });
  });
});

describe('calendarToFiscal / fiscalToCalendar round-trip', () => {
  const cases: Array<[number, 1|2|3|4]> = [
    [2025, 1], [2025, 2], [2025, 3], [2025, 4],
    [2026, 1], [2026, 2],
  ];
  for (const [y, q] of cases) {
    it(`${y} Q${q} round-trips`, () => {
      const f = calendarToFiscal(y, q);
      const back = fiscalToCalendar(f.fy, f.fq);
      expect(back).toEqual({ year: y, calQ: q });
    });
  }
  it('cal 2025 Q1 → FY 2024 Q4', () => {
    expect(calendarToFiscal(2025, 1)).toEqual({ fy: 2024, fq: 4 });
  });
  it('cal 2025 Q2 → FY 2025 Q1', () => {
    expect(calendarToFiscal(2025, 2)).toEqual({ fy: 2025, fq: 1 });
  });
});

describe('fiscalYearRange', () => {
  it('FY 2025 = Apr 1 2025 → Mar 31 2026', () => {
    expect(fiscalYearRange(2025)).toEqual({ startISO: '2025-04-01', endISO: '2026-03-31' });
  });
});

describe('labels', () => {
  it('fiscalLabel', () => expect(fiscalLabel(2025)).toBe('FY 2025-26'));
  it('fiscalLabelShort', () => expect(fiscalLabelShort(2025)).toBe('FY25-26'));
  it('fiscalQuarterMonths', () => {
    expect(fiscalQuarterMonths(1)).toBe('Apr - Jun');
    expect(fiscalQuarterMonths(2)).toBe('Jul - Sep');
    expect(fiscalQuarterMonths(3)).toBe('Oct - Dec');
    expect(fiscalQuarterMonths(4)).toBe('Jan - Mar');
  });
  it('formatCalendarQuarter', () => {
    expect(formatCalendarQuarter(2025, 2)).toBe('Q1 FY25-26');
    expect(formatCalendarQuarter(2025, 1)).toBe('Q4 FY24-25');
  });
});