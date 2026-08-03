import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture supabase query builder calls.
const calls: any[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const state: any = { table, filters: [] as any[] };
    const builder: any = {
      select: (cols: string) => {
        state.cols = cols;
        return builder;
      },
      in: (col: string, vals: any[]) => {
        state.filters.push({ op: "in", col, vals });
        return builder;
      },
      or: (expr: string) => {
        state.filters.push({ op: "or", expr });
        return builder;
      },
      range: async (_from: number, _to: number) => {
        calls.push(state);
        // Echo back behaviour: tests inject the response via __mockResponse
        const resp = (globalThis as any).__mockResponse?.[table] ?? { data: [], error: null };
        return resp;
      },
    };
    return builder;
  };
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { fetchScopedAccounts } from "../campaignAudienceScope";

beforeEach(() => {
  calls.length = 0;
  (globalThis as any).__mockResponse = { accounts: { data: [], error: null } };
});

describe("fetchScopedAccounts strict country gate", () => {
  it("returns 0 rows when selected countries match nothing — never widens to region", async () => {
    const rows = await fetchScopedAccounts(["Europe"], ["Switzerland"]);
    expect(rows).toEqual([]);
    // Should have queried by country only, never by region.
    const countryCall = calls.find((c) => c.filters.some((f: any) => f.col === "country"));
    const regionCall = calls.find((c) => c.filters.some((f: any) => f.col === "region"));
    expect(countryCall).toBeTruthy();
    expect(regionCall).toBeFalsy();
  });

  it("uses .in() with normalized variants instead of brittle ilike OR", async () => {
    await fetchScopedAccounts([], ["Switzerland"]);
    const call = calls.find((c) => c.filters.some((f: any) => f.op === "in" && f.col === "country"));
    expect(call).toBeTruthy();
    const filter = call.filters.find((f: any) => f.col === "country");
    expect(filter.vals.length).toBeGreaterThan(0);
    // No OR expression should be used.
    const orCall = calls.find((c) => c.filters.some((f: any) => f.op === "or"));
    expect(orCall).toBeFalsy();
  });

  it("falls back to region when no countries selected", async () => {
    await fetchScopedAccounts(["Europe"], []);
    const regionCall = calls.find((c) => c.filters.some((f: any) => f.col === "region"));
    expect(regionCall).toBeTruthy();
  });

  it("preserves country names containing commas (no stripping)", async () => {
    await fetchScopedAccounts([], ["Bonaire, Sint Eustatius and Saba"]);
    const call = calls.find((c) => c.filters.some((f: any) => f.col === "country"));
    const filter = call.filters.find((f: any) => f.col === "country");
    expect(filter.vals.some((v: string) => v.includes(","))).toBe(true);
  });
});
