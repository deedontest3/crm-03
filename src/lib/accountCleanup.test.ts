import { describe, it, expect } from "vitest";
import {
  normalizeName, normalizeDomain, normalizePhone, levenshtein,
  findExactDuplicateGroups, findFuzzyDuplicateGroups,
  isPlaceholder, isMalformed, isThin, isStale, analyzeAccounts,
  type CleanupAccount,
} from "./accountCleanup";

describe("normalizers", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeName("Acme, Inc.")).toBe("acme");
    expect(normalizeName("Acme Ltd")).toBe("acme");
    expect(normalizeName("  ACME   GmbH ")).toBe("acme");
  });
  it("normalizes domain", () => {
    expect(normalizeDomain("https://www.Acme.com/x?y")).toBe("acme.com");
  });
  it("normalizes phone to last 10 digits", () => {
    expect(normalizePhone("+1 (415) 555-1234")).toBe("4155551234");
    expect(normalizePhone("12345")).toBe("12345");
  });
  it("levenshtein basic", () => {
    expect(levenshtein("acme", "acme")).toBe(0);
    expect(levenshtein("acme", "acne")).toBe(1);
    expect(levenshtein("acme", "acmex")).toBe(1);
  });
});

const mk = (id: string, over: Partial<CleanupAccount> = {}): CleanupAccount => ({
  id, account_name: id, ...over,
});

describe("duplicate detection", () => {
  it("finds exact duplicates ignoring case and suffix", () => {
    const groups = findExactDuplicateGroups([
      mk("1", { account_name: "Acme Inc" }),
      mk("2", { account_name: "acme" }),
      mk("3", { account_name: "Other" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].accountIds.sort()).toEqual(["1", "2"]);
  });
  it("finds fuzzy by domain and phone and name", () => {
    const groups = findFuzzyDuplicateGroups([
      mk("a", { account_name: "Acme", website: "https://acme.com" }),
      mk("b", { account_name: "Beta", website: "http://www.acme.com/x" }),
      mk("c", { account_name: "Zulu", phone: "415-555-0000" }),
      mk("d", { account_name: "Yankee", phone: "+1 415 555 0000" }),
      mk("e", { account_name: "Microsoft" }),
      mk("f", { account_name: "Micrsoft" }),
    ]);
    const reasons = groups.map((g) => g.reason).sort();
    expect(reasons).toEqual(["fuzzy_name", "same_domain", "same_phone"]);
  });
});

describe("row-level checks", () => {
  it("placeholder patterns", () => {
    expect(isPlaceholder(mk("1", { account_name: "test" }))).toBe(true);
    expect(isPlaceholder(mk("1", { account_name: "N/A" }))).toBe(true);
    expect(isPlaceholder(mk("1", { account_name: "Acme" }))).toBe(false);
  });
  it("malformed detection", () => {
    expect(isMalformed(mk("1", { account_name: "a@b.com" }))).toContain("name looks like email");
    expect(isMalformed(mk("1", { website: "notadomain" }))).toContain("invalid website");
    expect(isMalformed(mk("1", { phone: "12" }))).toContain("phone too short");
  });
  it("thin record", () => {
    expect(isThin(mk("1"))).toBe(true);
    expect(isThin(mk("1", { industry: "Auto" }))).toBe(false);
  });
  it("stale record", () => {
    const now = new Date("2026-07-01");
    expect(isStale(mk("1", { modified_time: "2024-01-01" }), now)).toBe(true);
    expect(isStale(mk("1", { modified_time: "2026-05-01" }), now)).toBe(false);
  });
});

describe("analyzeAccounts", () => {
  it("aggregates issues per account", () => {
    const now = new Date("2026-07-01");
    const res = analyzeAccounts({
      now,
      accounts: [
        mk("1", { account_name: "Acme", website: "https://acme.com", modified_time: "2020-01-01" }),
        mk("2", { account_name: "Acme Inc", website: "https://acme.com", account_owner: "u1", industry: "Auto" }),
        mk("3", { account_name: "test" }),
      ],
      contactCounts: { "2": 1 },
      dealCounts: {},
    });
    expect(res.counts.exact_dup).toBe(2);
    expect(res.counts.placeholder).toBeGreaterThanOrEqual(1);
    expect(res.issuesByAccount["1"]).toContain("unlinked");
    expect(res.issuesByAccount["1"]).toContain("stale");
    expect(res.issuesByAccount["3"]).toContain("placeholder");
  });
});