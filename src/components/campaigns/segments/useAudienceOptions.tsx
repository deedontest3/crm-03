import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { regions as REGIONS, countries as COUNTRIES, countryToRegion } from "@/utils/countryRegionMapping";

const FALLBACK_INDUSTRIES = ["Automotive", "Technology", "Manufacturing", "Other"];

const lc = (s: string) => s.toLowerCase();

/**
 * Returns audience option lists. Cascades:
 *  - countries narrowed by selectedRegions
 *  - positions narrowed by selectedIndustries (contacts whose own industry,
 *    or whose linked account's industry, matches any selected industry)
 *  - industries narrowed by selectedPositions (industries that have at
 *    least one contact whose position matches the selected list)
 *
 * Already-selected values are always preserved in the returned list so the
 * UI never silently drops a chip the user picked earlier.
 */
export function useAudienceOptions(
  selectedRegions?: string[],
  selectedIndustries?: string[],
  selectedPositions?: string[],
) {
  // Pull a representative slice of contacts WITH their account industry, so
  // we can cross-filter industries <-> positions without a second query.
  const { data: contactRows = [] } = useQuery({
    queryKey: ["audience-options", "contact-industry-position"],
    queryFn: async () => {
      const { data } = await supabase
        .from("contacts")
        .select("industry, position, accounts(industry)")
        .limit(2000);
      return (data || []) as unknown as Array<{ industry: string | null; position: string | null; accounts: { industry: string | null } | null }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: allIndustries = FALLBACK_INDUSTRIES } = useQuery({
    queryKey: ["audience-options", "industries"],
    queryFn: async () => {
      const [a, c] = await Promise.all([
        supabase.from("accounts").select("industry").not("industry", "is", null).limit(1000),
        supabase.from("contacts").select("industry").not("industry", "is", null).limit(1000),
      ]);
      const set = new Set<string>(FALLBACK_INDUSTRIES);
      (a.data || []).forEach((r: any) => r.industry && set.add(r.industry));
      (c.data || []).forEach((r: any) => r.industry && set.add(r.industry));
      return Array.from(set).sort();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: allPositions = [] } = useQuery({
    queryKey: ["audience-options", "positions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("contacts")
        .select("position")
        .not("position", "is", null)
        .limit(2000);
      const set = new Set<string>();
      (data || []).forEach((r: any) => r.position && set.add(String(r.position).trim()));
      return Array.from(set).filter(Boolean).sort();
    },
    staleTime: 5 * 60 * 1000,
  });

  const indSet = useMemo(
    () => (selectedIndustries && selectedIndustries.length ? new Set(selectedIndustries.map(lc)) : null),
    [selectedIndustries],
  );
  const posSet = useMemo(
    () => (selectedPositions && selectedPositions.length ? new Set(selectedPositions.map(lc)) : null),
    [selectedPositions],
  );

  const positions = useMemo(() => {
    if (!indSet) return allPositions;
    const s = new Set<string>();
    for (const r of contactRows) {
      const ind = r.industry || r.accounts?.industry;
      if (!r.position || !ind) continue;
      if (indSet.has(lc(ind))) s.add(String(r.position).trim());
    }
    // Preserve already-selected positions even if not currently in scope.
    if (selectedPositions) for (const p of selectedPositions) s.add(p);
    return Array.from(s).filter(Boolean).sort();
  }, [allPositions, contactRows, indSet, selectedPositions]);

  const industries = useMemo(() => {
    if (!posSet) return allIndustries;
    const s = new Set<string>();
    for (const r of contactRows) {
      if (!r.position) continue;
      if (!posSet.has(lc(r.position))) continue;
      const ind = r.industry || r.accounts?.industry;
      if (ind) s.add(ind);
    }
    if (selectedIndustries) for (const i of selectedIndustries) s.add(i);
    return Array.from(s).sort();
  }, [allIndustries, contactRows, posSet, selectedIndustries]);

  const countriesFiltered =
    selectedRegions && selectedRegions.length > 0
      ? COUNTRIES.filter((c) => selectedRegions.includes(countryToRegion[c]))
      : COUNTRIES;

  return {
    industries,
    regions: REGIONS,
    countries: countriesFiltered,
    positions,
  };
}
