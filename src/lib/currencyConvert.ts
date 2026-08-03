import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Currency = "EUR" | "USD" | "INR";

export interface RateRow {
  base: string;
  quote: string;
  rate: number;
  fetched_at: string;
}

export interface RatesSnapshot {
  /** USD-base rates: rates[quote] = how many quote-units per 1 USD. */
  rates: Record<string, number>;
  fetchedAt: string | null;
  isStale: boolean;
}

const STALE_DAYS = 1;

export const useCurrencyRates = () => {
  const query = useQuery({
    queryKey: ["currency-rates"],
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<RatesSnapshot> => {
      const { data, error } = await supabase
        .from("currency_rates")
        .select("base, quote, rate, fetched_at")
        .eq("base", "USD");
      if (error) throw error;
      const rates: Record<string, number> = {};
      let latest: string | null = null;
      (data as RateRow[] | null)?.forEach((r) => {
        rates[r.quote.toUpperCase()] = Number(r.rate);
        if (!latest || r.fetched_at > latest) latest = r.fetched_at;
      });
      if (!rates.USD) rates.USD = 1;
      const isStale = latest
        ? (Date.now() - new Date(latest).getTime()) / 86400000 > STALE_DAYS
        : true;
      return { rates, fetchedAt: latest, isStale };
    },
  });

  // Rates are pinned to a fixed yearly value — no auto-refresh.
  return query;
};


/**
 * Convert `amount` from `from` currency to `to` currency using USD as pivot.
 * Returns `null` if a required rate is missing.
 */
export const convert = (
  amount: number,
  from: string | null | undefined,
  to: string,
  rates: Record<string, number>,
): number | null => {
  const f = (from || "EUR").toUpperCase();
  const t = to.toUpperCase();
  if (!isFinite(amount)) return 0;
  if (f === t) return amount;
  const rf = rates[f];
  const rt = rates[t];
  if (!rf || !rt) return null;
  // amount in `from`: divide by rates[from] → USD; multiply by rates[to] → to
  return (amount / rf) * rt;
};

export const currencySymbol = (c: string): string =>
  ({ EUR: "€", USD: "$", INR: "₹" } as Record<string, string>)[c.toUpperCase()] || c;

export const formatMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currencySymbol(currency)}${Math.round(amount).toLocaleString()}`;
  }
};

/**
 * Parse a legacy deal budget value (which may contain currency symbols,
 * codes, commas, or spaces) into a plain number.
 * Returns null for empty / un-parseable values.
 */
export const parseDealBudget = (raw?: string | number | null): number | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/** Infer a currency code from currency-like tokens in legacy free-text budgets. */
export const inferCurrencyFromText = (raw?: string | null): Currency | null => {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (/\busd\b|\$/.test(s)) return "USD";
  if (/\beur\b|€/.test(s)) return "EUR";
  if (/\binr\b|₹|\brs\.?\b/.test(s)) return "INR";
  return null;
};
