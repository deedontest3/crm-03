import { describe, it, expect } from "vitest";
import { computeEmailStats } from "../emailMetrics";

const make = (over: Record<string, any> = {}) => ({
  communication_type: "Email",
  sent_via: "azure",
  ...over,
});

describe("computeEmailStats", () => {
  it("dedupes Outlook resync duplicates by internet_message_id", () => {
    const comms = [
      make({ id: "a", internet_message_id: "MSG-1", conversation_id: "c1" }),
      make({ id: "b", internet_message_id: "MSG-1", conversation_id: "c1" }),
      make({ id: "c", internet_message_id: "MSG-2", conversation_id: "c2" }),
    ];
    expect(computeEmailStats(comms).sent).toBe(2);
  });

  it("excludes graph-sync NDR rows from Sent and Replied", () => {
    const comms = [
      make({ id: "out", internet_message_id: "MSG-1", conversation_id: "c1" }),
      make({
        id: "ndr",
        sent_via: "graph-sync",
        subject: "Undeliverable: Hello",
        conversation_id: "c1",
      }),
    ];
    const s = computeEmailStats(comms);
    expect(s.sent).toBe(1);
    expect(s.replied).toBe(0);
    expect(s.bounced).toBe(1);
  });

  it("excludes bounced conversations from Replied even with a real inbound", () => {
    const comms = [
      make({ id: "out", internet_message_id: "MSG-1", conversation_id: "c1" }),
      make({
        id: "bounce",
        email_status: "Bounced",
        bounced_at: "2026-01-01T00:00:00Z",
        conversation_id: "c1",
      }),
      make({
        id: "auto",
        sent_via: "graph-sync",
        subject: "Out of office",
        conversation_id: "c1",
      }),
    ];
    const s = computeEmailStats(comms);
    expect(s.bounced).toBeGreaterThanOrEqual(1);
    expect(s.replied).toBe(0);
  });

  it("counts a real reply once per conversation", () => {
    const comms = [
      make({ id: "out", internet_message_id: "MSG-1", conversation_id: "c1" }),
      make({
        id: "reply1",
        sent_via: "graph-sync",
        subject: "Re: Hello",
        conversation_id: "c1",
      }),
      make({
        id: "reply2",
        sent_via: "graph-sync",
        subject: "Re: Hello",
        conversation_id: "c1",
      }),
    ];
    expect(computeEmailStats(comms).replied).toBe(1);
  });

  it("ignores bot opens", () => {
    const comms = [
      make({
        id: "out",
        internet_message_id: "MSG-1",
        delivery_status: "sent",
        opened_at: "2026-01-01T00:00:00Z",
        is_bot_open: true,
      }),
    ];
    expect(computeEmailStats(comms).opened).toBe(0);
  });

  it("counts manual rows under manualLogged, not Sent provider numbers", () => {
    const comms = [
      make({ id: "manual", sent_via: "manual" }),
      make({ id: "azure", internet_message_id: "MSG-1", sent_via: "azure" }),
    ];
    const s = computeEmailStats(comms);
    expect(s.manualLogged).toBe(1);
    // Manual is included in outbound because the user logged it themselves.
    expect(s.sent).toBe(2);
  });

  it("counts sequence_runner sends as outbound and tracks them as automatedSent", () => {
    const comms = [
      make({
        id: "seq1",
        sent_via: "sequence_runner",
        internet_message_id: "MSG-SEQ-1",
        conversation_id: "c1",
        delivery_status: "sent",
      }),
      make({
        id: "seq2",
        sent_via: "sequence_runner",
        internet_message_id: "MSG-SEQ-2",
        conversation_id: "c2",
        delivery_status: "sent",
      }),
      make({ id: "manual1", sent_via: "manual" }),
    ];
    const s = computeEmailStats(comms);
    expect(s.sent).toBe(3);
    expect(s.automatedSent).toBe(2);
    expect(s.delivered).toBe(3);
  });

  it("counts a reply landing on a sequence_runner parent thread", () => {
    const comms = [
      make({
        id: "seq1",
        sent_via: "sequence_runner",
        internet_message_id: "MSG-SEQ-1",
        conversation_id: "cseq",
        delivery_status: "sent",
      }),
      make({
        id: "reply",
        sent_via: "graph-sync",
        subject: "Re: Hello",
        conversation_id: "cseq",
      }),
    ];
    const s = computeEmailStats(comms);
    expect(s.sent).toBe(1);
    expect(s.replied).toBe(1);
  });

  it("counts a failed sequence_runner send under failed, not sent-as-delivered", () => {
    const comms = [
      make({
        id: "seq-fail",
        sent_via: "sequence_runner",
        internet_message_id: "MSG-SEQ-X",
        email_status: "Failed",
      }),
    ];
    const s = computeEmailStats(comms);
    expect(s.sent).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.delivered).toBe(0);
  });

  it("counts follow_up_automation sends as outbound", () => {
    const comms = [
      make({
        id: "fua",
        sent_via: "follow_up_automation",
        internet_message_id: "MSG-FUA-1",
        delivery_status: "sent",
      }),
    ];
    const s = computeEmailStats(comms);
    expect(s.sent).toBe(1);
    expect(s.automatedSent).toBe(1);
  });
});
