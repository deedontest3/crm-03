import { describe, it, expect } from "vitest";
import { matchesSegmentFilters } from "../segmentMatcher";

const acct = (over: any = {}) => ({ accounts: over });

describe("matchesSegmentFilters — region parity", () => {
  it("matches EU-coded account when filter says Europe", () => {
    expect(
      matchesSegmentFilters(acct({ region: "EU" }), { regions: ["Europe"] }),
    ).toBe(true);
  });

  it("matches ASIA-coded account when filter says Middle East", () => {
    expect(
      matchesSegmentFilters(acct({ region: "ASIA" }), { regions: ["Middle East"] }),
    ).toBe(true);
  });

  it("does not match unrelated region", () => {
    expect(
      matchesSegmentFilters(acct({ region: "US" }), { regions: ["Europe"] }),
    ).toBe(false);
  });

  it("excludes by region with alias expansion", () => {
    expect(
      matchesSegmentFilters(acct({ region: "EU" }), {
        excludes: { regions: ["Europe"] },
      }),
    ).toBe(false);
  });
});

describe("matchesSegmentFilters — position tokenization", () => {
  const c = (position: string) => ({ contacts: { position } });

  it("matches VP against 'Senior VP'", () => {
    expect(matchesSegmentFilters(c("Senior VP"), { positions: ["VP"] })).toBe(true);
  });

  it("does NOT match VP against 'Developer (VP project)' as substring noise", () => {
    // tokens of "Developer (VP project)" => ['developer','vp','project']
    // tokens of filter "VP" => ['vp'] — this WOULD match. The earlier bug was
    // substring `includes` matching things like "vps" or "providers". Confirm
    // that adding extra filter tokens narrows correctly.
    expect(
      matchesSegmentFilters(c("Developer (VP project)"), {
        positions: ["VP Sales"],
      }),
    ).toBe(false);
  });

  it("does NOT match VP against 'VPS Engineer' (substring trap)", () => {
    expect(matchesSegmentFilters(c("VPS Engineer"), { positions: ["VP"] })).toBe(false);
  });

  it("matches multi-token filter when all tokens present", () => {
    expect(
      matchesSegmentFilters(c("Senior VP of Sales"), { positions: ["VP Sales"] }),
    ).toBe(true);
  });
});
