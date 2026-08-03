import { describe, expect, it } from "vitest";
import { buildContactLinkedDealMap, type ContactLinkedDealsContext } from "./contactLinkedDeals";
import type { ContactLinkTarget, LinkableContact, LinkedDeal } from "./dealLinkMatching";

const deal = (overrides: Partial<LinkedDeal>): LinkedDeal => ({
  id: "deal-1",
  project_name: "Test Deal",
  customer_name: null,
  lead_name: null,
  stage: "RFQ",
  total_contract_value: 100,
  account_id: null,
  ...overrides,
});

const contact = (overrides: Partial<LinkableContact>): LinkableContact => ({
  id: "contact-1",
  contact_name: "C",
  company_name: null,
  account_id: null,
  ...overrides,
});

const buildContext = (
  deals: LinkedDeal[],
  contacts: LinkableContact[],
  _accounts: Array<{ id: string; account_name: string | null }> = [],
  stakeholderPairs: Array<[string, string]> = []
): ContactLinkedDealsContext => {
  const stakeholderContactIdsByDeal = new Map<string, string[]>();
  stakeholderPairs.forEach(([dealId, contactId]) => {
    stakeholderContactIdsByDeal.set(dealId, [
      ...(stakeholderContactIdsByDeal.get(dealId) || []),
      contactId,
    ]);
  });

  return {
    allDeals: deals,
    allContacts: contacts,
    stakeholderContactIdsByDeal,
    campaignContactById: new Map(),
  };
};

const targets = (cs: LinkableContact[]): ContactLinkTarget[] =>
  cs.map((c) => ({ id: c.id, contact_name: c.contact_name, company_name: c.company_name, account_id: c.account_id }));

describe("buildContactLinkedDealMap", () => {
  it("does NOT fan a deal out to every contact that shares the deal's account", () => {
    const deals = [deal({ id: "d1", account_id: "acc-a" })];
    const contacts = [
      contact({ id: "c1", account_id: "acc-a" }),
      contact({ id: "c2", account_id: "acc-a" }),
    ];
    const ctx = buildContext(deals, contacts);

    const linked = buildContactLinkedDealMap(targets(contacts), ctx);
    expect(linked["c1"]).toEqual([]);
    expect(linked["c2"]).toEqual([]);
  });

  it("links a deal to a contact referenced by a deal direct-contact field", () => {
    const deals = [deal({ id: "d1", champion_contact_id: "c1" })];
    const contacts = [contact({ id: "c1" }), contact({ id: "c2" })];
    const ctx = buildContext(deals, contacts);

    const linked = buildContactLinkedDealMap(targets(contacts), ctx);
    expect(linked["c1"].map((d) => d.id)).toEqual(["d1"]);
    expect(linked["c2"]).toEqual([]);
  });

  it("attaches stakeholder-only deals (no account) to that contact", () => {
    const deals = [deal({ id: "d1" })];
    const contacts = [contact({ id: "c1" }), contact({ id: "c2" })];
    const ctx = buildContext(deals, contacts, [], [["d1", "c1"]]);

    const linked = buildContactLinkedDealMap(targets(contacts), ctx);
    expect(linked["c1"].map((d) => d.id)).toEqual(["d1"]);
    expect(linked["c2"]).toEqual([]);
  });

  it("does NOT use company_name fallback for contacts without account_id", () => {
    const deals = [deal({ id: "d1", customer_name: "Bosch Mobility Solutions" })];
    const contacts = [contact({ id: "c1", company_name: "Bosch", account_id: null })];
    const ctx = buildContext(deals, contacts);

    const linked = buildContactLinkedDealMap(targets(contacts), ctx);
    expect(linked["c1"]).toEqual([]);
  });

  it("links a deal to a contact via lead_name (single name match, no accounts)", () => {
    const deals = [deal({ id: "d1", lead_name: "Jagdish Mishra" })];
    const contacts = [contact({ id: "c1", contact_name: "Jagdish Mishra" }), contact({ id: "c2", contact_name: "Other Person" })];
    const ctx = buildContext(deals, contacts);

    const linked = buildContactLinkedDealMap(targets(contacts), ctx);
    expect(linked["c1"].map((d) => d.id)).toEqual(["d1"]);
    expect(linked["c2"]).toEqual([]);
  });

  it("restricts lead_name matches to the deal's account when both have account_id", () => {
    const deals = [deal({ id: "d1", lead_name: "John Doe", account_id: "acc-a" })];
    const contacts = [
      contact({ id: "c1", contact_name: "John Doe", account_id: "acc-a" }),
      contact({ id: "c2", contact_name: "John Doe", account_id: "acc-b" }),
    ];
    const ctx = buildContext(deals, contacts);

    const linked = buildContactLinkedDealMap(targets(contacts), ctx);
    expect(linked["c1"].map((d) => d.id)).toEqual(["d1"]);
    expect(linked["c2"]).toEqual([]);
  });

  it("falls back to all lead_name matches when no candidate shares the deal account", () => {
    const deals = [deal({ id: "d1", lead_name: "John Doe", account_id: null })];
    const contacts = [
      contact({ id: "c1", contact_name: "John Doe", account_id: null }),
      contact({ id: "c2", contact_name: "John Doe", account_id: null }),
    ];
    const ctx = buildContext(deals, contacts);

    const linked = buildContactLinkedDealMap(targets(contacts), ctx);
    expect(linked["c1"].map((d) => d.id)).toEqual(["d1"]);
    expect(linked["c2"].map((d) => d.id)).toEqual(["d1"]);
  });

  it("ignores lead_name placeholders like '-' and 'n/a'", () => {
    const deals = [deal({ id: "d1", lead_name: "-" }), deal({ id: "d2", lead_name: "n/a" })];
    const contacts = [contact({ id: "c1", contact_name: "-" })];
    const ctx = buildContext(deals, contacts);

    const linked = buildContactLinkedDealMap(targets(contacts), ctx);
    expect(linked["c1"]).toEqual([]);
  });
});

