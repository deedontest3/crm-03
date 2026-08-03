import { describe, expect, it } from "vitest";
import { buildAccountLinkedDealMap, resolveDealAccountLink } from "./accountLinkedDeals";
import type { AccountLinkTarget, CampaignContactLink, DealStakeholderLink, LinkableContact, LinkedDeal } from "./dealLinkMatching";

const deal = (overrides: Partial<LinkedDeal>): LinkedDeal => ({
  id: "deal-1",
  project_name: "Test Deal",
  customer_name: "Volvo AB",
  lead_name: "Someone",
  stage: "RFQ",
  total_contract_value: 100,
  account_id: null,
  ...overrides,
});

const contact = (overrides: Partial<LinkableContact>): LinkableContact => ({
  id: "contact-1",
  contact_name: "Contact",
  company_name: "Volvo",
  account_id: null,
  ...overrides,
});

describe("resolveDealAccountLink", () => {
  it("uses deals.account_id before every other ID", () => {
    const contacts = new Map([["contact-1", contact({ account_id: "account-b" })]]);
    const stakeholders = new Map([["deal-1", ["contact-1"]]]);

    expect(resolveDealAccountLink(deal({ account_id: "account-a" }), contacts, stakeholders)).toEqual({
      status: "linked",
      accountId: "account-a",
      reason: "deal_account",
    });
  });

  it("uses campaign contact account_id when deal account_id is empty", () => {
    const campaignContact: CampaignContactLink = { id: "campaign-contact-1", contact_id: null, account_id: "account-c" };

    expect(resolveDealAccountLink(deal({ source_campaign_contact_id: "campaign-contact-1" }), new Map(), new Map(), campaignContact)).toEqual({
      status: "linked",
      accountId: "account-c",
      reason: "campaign_contact_account",
    });
  });

  it("marks multiple contact account IDs as ambiguous instead of guessing", () => {
    const contacts = new Map([
      ["contact-1", contact({ id: "contact-1", account_id: "account-a" })],
      ["contact-2", contact({ id: "contact-2", account_id: "account-b" })],
    ]);
    const stakeholders = new Map([["deal-1", ["contact-1", "contact-2"]]]);

    expect(resolveDealAccountLink(deal({}), contacts, stakeholders)).toEqual({
      status: "ambiguous",
      accountIds: ["account-a", "account-b"],
      reason: "multiple_contact_accounts",
    });
  });

  it("marks deals with no explicit account IDs as unmatched", () => {
    expect(resolveDealAccountLink(deal({}), new Map(), new Map())).toEqual({
      status: "unmatched",
      reason: "no_account_id",
    });
  });

  it("falls back to matching deal.customer_name against the account name pool", () => {
    const accounts = [
      { id: "account-magna", account_name: "Magna International" },
      { id: "account-other", account_name: "Bosch Mobility" },
    ];

    expect(
      resolveDealAccountLink(
        deal({ account_id: null, customer_name: "Magna International, Germany" }),
        new Map(),
        new Map(),
        undefined,
        accounts
      )
    ).toEqual({ status: "linked", accountId: "account-magna", reason: "name_match" });
  });

  it("breaks ties with an exact normalized name match", () => {
    const accounts = [
      { id: "account-1", account_name: "Magna International" },
      { id: "account-2", account_name: "Magna International Germany Plant" },
    ];

    expect(
      resolveDealAccountLink(
        deal({ account_id: null, customer_name: "Magna International" }),
        new Map(),
        new Map(),
        undefined,
        accounts
      )
    ).toEqual({ status: "linked", accountId: "account-1", reason: "name_match_exact" });
  });

  it("rescues Magna-Germany style country-suffix collisions via exact normalized match", () => {
    // normalizeCompany() strips the generic "germany" / "usa" suffix, so both
    // accounts companiesMatch the deal. The exact-normalized tie-breaker
    // picks the one whose raw name actually equals the deal's customer_name.
    const accounts = [
      { id: "account-germany", account_name: "Magna International, Germany" },
      { id: "account-usa", account_name: "Magna International, USA" },
    ];

    expect(
      resolveDealAccountLink(
        deal({ account_id: null, customer_name: "Magna International, Germany" }),
        new Map(),
        new Map(),
        undefined,
        accounts
      )
    ).toEqual({
      status: "linked",
      accountId: "account-germany",
      reason: "name_match_exact",
    });
  });

  it("still marks unresolvable name matches as ambiguous", () => {
    const accounts = [
      { id: "account-1", account_name: "Magna International Plant" },
      { id: "account-2", account_name: "Magna International Germany Plant" },
    ];

    const result = resolveDealAccountLink(
      deal({ account_id: null, customer_name: "Magna International" }),
      new Map(),
      new Map(),
      undefined,
      accounts
    );
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.reason).toBe("multiple_name_matches");
      expect(result.accountIds.sort()).toEqual(["account-1", "account-2"]);
    }
  });

  it("prefers deal.account_id over a name match", () => {
    const accounts = [{ id: "account-name-match", account_name: "Volvo AB" }];
    expect(
      resolveDealAccountLink(
        deal({ account_id: "account-fk", customer_name: "Volvo AB" }),
        new Map(),
        new Map(),
        undefined,
        accounts
      )
    ).toEqual({ status: "linked", accountId: "account-fk", reason: "deal_account" });
  });

  it("unions candidates from customer_name AND lead_name (regression #15)", () => {
    // Previous behavior short-circuited on the first name that yielded any
    // candidates, so a wrong-first-name fuzzy hit prevented the correct
    // second-name match from ever being attempted. The union preserves both.
    const accounts = [
      { id: "account-lead", account_name: "Acme Robotics" },
    ];
    const result = resolveDealAccountLink(
      deal({ account_id: null, customer_name: null, lead_name: "Acme Robotics" }),
      new Map(),
      new Map(),
      undefined,
      accounts
    );
    expect(result).toEqual({ status: "linked", accountId: "account-lead", reason: "name_match" });
  });
});


