export interface ScheduleCellLite {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  revenue: number;
}

export interface ScheduleDiff {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  offered: number;
  won: number;
  delta: number; // won - offered
}

export interface CompareResult {
  perQuarterDiffs: ScheduleDiff[];
  totalOffered: number;
  totalWon: number;
  totalDelta: number;
  hasDifference: boolean;
}

const key = (y: number, q: number) => `${y}:${q}`;

export const compareSchedules = (
  offered: ScheduleCellLite[],
  won: ScheduleCellLite[],
  tolerance = 1
): CompareResult => {
  const map = new Map<string, { offered: number; won: number; year: number; quarter: 1|2|3|4 }>();
  offered.forEach((c) => {
    map.set(key(c.year, c.quarter), { offered: Number(c.revenue) || 0, won: 0, year: c.year, quarter: c.quarter });
  });
  won.forEach((c) => {
    const k = key(c.year, c.quarter);
    const ex = map.get(k);
    if (ex) ex.won = Number(c.revenue) || 0;
    else map.set(k, { offered: 0, won: Number(c.revenue) || 0, year: c.year, quarter: c.quarter });
  });

  const perQuarterDiffs: ScheduleDiff[] = [];
  let totalOffered = 0;
  let totalWon = 0;
  for (const v of map.values()) {
    totalOffered += v.offered;
    totalWon += v.won;
    const delta = v.won - v.offered;
    if (Math.abs(delta) > tolerance) {
      perQuarterDiffs.push({
        year: v.year,
        quarter: v.quarter,
        offered: v.offered,
        won: v.won,
        delta,
      });
    }
  }
  perQuarterDiffs.sort((a, b) => (a.year - b.year) || (a.quarter - b.quarter));

  const totalDelta = totalWon - totalOffered;
  return {
    perQuarterDiffs,
    totalOffered,
    totalWon,
    totalDelta,
    hasDifference: perQuarterDiffs.length > 0 || Math.abs(totalDelta) > tolerance,
  };
};
