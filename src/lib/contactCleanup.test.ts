import { describe, it, expect } from "vitest";
import {
  analyzeContacts,
  findEmailDuplicates,
  findPhoneDuplicates,
  findNameCompanyDuplicates,
  findFuzzyNameCompanyDuplicates,
  findCrossAccountDuplicates,
  isPlaceholderContact,
  isMalformedEmail,
  isMalformedPhone,
  isThinContact,
  isStaleContact,
  normalizePersonName,
  normalizeEmail,
  suggestSurvivor,
  type CleanupContact,
} from "./contactCleanup";

const c = (o: Partial<CleanupContact>): CleanupContact => ({
  id: o.id || Math.random().toString(36).slice(2),
  contact_name: o.contact_name ?? "Jane Doe",
  company_name: o.company_name ?? null,
  email: o.email ?? null,
  phone_no: o.phone_no ?? null,
  position: o.position ?? null,
  
  contact_owner: "contact_owner" in o ? (o.contact_owner ?? null) : "u1",
  account_id: o.account_id ?? null,
  last_activity_time: o.last_activity_time ?? null,
  modified_time: o.modified_time ?? null,
  created_time: o.created_time ?? null,
});

describe("normalize", () => {
  it("strips prefix/suffix titles", () => {
    expect(normalizePersonName("Dr. Alok Desai Jr.")).toBe("alok desai");
    expect(normalizePersonName("Mr Alok Desai")).toBe("alok desai");
  });
  it("canonicalizes gmail addresses", () => {
    expect(normalizeEmail("Alok.Desai+crm@Gmail.com")).toBe("alokdesai@gmail.com");
    expect(normalizeEmail("Alok+work@company.com")).toBe("alok@company.com");
  });
});

describe("duplicate detection", () => {
  it("finds email duplicates (case + gmail dots)", () => {
    const groups = findEmailDuplicates([
      c({ id: "1", email: "alok.desai@gmail.com" }),
      c({ id: "2", email: "alokdesai@GMAIL.com" }),
      c({ id: "3", email: "other@x.com" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].contactIds.sort()).toEqual(["1", "2"]);
  });

  it("finds phone duplicates by last-10 digits", () => {
    const groups = findPhoneDuplicates([
      c({ id: "1", phone_no: "+91 98765 43210" }),
      c({ id: "2", phone_no: "9876543210" }),
      c({ id: "3", phone_no: "1111111111" }),
    ]);
    expect(groups[0].contactIds.sort()).toEqual(["1", "2"]);
  });

  it("groups by name + company", () => {
    const map = new Map<string, string>();
    const groups = findNameCompanyDuplicates([
      c({ id: "1", contact_name: "Alok Desai", company_name: "Magna International Ltd" }),
      c({ id: "2", contact_name: "alok desai", company_name: "Magna International" }),
      c({ id: "3", contact_name: "Alok Desai", company_name: "Other Co" }),
    ], map);
    expect(groups).toHaveLength(1);
    expect(groups[0].contactIds.sort()).toEqual(["1", "2"]);
  });

  it("finds fuzzy name+company matches (Levenshtein ≤ 2)", () => {
    const groups = findFuzzyNameCompanyDuplicates([
      c({ id: "1", contact_name: "Alok Desai", company_name: "Magna" }),
      c({ id: "2", contact_name: "Alok Desay", company_name: "Magna" }),
    ], new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0].contactIds.sort()).toEqual(["1", "2"]);
  });

  it("flags cross-account duplicates (same person, different accounts)", () => {
    const groups = findCrossAccountDuplicates([
      c({ id: "1", contact_name: "Alok Desai", account_id: "A" }),
      c({ id: "2", contact_name: "Alok Desai", account_id: "B" }),
    ]);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].contactIds.sort()).toEqual(["1", "2"]);
  });
});

describe("rule predicates", () => {
  it("catches placeholder names", () => {
    expect(isPlaceholderContact(c({ contact_name: "test" }))).toBe(true);
    expect(isPlaceholderContact(c({ contact_name: "N/A" }))).toBe(true);
    expect(isPlaceholderContact(c({ contact_name: "" }))).toBe(true);
    expect(isPlaceholderContact(c({ contact_name: "Alok Desai" }))).toBe(false);
  });
  it("catches malformed email/phone", () => {
    expect(isMalformedEmail(c({ email: "not-an-email" }))).toBe(true);
    expect(isMalformedEmail(c({ email: "ok@example.com" }))).toBe(false);
    expect(isMalformedPhone(c({ phone_no: "123" }))).toBe(true);
    expect(isMalformedPhone(c({ phone_no: "9876543210" }))).toBe(false);
  });
  it("catches thin & stale", () => {
    expect(isThinContact(c({ contact_name: "Alok" }))).toBe(true);
    expect(isThinContact(c({ contact_name: "Alok", email: "a@b.com" }))).toBe(false);
    const oldTs = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStaleContact(c({ last_activity_time: oldTs }))).toBe(true);
  });
});

describe("analyzeContacts", () => {
  it("aggregates all rules with severity", () => {
    const contacts = [
      c({ id: "1", contact_name: "Alok Desai", email: "a@b.com", account_id: "A", contact_owner: null }),
      c({ id: "2", contact_name: "Alok Desai", email: "a@b.com", account_id: "MISSING" }),
      c({ id: "3", contact_name: "test", email: "bad" }),
    ];
    const res = analyzeContacts({
      contacts,
      dealCounts: {},
      campaignCounts: {},
      validAccountIds: new Set(["A"]),
      accountNameById: new Map([["A", "Acme"]]),
    });
    expect(res.counts.exact_dup_email).toBe(2);
    expect(res.counts.orphan_account).toBe(1);
    expect(res.counts.placeholder).toBeGreaterThanOrEqual(1);
    expect(res.counts.malformed_email).toBe(1);
    expect(res.severityByContact["2"]).toBe("high");

  });
});

describe("suggestSurvivor", () => {
  it("picks the richest record with the most links", () => {
    const a = c({ id: "1", email: "a@b.com" });
    const b = c({ id: "2", email: "a@b.com", phone_no: "9876543210", position: "CTO", account_id: "A" });
    const survivor = suggestSurvivor([a, b], (id) => (id === "1" ? 3 : 0));
    // 1 has more links (3*10=30) vs 2's filled fields (~4) → 1 wins
    expect(survivor?.id).toBe("1");
    const survivor2 = suggestSurvivor([a, b], () => 0);
    expect(survivor2?.id).toBe("2");
  });
});