describe("buildAccountLinkedDealMap", () => {
  it("does not link similar account names without IDs", () => {
    const accounts: AccountLinkTarget[] = [
      { id: "account-a", account_name: "Volvo AB" },
      { id: "account-b", account_name: "Volvo Trucks" },
    ];
    const deals = [deal({ id: "deal-1", account_id: "account-a", customer_name: "Volvo Trucks" })];

    const linked = buildAccountLinkedDealMap(accounts, deals, [], [], []);

    expect(linked["account-a"].map((d) => d.id)).toEqual(["deal-1"]);
    expect(linked["account-b"]).toEqual([]);
  });

  it("keeps total account links at or below total deals", () => {
    const accounts: AccountLinkTarget[] = [
      { id: "account-a", account_name: "Volvo AB" },
      { id: "account-b", account_name: "Volvo Trucks" },
      { id: "account-c", account_name: "Siemens / Volvo Trucks" },
    ];
    const deals = [
      deal({ id: "deal-1", account_id: "account-a", customer_name: "Volvo" }),
      deal({ id: "deal-2", account_id: null, champion_contact_id: "contact-1" }),
      deal({ id: "deal-3", account_id: null }),
    ];
    const contacts = [contact({ id: "contact-1", account_id: "account-b" })];
    const stakeholders: DealStakeholderLink[] = [];

    const linked = buildAccountLinkedDealMap(accounts, deals, contacts, stakeholders, []);
    const totalLinks = Object.values(linked).reduce((sum, accountDeals) => sum + accountDeals.length, 0);

    expect(totalLinks).toBeLessThanOrEqual(deals.length);
    // deal-3 (customer "Volvo AB", no account_id, no contact) now resolves to
    // "Volvo AB" via the exact-normalized name-match tie-breaker instead of
    // being silently dropped as ambiguous.
    expect(linked["account-a"].map((d) => d.id).sort()).toEqual(["deal-1", "deal-3"]);
    expect(linked["account-b"].map((d) => d.id)).toEqual(["deal-2"]);
    expect(linked["account-c"]).toEqual([]);
  });
});