// db-cleanup-scan: scans selected modules for cleanup opportunities.
// Designed to stay well under Edge Function wall-time by:
//  - Letting the client pick which modules to scan (no forced full scan).
//  - Using count: 'estimated' / head probes instead of full pulls where possible.
//  - Capping per-table fetches and per-bucket findings.
import { adminGate } from '../_shared/safety-backup.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type Severity = 'low' | 'medium' | 'high';
type Rule = 'duplicate' | 'incomplete' | 'orphan' | 'stale';

interface Finding {
  id: string;
  module: string;
  rule: Rule;
  severity: Severity;
  title: string;
  description: string;
  recordIds: string[];
  preview: Record<string, any>;
  table: string;
  missingFields?: string[];
}

const DAY = 24 * 60 * 60 * 1000;
const MAX_ROWS_PER_TABLE = 3000;
const MAX_FINDINGS_PER_BUCKET = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function lastActivityTs(row: any): number {
  const v = row?.updated_at ?? row?.modified_at ?? row?.created_at;
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

interface ScanState {
  truncated: Set<string>;
  missingTables: Set<string>;
  bucketCounts: Map<string, number>;
  overflow: Map<string, number>;
  findings: Finding[];
  fetchErrors: Record<string, string>;
}

async function fetchAll(
  client: any,
  table: string,
  select = '*',
  filter?: (q: any) => any,
  cap = MAX_ROWS_PER_TABLE,
  state?: ScanState,
) {
  const rows: any[] = [];
  let from = 0;
  const size = 1000;
  while (rows.length < cap) {
    const remaining = cap - rows.length;
    const pageSize = Math.min(size, remaining);
    let q = client.from(table).select(select).range(from, from + pageSize - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) {
      const msg = String((error as any).message || (error as any).code || error);
      if (state) {
        if (/relation .* does not exist|not found|PGRST20[12]|42P01/i.test(msg)) {
          state.missingTables.add(table);
        } else {
          state.fetchErrors[table] = msg;
        }
      }
      break;
    }
    if (!data) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  if (state && rows.length >= cap) state.truncated.add(table);
  return rows;
}

// True only when we can trust "X not in parent => orphan" inference.
function parentIsComplete(state: ScanState, parentTable: string): boolean {
  return !state.truncated.has(parentTable) && !state.missingTables.has(parentTable);
}

function groupBy<T>(arr: T[], key: (x: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function bucketOk(state: ScanState, module: string, rule: Rule): boolean {
  const key = `${module}::${rule}`;
  const n = state.bucketCounts.get(key) || 0;
  if (n >= MAX_FINDINGS_PER_BUCKET) {
    state.overflow.set(key, (state.overflow.get(key) || 0) + 1);
    return false;
  }
  state.bucketCounts.set(key, n + 1);
  return true;
}

// Normalisation helpers for fuzzy duplicate detection.
const LEGAL_SUFFIXES = /\b(inc|llc|ltd|limited|gmbh|sa|s\.?a\.?|ag|plc|co|corp|corporation|company|pvt|private|group|holdings?|bv|nv|kg|ohg|s\.?l\.?|sarl|spa)\b\.?/gi;

function normalizeCompany(raw: any): string {
  if (typeof raw !== 'string') return '';
  return raw
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/&/g, ' and ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function apexDomain(raw: any): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  const parts = s.split('.').filter(Boolean);
  if (parts.length <= 2) return s;
  return parts.slice(-2).join('.');
}

function pushDup(state: ScanState, module: string, table: string, label: string, rows: any[], previewKeys: string[]) {
  if (rows.length < 2) return;
  if (!bucketOk(state, module, 'duplicate')) return;
  const preview: Record<string, any> = {};
  for (const k of previewKeys) preview[k] = rows[0][k];
  preview._count = rows.length;
  state.findings.push({
    id: `${module}-dup-${rows[0].id}`,
    module, table, rule: 'duplicate',
    severity: rows.length > 3 ? 'high' : 'medium',
    title: `Duplicate ${module}: "${label || '(blank)'}" (${rows.length} copies)`,
    description: `Found ${rows.length} records with the same key fields`,
    recordIds: rows.map((r) => r.id),
    preview,
  });
}

function pushIncomplete(state: ScanState, module: string, table: string, row: any, missing: string[], nameField: string) {
  if (!bucketOk(state, module, 'incomplete')) return;
  // Severity tuned by field criticality, not raw count.
  //   HIGH    — missing identifier / money-impacting field
  //   MEDIUM  — missing operational field (owner, dates)
  //   LOW     — missing descriptors (industry/region/country)
  const HIGH = new Set(['email', 'phone_no', 'stage', 'value']);
  const MEDIUM = new Set(['owner', 'due_date', 'expected_closing_date', 'assigned_to', 'start_date', 'end_date', 'goal']);
  const hasHigh = missing.some((m) => HIGH.has(m));
  const hasMedium = missing.some((m) => MEDIUM.has(m));
  const severity: Severity = hasHigh ? 'high' : hasMedium ? 'medium' : 'low';
  state.findings.push({
    id: `${module}-inc-${row.id}`,
    module, table, rule: 'incomplete',
    severity,
    title: `Incomplete ${module}: ${row[nameField] || '(unnamed)'}`,
    description: `Missing: ${missing.join(', ')}`,
    recordIds: [row.id],
    preview: { [nameField]: row[nameField], missing },
    missingFields: missing,
  });
}

function pushOrphan(state: ScanState, module: string, table: string, row: any, reason: string, nameField: string) {
  if (!bucketOk(state, module, 'orphan')) return;
  state.findings.push({
    // Deterministic: stable across re-scans so dismissals persist.
    id: `${module}-orph-${table}-${row.id}`,
    module, table, rule: 'orphan',
    severity: 'medium',
    title: `Orphan ${module}: ${row[nameField] || '(unnamed)'}`,
    description: reason,
    recordIds: [row.id],
    preview: { [nameField]: row[nameField], reason },
  });
}

function pushStale(state: ScanState, module: string, table: string, row: any, reason: string, nameField: string) {
  if (!bucketOk(state, module, 'stale')) return;
  state.findings.push({
    id: `${module}-stale-${table}-${row.id}`,
    module, table, rule: 'stale',
    severity: 'low',
    title: `Stale ${module}: ${row[nameField] || '(unnamed)'}`,
    description: reason,
    recordIds: [row.id],
    preview: { [nameField]: row[nameField], reason },
  });
}

// ---------------- Normalization helpers ----------------

function normalizeEmail(raw: any): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  const [local, domain] = trimmed.split('@');
  if (!domain) return trimmed;
  // Strip +suffix universally; dots only for gmail-class domains.
  const localNoTag = local.split('+')[0];
  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';
  const localFinal = isGmail ? localNoTag.replace(/\./g, '') : localNoTag;
  return `${localFinal}@${domain}`;
}

function normalizePhone(raw: any): string {
  if (typeof raw !== 'string') return '';
  // Keep leading + then digits only; collapse to last 10 if no country code so
  // "+1 555 555-0123" and "5555550123" cluster together.
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

// ---------------- CRM scanners ----------------

async function scanAccounts(client: any, state: ScanState) {
  // FK-based orphan: account has no children pointing at its id.
  const [accounts, contactsFk, dealsFk, campaignAccountsFk] = await Promise.all([
    fetchAll(client, 'accounts', '*', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'contacts', 'id, account_id', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'deals', 'id, account_id', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'campaign_accounts', 'account_id', undefined, MAX_ROWS_PER_TABLE, state).catch(() => [] as any[]),
  ]);
  const accountsWithContacts = new Set(contactsFk.map((c: any) => c.account_id).filter(Boolean));
  const accountsWithDeals = new Set(dealsFk.map((d: any) => d.account_id).filter(Boolean));
  const accountsInCampaigns = new Set(campaignAccountsFk.map((c: any) => c.account_id).filter(Boolean));

  const dupMap = groupBy(accounts, (a: any) => {
    const n = normalizeCompany(a.account_name);
    const w = apexDomain(a.website);
    return n ? `${n}||${w}` : null;
  });
  for (const [, rows] of dupMap) pushDup(state, 'accounts', 'accounts', rows[0].account_name, rows, ['account_name', 'website', 'industry']);

  for (const a of accounts) {
    const missing: string[] = [];
    if (!a.industry) missing.push('industry');
    if (!a.region) missing.push('region');
    if (!a.country) missing.push('country');
    if (missing.length) pushIncomplete(state, 'accounts', 'accounts', a, missing, 'account_name');

    // Only flag orphans when we can trust the child sets are complete.
    const childrenTrusted = parentIsComplete(state, 'contacts')
      && parentIsComplete(state, 'deals');
    const linked = accountsWithContacts.has(a.id) || accountsWithDeals.has(a.id) || accountsInCampaigns.has(a.id);
    if (childrenTrusted && !linked) {
      pushOrphan(state, 'accounts', 'accounts', a, 'No contacts, deals, or campaigns linked via account_id', 'account_name');
    }

    const last = lastActivityTs(a);
    if (last && Date.now() - last > 365 * DAY) {
      pushStale(state, 'accounts', 'accounts', a, `No activity in ${Math.floor((Date.now() - last) / DAY)} days`, 'account_name');
    }
  }
}

async function scanContacts(client: any, state: ScanState) {
  const [contacts, accounts] = await Promise.all([
    fetchAll(client, 'contacts', '*', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'accounts', 'id', undefined, MAX_ROWS_PER_TABLE, state),
  ]);
  const accountIds = new Set(accounts.map((a: any) => a.id));

  const emailDup = groupBy(contacts, (c: any) => normalizeEmail(c.email) || null);
  for (const [, rows] of emailDup) pushDup(state, 'contacts', 'contacts', rows[0].email, rows, ['contact_name', 'email', 'company_name']);

  const phoneDup = groupBy(contacts, (c: any) => normalizePhone(c.phone_no || c.phone) || null);
  for (const [, rows] of phoneDup) pushDup(state, 'contacts', 'contacts', rows[0].phone_no || rows[0].phone, rows, ['contact_name', 'phone_no', 'company_name']);

  for (const c of contacts) {
    const missing: string[] = [];
    if (!c.email) missing.push('email');
    if (!c.phone_no && !c.phone) missing.push('phone_no');
    if (!c.company_name) missing.push('company_name');
    if (missing.length) pushIncomplete(state, 'contacts', 'contacts', c, missing, 'contact_name');

    // FK-based orphan only when parent fetch wasn't truncated.
    if (c.account_id && parentIsComplete(state, 'accounts') && !accountIds.has(c.account_id)) {
      pushOrphan(state, 'contacts', 'contacts', c, 'account_id references a deleted account', 'contact_name');
    }

    const last = lastActivityTs(c);
    if (last && Date.now() - last > 365 * DAY) {
      pushStale(state, 'contacts', 'contacts', c, `No activity in ${Math.floor((Date.now() - last) / DAY)} days`, 'contact_name');
    }
  }
}

async function scanDeals(client: any, state: ScanState) {
  const [deals, accounts, contacts, profiles] = await Promise.all([
    fetchAll(client, 'deals', '*', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'accounts', 'id', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'contacts', 'id', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'profiles', 'id', undefined, MAX_ROWS_PER_TABLE, state),
  ]);
  const accountIds = new Set(accounts.map((a: any) => a.id));
  const contactIds = new Set(contacts.map((c: any) => c.id));
  const profileIds = new Set(profiles.map((p: any) => p.id));

  const dupMap = groupBy(deals, (d: any) => {
    const n = (d.deal_name || '').toLowerCase().trim();
    const c = (d.customer_name || '').toLowerCase().trim();
    return n ? `${n}||${c}` : null;
  });
  for (const [, rows] of dupMap) pushDup(state, 'deals', 'deals', rows[0].deal_name, rows, ['deal_name', 'customer_name', 'stage']);

  for (const d of deals) {
    const missing: string[] = [];
    if (!d.stage) missing.push('stage');
    if (d.total_contract_value == null && d.amount == null) missing.push('value');
    if (!d.lead_owner && !d.created_by) missing.push('owner');
    if (!d.expected_closing_date && !['Won', 'Lost', 'Dropped'].includes(d.stage)) missing.push('expected_closing_date');
    if (missing.length) pushIncomplete(state, 'deals', 'deals', d, missing, 'deal_name');

    if (d.created_by && parentIsComplete(state, 'profiles') && !profileIds.has(d.created_by)) {
      pushOrphan(state, 'deals', 'deals', d, 'Owner profile no longer exists', 'deal_name');
    }
    if (d.account_id && parentIsComplete(state, 'accounts') && !accountIds.has(d.account_id)) {
      pushOrphan(state, 'deals', 'deals', d, 'account_id references a deleted account', 'deal_name');
    }
    if (d.contact_id && parentIsComplete(state, 'contacts') && !contactIds.has(d.contact_id)) {
      pushOrphan(state, 'deals', 'deals', d, 'contact_id references a deleted contact', 'deal_name');
    }

    const modified = lastActivityTs(d);
    if (modified && !['Won', 'Lost', 'Dropped'].includes(d.stage) && Date.now() - modified > 365 * DAY) {
      pushStale(state, 'deals', 'deals', d, `Stuck in "${d.stage}" for ${Math.floor((Date.now() - modified) / DAY)} days`, 'deal_name');
    }
    if (['Won', 'Lost', 'Dropped'].includes(d.stage) && modified && Date.now() - modified > 730 * DAY) {
      pushStale(state, 'deals', 'deals', d, `Closed deal older than 2 years`, 'deal_name');
    }
  }
}

async function scanCampaigns(client: any, state: ScanState) {
  const [campaigns, ccRows] = await Promise.all([
    fetchAll(client, 'campaigns', '*', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'campaign_contacts', 'campaign_id', undefined, MAX_ROWS_PER_TABLE, state),
  ]);
  const recipCount = new Map<string, number>();
  for (const r of ccRows) recipCount.set(r.campaign_id, (recipCount.get(r.campaign_id) || 0) + 1);

  const dupMap = groupBy(campaigns, (c: any) => {
    const n = (c.campaign_name || '').toLowerCase().trim();
    const t = (c.campaign_type || '').toLowerCase().trim();
    return n ? `${n}||${t}` : null;
  });
  for (const [, rows] of dupMap) pushDup(state, 'campaigns', 'campaigns', rows[0].campaign_name, rows, ['campaign_name', 'campaign_type', 'status']);

  for (const c of campaigns) {
    const missing: string[] = [];
    if (!c.goal) missing.push('goal');
    if (!c.start_date) missing.push('start_date');
    if (!c.end_date) missing.push('end_date');
    if (missing.length) pushIncomplete(state, 'campaigns', 'campaigns', c, missing, 'campaign_name');

    const recips = recipCount.get(c.id) || 0;
    const created = new Date(c.created_at || 0).getTime();
    if (recips === 0 && c.status === 'draft' && Date.now() - created > 30 * DAY) {
      pushOrphan(state, 'campaigns', 'campaigns', c, 'Draft campaign with 0 recipients for over 30 days', 'campaign_name');
    }
    if (['completed', 'archived'].includes((c.status || '').toLowerCase()) && created && Date.now() - created > 180 * DAY) {
      pushStale(state, 'campaigns', 'campaigns', c, 'Completed campaign older than 180 days', 'campaign_name');
    }
  }
}

async function scanActionItems(client: any, state: ScanState) {
  const [items, dealsRaw, contactsRaw, accountsRaw, campaignsRaw, leadsRaw] = await Promise.all([
    fetchAll(client, 'action_items', '*', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'deals', 'id', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'contacts', 'id', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'accounts', 'id', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'campaigns', 'id', undefined, MAX_ROWS_PER_TABLE, state),
    fetchAll(client, 'leads', 'id', undefined, MAX_ROWS_PER_TABLE, state).catch(() => [] as any[]),
  ]);
  const parentIds: Record<string, Set<string>> = {
    deal: new Set(dealsRaw.map((d: any) => d.id)),
    deals: new Set(dealsRaw.map((d: any) => d.id)),
    contact: new Set(contactsRaw.map((c: any) => c.id)),
    contacts: new Set(contactsRaw.map((c: any) => c.id)),
    account: new Set(accountsRaw.map((a: any) => a.id)),
    accounts: new Set(accountsRaw.map((a: any) => a.id)),
    campaign: new Set(campaignsRaw.map((c: any) => c.id)),
    campaigns: new Set(campaignsRaw.map((c: any) => c.id)),
    lead: new Set(leadsRaw.map((l: any) => l.id)),
    leads: new Set(leadsRaw.map((l: any) => l.id)),
  };

  const dupMap = groupBy(items, (i: any) => {
    const t = (i.title || '').toLowerCase().trim();
    return t ? `${t}||${i.due_date}||${i.module_id}` : null;
  });
  for (const [, rows] of dupMap) pushDup(state, 'action_items', 'action_items', rows[0].title, rows, ['title', 'due_date', 'module_type']);

  for (const i of items) {
    const missing: string[] = [];
    if (!i.due_date) missing.push('due_date');
    if (!i.assigned_to) missing.push('assigned_to');
    if (missing.length) pushIncomplete(state, 'action_items', 'action_items', i, missing, 'title');

    if (i.module_id && i.module_type) {
      const set = parentIds[String(i.module_type).toLowerCase()];
      const parentTable = String(i.module_type).toLowerCase().replace(/s$/, '') + 's';
      if (set && parentIsComplete(state, parentTable) && !set.has(i.module_id)) {
        pushOrphan(state, 'action_items', 'action_items', i, `Linked ${i.module_type} no longer exists`, 'title');
      }
    }

    const updated = lastActivityTs(i);
    if (i.status === 'completed' && updated && Date.now() - updated > 180 * DAY) {
      pushStale(state, 'action_items', 'action_items', i, 'Completed over 180 days ago', 'title');
    }
  }
}

async function scanNotifications(client: any, state: ScanState) {
  const notifs = await fetchAll(
    client, 'notifications',
    'id, user_id, message, status, notification_type, module_type, module_id, created_at',
    undefined, MAX_ROWS_PER_TABLE, state,
  );

  const buckets = new Map<string, any[]>();
  for (const n of notifs) {
    const msg = (n.message || '').trim();
    if (!msg || !n.user_id || !n.created_at) continue;
    const ts = new Date(n.created_at).getTime();
    if (!Number.isFinite(ts)) continue;
    const day = Math.floor(ts / DAY);
    const key = `${n.user_id}||${msg}||${day}`;
    const list = buckets.get(key);
    if (list) list.push(n);
    else buckets.set(key, [n]);
  }
  for (const [, rows] of buckets) pushDup(state, 'notifications', 'notifications', rows[0].message?.slice(0, 40) || '', rows, ['message', 'notification_type']);

  for (const n of notifs) {
    const created = new Date(n.created_at).getTime();
    if (!Number.isFinite(created)) continue;
    if (n.status === 'read' && Date.now() - created > 90 * DAY) {
      pushStale(state, 'notifications', 'notifications', n, 'Read notification older than 90 days', 'message');
    } else if (n.status === 'unread' && Date.now() - created > 180 * DAY) {
      pushStale(state, 'notifications', 'notifications', n, 'Unread notification older than 180 days', 'message');
    }
  }
}

async function scanSettings(client: any, state: ScanState) {
  const profiles = await fetchAll(client, 'profiles', 'id', undefined, MAX_ROWS_PER_TABLE, state);
  const profileIds = new Set(profiles.map((p: any) => p.id));

  try {
    const filters = await fetchAll(client, 'saved_filters', '*', undefined, MAX_ROWS_PER_TABLE, state);
    for (const f of filters) {
      if (f.user_id && !profileIds.has(f.user_id)) {
        pushOrphan(state, 'settings', 'saved_filters', f, 'Saved filter belongs to deleted user', 'name');
      }
      const last = lastActivityTs(f);
      if (last && Date.now() - last > 365 * DAY) {
        pushStale(state, 'settings', 'saved_filters', f, 'Unused saved filter older than 365 days', 'name');
      }
    }
    const dupMap = groupBy(filters, (f: any) => {
      const mod = f.module ?? f.module_type ?? '';
      return f.user_id && f.name ? `${f.user_id}||${mod}||${f.name}` : null;
    });
    for (const [, rows] of dupMap) pushDup(state, 'settings', 'saved_filters', rows[0].name, rows, ['name', 'module']);
  } catch { /* table may not exist */ }

  try {
    const prefs = await fetchAll(client, 'column_preferences', '*', undefined, MAX_ROWS_PER_TABLE, state);
    for (const p of prefs) {
      if (p.user_id && !profileIds.has(p.user_id)) {
        pushOrphan(state, 'settings', 'column_preferences', p, 'Column preferences for deleted user', 'module');
      }
    }
  } catch { /* ignore */ }
}

// ---------------- Logs / audit scanners ----------------

async function scanLogs(client: any, state: ScanState) {
  // security_audit_log: stale entries beyond 365 days
  try {
    const cutoff = new Date(Date.now() - 365 * DAY).toISOString();
    const old = await fetchAll(
      client, 'security_audit_log', 'id, action, resource_type, created_at',
      (q: any) => q.lt('created_at', cutoff).order('created_at', { ascending: true }),
      MAX_ROWS_PER_TABLE, state,
    );
    for (const r of old) {
      pushStale(state, 'logs', 'security_audit_log', { id: r.id, action: r.action }, `Audit entry older than 1 year (${r.action})`, 'action');
    }
  } catch { /* ignore */ }

  // email_reply_skip_log: stale beyond 180 days
  try {
    const cutoff = new Date(Date.now() - 180 * DAY).toISOString();
    const old = await fetchAll(
      client, 'email_reply_skip_log', 'id, skip_reason, subject, created_at',
      (q: any) => q.lt('created_at', cutoff).order('created_at', { ascending: true }),
      MAX_ROWS_PER_TABLE, state,
    );
    for (const r of old) {
      pushStale(state, 'logs', 'email_reply_skip_log', { id: r.id, subject: r.subject || r.skip_reason }, `Skip log older than 180 days`, 'subject');
    }
  } catch { /* ignore */ }

  // email_history: stale beyond 365 days
  try {
    const cutoff = new Date(Date.now() - 365 * DAY).toISOString();
    const old = await fetchAll(
      client, 'email_history', 'id, subject, sent_at, created_at',
      (q: any) => q.lt('created_at', cutoff).order('created_at', { ascending: true }),
      MAX_ROWS_PER_TABLE, state,
    );
    for (const r of old) {
      pushStale(state, 'logs', 'email_history', { id: r.id, subject: r.subject }, `Email history older than 1 year`, 'subject');
    }
  } catch { /* ignore */ }

  // campaign_webhook_deliveries: stale beyond 90 days
  try {
    const cutoff = new Date(Date.now() - 90 * DAY).toISOString();
    const old = await fetchAll(
      client, 'campaign_webhook_deliveries', 'id, status, created_at',
      (q: any) => q.lt('created_at', cutoff).order('created_at', { ascending: true }),
      MAX_ROWS_PER_TABLE, state,
    );
    for (const r of old) {
      pushStale(state, 'logs', 'campaign_webhook_deliveries', { id: r.id, status: r.status }, `Webhook delivery older than 90 days`, 'status');
    }
  } catch { /* ignore */ }
}

// ---------------- Backup scanners ----------------

async function scanBackups(client: any, state: ScanState) {
  // backup_jobs: failed/old
  try {
    const jobs = await fetchAll(client, 'backup_jobs', 'id, kind, status, error, created_at', undefined, MAX_ROWS_PER_TABLE, state);
    for (const j of jobs) {
      const created = new Date(j.created_at).getTime();
      if (j.status === 'failed') {
        pushStale(state, 'backups', 'backup_jobs', { id: j.id, kind: j.kind }, `Failed ${j.kind} job: ${j.error || 'unknown error'}`, 'kind');
      } else if (j.status === 'completed' && created && Date.now() - created > 30 * DAY) {
        pushStale(state, 'backups', 'backup_jobs', { id: j.id, kind: j.kind }, `Completed job older than 30 days`, 'kind');
      } else if (['queued', 'running'].includes(j.status) && created && Date.now() - created > 1 * DAY) {
        pushStale(state, 'backups', 'backup_jobs', { id: j.id, kind: j.kind }, `${j.status} job stuck for over 24h`, 'kind');
      }
    }
  } catch { /* ignore */ }

  // backups: old or failed
  try {
    const backups = await fetchAll(client, 'backups', 'id, file_name, status, created_at', undefined, MAX_ROWS_PER_TABLE, state);
    for (const b of backups) {
      const created = new Date(b.created_at).getTime();
      if (b.status === 'failed') {
        pushStale(state, 'backups', 'backups', { id: b.id, file_name: b.file_name }, `Failed backup`, 'file_name');
      } else if (created && Date.now() - created > 180 * DAY) {
        pushStale(state, 'backups', 'backups', { id: b.id, file_name: b.file_name }, `Backup older than 180 days`, 'file_name');
      }
    }
  } catch { /* ignore */ }
}

// ---------------- Auth / admin scanners ----------------

async function scanAuth(client: any, state: ScanState) {
  // Collect auth users (paged, capped).
  const authUsers: any[] = [];
  let authTruncated = false;
  try {
    let page = 1;
    while (page <= 50) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      const list = data?.users || [];
      authUsers.push(...list);
      if (list.length < 1000) break;
      page += 1;
    }
    // If we hit the 50-page ceiling and the last page was full, we may have more.
    authTruncated = authUsers.length >= 50_000;
    if (authTruncated) state.truncated.add('auth_users');
  } catch { /* ignore */ }
  const authIds = new Set(authUsers.map((u: any) => u.id));

  let profiles: any[] = [];
  try {
    profiles = await fetchAll(client, 'profiles', 'id, full_name, "Email ID", is_deleted, deleted_at, created_at', undefined, MAX_ROWS_PER_TABLE, state);
  } catch { /* ignore */ }
  const profileIds = new Set(profiles.map((p: any) => p.id));

  // Profiles without an auth user → orphan (only when we trust the auth list).
  for (const p of profiles) {
    if (!authTruncated && authIds.size > 0 && !authIds.has(p.id) && !p.is_deleted) {
      pushOrphan(state, 'auth', 'profiles', { id: p.id, full_name: p.full_name || p['Email ID'] }, 'Profile has no matching auth user', 'full_name');
    }
    if (p.is_deleted) {
      pushStale(state, 'auth', 'profiles', { id: p.id, full_name: p.full_name || p['Email ID'] }, `Tombstoned profile (deleted ${p.deleted_at || 'previously'})`, 'full_name');
    }
  }

  // Auth users never signed in, > 90 days old
  for (const u of authUsers) {
    const created = new Date(u.created_at || 0).getTime();
    if (!u.last_sign_in_at && created && Date.now() - created > 90 * DAY) {
      pushStale(state, 'auth', 'auth_users', { id: u.id, email: u.email }, `Auth user never signed in (created ${Math.floor((Date.now() - created) / DAY)} days ago)`, 'email');
    }
    if (u.banned_until) {
      pushStale(state, 'auth', 'auth_users', { id: u.id, email: u.email }, `Deactivated/banned auth user`, 'email');
    }
  }

  // user_roles orphan (no profile/auth user) — only when both parent sets are complete.
  try {
    const roles = await fetchAll(client, 'user_roles', 'id, user_id, role', undefined, MAX_ROWS_PER_TABLE, state);
    const profilesTrusted = parentIsComplete(state, 'profiles');
    for (const r of roles) {
      const noProfile = profilesTrusted && profileIds.size > 0 && !profileIds.has(r.user_id);
      const noAuth = !authTruncated && authIds.size > 0 && !authIds.has(r.user_id);
      if (noProfile && noAuth) {
        pushOrphan(state, 'auth', 'user_roles', { id: r.id, role: r.role }, `Role "${r.role}" references missing user`, 'role');
      }
    }
    // Duplicate user/role pairs
    const dupMap = groupBy(roles, (r: any) => r.user_id && r.role ? `${r.user_id}||${r.role}` : null);
    for (const [, rows] of dupMap) pushDup(state, 'auth', 'user_roles', rows[0].role, rows, ['role', 'user_id']);
  } catch { /* ignore */ }
}

// ---------------- System scanners ----------------

async function scanSystem(client: any, state: ScanState) {
  try {
    const rates = await fetchAll(client, 'currency_rates', '*', undefined, MAX_ROWS_PER_TABLE, state);
    const dupMap = groupBy(rates, (r: any) => {
      const k = `${r.from_currency || r.base || ''}-${r.to_currency || r.quote || ''}-${r.rate_date || ''}`;
      return k.length > 2 ? k : null;
    });
    for (const [, rows] of dupMap) pushDup(state, 'system', 'currency_rates', `${rows[0].from_currency || rows[0].base} → ${rows[0].to_currency || rows[0].quote}`, rows, ['from_currency', 'to_currency', 'rate_date']);
  } catch { /* ignore */ }
}

// ---------------- Runner ----------------

const ALL_RUNNERS: Record<string, (client: any, state: ScanState) => Promise<void>> = {
  accounts: scanAccounts,
  contacts: scanContacts,
  deals: scanDeals,
  campaigns: scanCampaigns,
  action_items: scanActionItems,
  notifications: scanNotifications,
  settings: scanSettings,
  logs: scanLogs,
  backups: scanBackups,
  auth: scanAuth,
  system: scanSystem,
};

const VERSION = '2026-06-21-sync';
const PER_MODULE_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
     .catch((e) => { clearTimeout(t); reject(e); });
  });
}

