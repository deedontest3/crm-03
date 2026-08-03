import { expandRegionsForDb } from "@/utils/countryRegionMapping";

export type SegmentFilters = {
  industries?: string[];
  regions?: string[];
  countries?: string[];
  positions?: string[];
  excludes?: {
    industries?: string[];
    regions?: string[];
    countries?: string[];
  };
};

const lc = (v: any): string => String(v ?? "").toLowerCase();

/** Tokenize a position string into word tokens for word-boundary matching. */
const tokenize = (s: string): string[] =>
  String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9+]+/i)
    .filter(Boolean);

/** A position matches when every token in the filter exists as a token in the value. */
const positionMatches = (value: any, filter: string): boolean => {
  const valueTokens = new Set(tokenize(String(value)));
  const filterTokens = tokenize(filter);
  if (filterTokens.length === 0) return false;
  return filterTokens.every((t) => valueTokens.has(t));
};

/**
 * Returns true if a campaign_contact row (with joined contacts/accounts) matches the segment filters.
 * Used by both Audience preview and Monitoring filtering.
 *
 * Region matching uses `expandRegionsForDb` so a segment filter "EMEA"/"Europe"
 * matches accounts stored under any aliased DB code (e.g. "EU"). Position
 * matching uses word-boundary tokens to avoid false positives like
 * "VP" matching "Developer (VP project)".
 */
export function matchesSegmentFilters(cc: any, f: SegmentFilters | null | undefined): boolean {
  if (!f) return true;
  const contact = cc?.contacts || cc;
  const account = cc?.accounts || {};

  const industry = contact?.industry || account?.industry;
  const region = contact?.region || account?.region;
  const country = contact?.country || account?.country;
  const position = contact?.position;

  // Industry / country: simple case-insensitive list membership.
  const inSimpleList = (val: any, list?: string[]) =>
    !list || list.length === 0 || (val && list.some((x) => lc(x) === lc(val)));

  if (!inSimpleList(industry, f.industries)) return false;
  if (!inSimpleList(country, f.countries)) return false;

  // Region: expand UI names → DB codes (EU, ASIA, etc.) so segment + audience query agree.
  if (f.regions && f.regions.length > 0) {
    if (!region) return false;
    const expanded = new Set(expandRegionsForDb(f.regions).map(lc));
    if (!expanded.has(lc(region))) return false;
  }

  // Position: tokenized word-boundary match.
  if (f.positions && f.positions.length > 0) {
    if (!position) return false;
    const hit = f.positions.some((p) => positionMatches(position, p));
    if (!hit) return false;
  }

  const ex = f.excludes;
  if (ex) {
    if (ex.industries?.length && industry && ex.industries.some((x) => lc(x) === lc(industry))) return false;
    if (ex.regions?.length && region) {
      const expandedEx = new Set(expandRegionsForDb(ex.regions).map(lc));
      if (expandedEx.has(lc(region))) return false;
    }
    if (ex.countries?.length && country && ex.countries.some((x) => lc(x) === lc(country))) return false;
  }
  return true;
}
