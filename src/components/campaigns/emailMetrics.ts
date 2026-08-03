/**
 * Unified email metric helpers.
 *
 * Single source of truth used by Outreach (CampaignCommunications),
 * Analytics (CampaignAnalytics) and Overview (CampaignOverview /
 * EmailEngagementWidget) so the same campaign produces the same
 * Sent / Delivered / Opened / Replied / Bounced / Failed numbers
 * everywhere.
 *
 * Counting rules (locked):
 *  - Outbound  = sent_via in ('azure','manual','sequence_runner',
 *                'follow_up_automation') AND not a bounce/NDR row.
 *  - Inbound   = sent_via='graph-sync' AND subject is not an NDR pattern
 *                AND no bounce flags.
 *  - Bounce    = email_status='Bounced' OR bounced_at OR bounce_reason
 *                OR bounce_type, OR a graph-sync row whose subject matches
 *                the NDR pattern.
 *  - Failed    = email_status='Failed' AND not a bounce.
 *  - Sent      = unique outbound messages, deduped by internet_message_id
 *                (fallback: message_id, send_request_id, row id) so Outlook
 *                resync cannot inflate the number.
 *  - Delivered = max(0, Sent − Bounced − Failed).
 *  - Replied   = unique conversation_id with at least one real inbound,
 *                EXCLUDING any conversation that contains a bounce row.
 *  - Opened    = unique outbound messages with opened_at && !is_bot_open
 *                (or open_count > 0), capped at Delivered.
 */

export const NDR_SUBJECT =
  /^(undeliverable:|undelivered:|mail delivery failed|failure notice|returned mail|delivery status notification|could not be delivered)/i;

export const isBounceMessage = (m: any): boolean =>
  m?.email_status === "Bounced" ||
  !!m?.bounced_at ||
  !!m?.bounce_reason ||
  !!m?.bounce_type ||
  (m?.sent_via === "graph-sync" && NDR_SUBJECT.test(String(m?.subject || "")));

export const isFailedSendMessage = (m: any): boolean =>
  m?.email_status === "Failed" && !isBounceMessage(m);

/** sent_via values that represent an outbound send (manual, interactive, or automated). */
export const OUTBOUND_SENT_VIA = new Set([
  "azure",
  "manual",
  "sequence_runner",
  "follow_up_automation",
]);

/** sent_via values that represent an automated outbound send (excludes manual/azure user sends). */
export const AUTOMATED_SENT_VIA = new Set(["sequence_runner", "follow_up_automation"]);

export const isOutboundEmail = (m: any): boolean =>
  m?.communication_type === "Email" &&
  (OUTBOUND_SENT_VIA.has(m?.sent_via) || !m?.sent_via);

export const isProviderOutboundEmail = (m: any): boolean =>
  m?.communication_type === "Email" &&
  (m?.sent_via === "azure" ||
    m?.sent_via === "sequence_runner" ||
    m?.sent_via === "follow_up_automation");

export const isAutomatedOutboundEmail = (m: any): boolean =>
  m?.communication_type === "Email" && AUTOMATED_SENT_VIA.has(m?.sent_via);

export const isRealReplyMessage = (m: any): boolean => {
  if (m?.communication_type !== "Email") return false;
  if (m?.sent_via !== "graph-sync") return false;
  if (isBounceMessage(m)) return false;
  if (isFailedSendMessage(m)) return false;
  if (NDR_SUBJECT.test(String(m?.subject || ""))) return false;
  return true;
};

export const isDeliveredMessage = (m: any): boolean =>
  isOutboundEmail(m) &&
  !isBounceMessage(m) &&
  !isFailedSendMessage(m) &&
  (m?.delivery_status === "sent" ||
    m?.email_status === "Sent" ||
    m?.email_status === "Replied" ||
    m?.sent_via === "azure" ||
    m?.sent_via === "sequence_runner" ||
    m?.sent_via === "follow_up_automation");

export const isOpenedMessage = (m: any): boolean =>
  isDeliveredMessage(m) &&
  !m?.is_bot_open &&
  (!!m?.opened_at || Number(m?.open_count || 0) > 0 || !!m?.last_opened_at);

export const messageDedupeKey = (m: any): string =>
  String(m?.internet_message_id || m?.message_id || m?.send_request_id || m?.id || "");

export const uniqueOutboundMessages = <T extends Record<string, any>>(rows: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (!isOutboundEmail(r)) continue;
    const k = messageDedupeKey(r);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
};

export interface EmailStats {
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  bounced: number;
  failed: number;
  manualLogged: number;
  /** Subset of `sent` produced by sequence_runner / follow_up_automation. */
  automatedSent: number;
  bouncedConvIds: Set<string>;
  repliedConvIds: Set<string>;
}

/**
 * Computes unified email stats from a list of campaign_communications rows
 * (filtered or unfiltered — caller decides the time/segment scope).
 */
export function computeEmailStats(comms: any[]): EmailStats {
  const emails = comms.filter((c) => c?.communication_type === "Email");

  const bouncedConvIds = new Set<string>();
  for (const c of emails) {
    if (!c.conversation_id) continue;
    if (isBounceMessage(c)) bouncedConvIds.add(c.conversation_id);
  }

  const outboundUnique = uniqueOutboundMessages(emails);

  const bounced = outboundUnique.filter(isBounceMessage).length +
    emails.filter(
      (m) =>
        m.sent_via === "graph-sync" &&
        NDR_SUBJECT.test(String(m.subject || "")),
    ).length;

  const failed = outboundUnique.filter(isFailedSendMessage).length;

  const sent = outboundUnique.length;
  const delivered = Math.max(0, sent - bounced - failed);

  const openedRaw = outboundUnique.filter(isOpenedMessage).length;
  const opened = Math.min(delivered, openedRaw);

  const repliedConvIds = new Set<string>();
  for (const c of emails) {
    if (!isRealReplyMessage(c)) continue;
    const cid = c.conversation_id;
    if (!cid) continue;
    if (bouncedConvIds.has(cid)) continue;
    repliedConvIds.add(cid);
  }
  const replied = Math.min(sent, repliedConvIds.size);

  const manualLogged = emails.filter(
    (c) => (c.sent_via || "manual") === "manual" && !isBounceMessage(c),
  ).length;

  const automatedSent = outboundUnique.filter((m: any) =>
    AUTOMATED_SENT_VIA.has(m?.sent_via),
  ).length;

  return {
    sent,
    delivered,
    opened,
    replied,
    bounced,
    failed,
    manualLogged,
    automatedSent,
    bouncedConvIds,
    repliedConvIds,
  };
}