async function runScanSync(adminClient: any, modulesToRun: string[]) {
  const state: ScanState = {
    truncated: new Set<string>(),
    missingTables: new Set<string>(),
    bucketCounts: new Map<string, number>(),
    overflow: new Map<string, number>(),
    findings: [],
    fetchErrors: {},
  };
  const errors: Record<string, string> = {};

  for (const m of modulesToRun) {
    const runner = ALL_RUNNERS[m];
    if (!runner) continue;
    try {
      await withTimeout(runner(adminClient, state), PER_MODULE_TIMEOUT_MS, `module ${m}`);
    } catch (err: any) {
      errors[m] = String(err?.message || err);
      console.error(`db-cleanup-scan module ${m} failed`, err);
    }
  }

  // Merge per-table fetch errors into module errors so the UI surfaces them.
  for (const [tbl, msg] of Object.entries(state.fetchErrors)) {
    if (!errors[tbl]) errors[tbl] = msg;
  }

  // Emit aggregate findings for buckets that overflowed, so 2k+ hidden rows
  // aren't silently dropped any more.
  for (const [bucketKey, hiddenCount] of state.overflow) {
    const [module, rule] = bucketKey.split('::') as [string, Rule];
    state.findings.push({
      id: `${module}-${rule}-overflow`,
      module,
      table: module,
      rule,
      severity: 'low',
      title: `${hiddenCount.toLocaleString()} more ${rule} ${module} hidden by per-bucket cap`,
      description: `Showing first ${MAX_FINDINGS_PER_BUCKET}. Use the module page to triage the rest.`,
      recordIds: [],
      preview: { hiddenCount, cap: MAX_FINDINGS_PER_BUCKET, aggregate: true },
      // @ts-ignore - aggregate flag consumed by the client
      aggregate: true,
    });
  }

  const totals: Record<string, number> = {};
  for (const f of state.findings) totals[f.module] = (totals[f.module] || 0) + 1;
  const overflow: Record<string, number> = {};
  for (const [k, v] of state.overflow) overflow[k] = v;

  return {
    scannedAt: new Date().toISOString(),
    modules: modulesToRun,
    totals,
    total: state.findings.length,
    findings: state.findings,
    errors,
    truncatedTables: Array.from(state.truncated),
    overflow,
    version: VERSION,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);

    // Health endpoint — no auth required, used to confirm deploy.
    if (url.searchParams.get('health') === '1') {
      return json({ ok: true, version: VERSION, modules: Object.keys(ALL_RUNNERS) });
    }

    const supabaseUrl = Deno.env.get('MY_SUPABASE_URL') || Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('MY_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: 'Edge function is missing Supabase environment variables' }, 500);
    }

    const gate = await adminGate(req, supabaseUrl, anonKey, serviceRoleKey);
    if ('error' in gate) return json({ error: gate.error }, gate.status);
    const { adminClient } = gate;

    let body: any = {};
    try { body = await req.json(); } catch { /* GET / empty */ }

    const requested: string[] | undefined = Array.isArray(body.modules) && body.modules.length > 0
      ? body.modules.filter((m: any) => typeof m === 'string' && m in ALL_RUNNERS)
      : undefined;
    const modulesToRun = requested && requested.length > 0 ? requested : Object.keys(ALL_RUNNERS);

    const result = await runScanSync(adminClient, modulesToRun);
    return json(result);
  } catch (e: any) {
    console.error('db-cleanup-scan fatal', e);
    return json({ error: e?.message || String(e), version: VERSION }, 500);
  }
});

