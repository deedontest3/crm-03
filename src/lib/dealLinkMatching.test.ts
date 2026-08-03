import { describe, it, expect } from "vitest";
import { companiesMatch, namesMatch } from "./dealLinkMatching";

describe("companiesMatch", () => {
  it("rejects names that differ only by a numeric suffix", () => {
    expect(companiesMatch("RT India", "RT india 1")).toBe(false);
    expect(companiesMatch("Acme", "Acme 2")).toBe(false);
  });

  it("rejects unrelated companies that share no significant tokens", () => {
    expect(companiesMatch("Test company 1", "RT india 1")).toBe(false);
    expect(companiesMatch("Test company", "RT India")).toBe(false);
  });

  it("matches a single distinctive token against a longer brand name", () => {
    expect(companiesMatch("Bosch Mobility Solutions", "Bosch")).toBe(true);
  });

  it("matches exact and normalized-equal names", () => {
    expect(companiesMatch("Acme Inc", "Acme Incorporated")).toBe(true);
    expect(companiesMatch("Acme & Co", "Acme and Co")).toBe(true);
  });

  it("rejects same-root names with different region qualifiers", () => {
    expect(companiesMatch("Acme North", "Acme South")).toBe(false);
    expect(companiesMatch("Acme HQ", "Acme")).toBe(false);
  });
});

describe("namesMatch", () => {
  it("rejects short partial matches", () => {
    expect(namesMatch("RT India", "RT India 1 Distribution")).toBe(false);
  });

  it("matches identical normalized names", () => {
    expect(namesMatch("Deepak Dongare", "deepak  dongare")).toBe(true);
  });

  it("matches longer substring with word boundary", () => {
    expect(namesMatch("Jonathan Smith", "Mr Jonathan Smith Jr")).toBe(true);
  });
});
