import { describe, it, expect } from 'vitest';
import {
  getRevenueWindow,
  isQuarterAllowed,
  reconcileTCV,
  getOrphanedCells,
  formatMoney,
  monthsBetween,
} from './revenueSchedule';

describe('getRevenueWindow', () => {
  it('rolls start up to next full quarter when impl-start is mid-quarter', () => {
    const w = getRevenueWindow({
      implementation_start_date: '2026-06-01',
      end_date: '2027-05-31',
    });
    expect(w.start).toEqual({ year: 2026, quarter: 3 });
    expect(w.end).toEqual({ year: 2027, quarter: 2 });
    expect(w.years).toEqual([2026, 2027]);
    expect(w.quarterCount).toBe(4);
  });

  it('falls back to signed_contract_date when impl missing', () => {
    const w = getRevenueWindow({ signed_contract_date: '2026-01-01', end_date: '2026-12-31' });
    expect(w.start?.quarter).toBe(1);
  });

  it('derives end from project_duration', () => {
    const w = getRevenueWindow({
      implementation_start_date: '2026-01-01',
      project_duration: 24,
    });
    expect(w.end?.year).toBe(2027);
  });

  it('supports multi-year contracts', () => {
    const w = getRevenueWindow({
      implementation_start_date: '2026-01-01',
      end_date: '2028-12-31',
    });
    expect(w.years).toEqual([2026, 2027, 2028]);
    expect(w.quarterCount).toBe(12);
  });

  it('handles inverted dates gracefully', () => {
    const w = getRevenueWindow({
      implementation_start_date: '2027-01-01',
      end_date: '2026-01-01',
    });
    expect(w.years).toEqual([]);
  });
});

describe('isQuarterAllowed', () => {
  const w = getRevenueWindow({
    implementation_start_date: '2026-06-01',
    end_date: '2027-05-31',
  });
  it('rejects Q1/Q2 2026', () => {
    expect(isQuarterAllowed(2026, 1, w)).toBe(false);
    expect(isQuarterAllowed(2026, 2, w)).toBe(false);
  });
  it('accepts Q3/Q4 2026 and Q1/Q2 2027', () => {
    expect(isQuarterAllowed(2026, 3, w)).toBe(true);
    expect(isQuarterAllowed(2026, 4, w)).toBe(true);
    expect(isQuarterAllowed(2027, 1, w)).toBe(true);
    expect(isQuarterAllowed(2027, 2, w)).toBe(true);
  });
  it('rejects Q3 2027', () => {
    expect(isQuarterAllowed(2027, 3, w)).toBe(false);
  });
});

describe('reconcileTCV', () => {
  it('matches within €1', () => {
    expect(reconcileTCV(75000, 75000).state).toBe('match');
    expect(reconcileTCV(75000.5, 75000).state).toBe('match');
  });
  it('detects over', () => {
    const r = reconcileTCV(145000, 75000);
    expect(r.state).toBe('over');
    expect(r.deltaAbs).toBe(70000);
    expect(Math.round(r.deltaPct)).toBe(93);
  });
  it('detects under', () => {
    expect(reconcileTCV(30000, 75000).state).toBe('under');
  });
  it('handles no TCV', () => {
    expect(reconcileTCV(100, 0).state).toBe('no-tcv');
  });
});

describe('getOrphanedCells', () => {
  const w = getRevenueWindow({
    implementation_start_date: '2026-06-01',
    end_date: '2027-05-31',
  });
  it('flags non-zero cells outside the window', () => {
    const orphans = getOrphanedCells(
      [
        { year: 2026, quarter: 1, revenue: 100 },
        { year: 2026, quarter: 3, revenue: 200 },
        { year: 2027, quarter: 3, revenue: 300 },
        { year: 2027, quarter: 4, revenue: 0 },
      ],
      w
    );
    expect(orphans.map((o) => `${o.year}Q${o.quarter}`)).toEqual(['2026Q1', '2027Q3']);
  });
});

describe('formatMoney', () => {
  it('formats EUR/USD/INR', () => {
    expect(formatMoney(1000, 'EUR')).toMatch(/€/);
    expect(formatMoney(1000, 'USD')).toMatch(/\$/);
    expect(formatMoney(1000, 'INR')).toMatch(/₹/);
  });
});

describe('monthsBetween', () => {
  it('counts inclusive months', () => {
    expect(monthsBetween('2026-06-01', '2027-05-31')).toBe(12);
    expect(monthsBetween('2026-01-01', '2028-12-31')).toBe(36);
  });
});
