import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ArrowRightLeft } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUserRole } from '@/hooks/useUserRole';
import { useToast } from '@/hooks/use-toast';
import SettingsCard from './shared/SettingsCard';
import { Banknote } from "lucide-react";
import { AppLoader } from "@/components/ui/loader";

type Currency = 'USD' | 'EUR' | 'INR';
const CURRENCIES: Currency[] = ['USD', 'EUR', 'INR'];

interface RateRow {
  base: string;
  quote: string;
  rate: number;
  fetched_at: string;
  source: string;
}

export default function CurrencyConverterCard() {
  const { isAdminOrAbove } = useUserRole();
  const { toast } = useToast();
  const [rates, setRates] = useState<Record<Currency, number>>({ USD: 1, EUR: 0.92, INR: 83 });
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [source, setSource] = useState<string>('exchangerate.host');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [amount, setAmount] = useState<string>('1');
  const [from, setFrom] = useState<Currency>('USD');
  const [to, setTo] = useState<Currency>('INR');

  const loadRates = async (): Promise<string | null> => {
    const { data, error } = await (supabase as any)
      .from('currency_rates')
      .select('base,quote,rate,fetched_at,source')
      .eq('base', 'USD');
    let latest: string | null = null;
    if (!error && data) {
      const next: Record<string, number> = { USD: 1 };
      let src: string | null = null;
      (data as RateRow[]).forEach((r) => {
        next[r.quote] = Number(r.rate);
        if (!latest || new Date(r.fetched_at) > new Date(latest)) {
          latest = r.fetched_at;
          src = r.source ?? src;
        }
      });
      setRates({ USD: next.USD ?? 1, EUR: next.EUR ?? 0.92, INR: next.INR ?? 83 });
      setFetchedAt(latest);
      if (src) setSource(src);
    }
    return latest;
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadRates();
      setLoading(false);
    })();
  }, []);

  const convert = (val: number, f: Currency, t: Currency) => {
    if (!Number.isFinite(val)) return 0;
    const usd = val / (rates[f] || 1); // to USD
    return usd * (rates[t] || 1);
  };

  const converted = useMemo(() => {
    const n = parseFloat(amount);
    if (!Number.isFinite(n)) return '';
    return convert(n, from, to).toLocaleString(undefined, { maximumFractionDigits: 4 });
  }, [amount, from, to, rates]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('refresh-currency-rates', {
        body: { force: true },
      });
      if (error) throw error;
      toast({ title: 'Rates refreshed', description: (data as any)?.updated ? 'Latest rates fetched.' : 'Already up to date.' });
      await loadRates();
    } catch (e: any) {
      toast({ title: 'Refresh failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    } finally {
      setRefreshing(false);
    }
  };

  const swap = () => { setFrom(to); setTo(from); };

  return (
    <SettingsCard
      icon={Banknote}
      title="Currency Converter"
      description={`USD, EUR, INR — auto-refreshed daily${source ? ` from ${source}` : ''}`}
    >
      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <AppLoader variant="inline" className="mr-2" /> Loading rates…
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground">Amount</label>
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="w-28">
              <label className="text-xs text-muted-foreground">From</label>
              <Select value={from} onValueChange={(v) => setFrom(v as Currency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" onClick={swap} aria-label="Swap currencies">
              <ArrowRightLeft className="h-4 w-4" />
            </Button>
            <div className="w-28">
              <label className="text-xs text-muted-foreground">To</label>
              <Select value={to} onValueChange={(v) => setTo(v as Currency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground">Converted</label>
              <Input readOnly value={converted} />
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium mb-2">Current rates (base USD)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {CURRENCIES.map((c) => (
                <div key={c} className="flex justify-between rounded bg-background px-3 py-2">
                  <span className="text-muted-foreground">1 USD =</span>
                  <span className="font-mono">{rates[c]?.toLocaleString(undefined, { maximumFractionDigits: 4 })} {c}</span>
                </div>
              ))}
            </div>
            {rates.EUR && rates.INR && (
              <div className="mt-2 flex justify-between rounded bg-background px-3 py-2">
                <span className="text-muted-foreground">1 EUR =</span>
                <span className="font-mono">
                  {(rates.INR / rates.EUR).toLocaleString(undefined, { maximumFractionDigits: 4 })} INR
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-muted-foreground">
            <div>
              Last updated: {fetchedAt ? new Date(fetchedAt).toLocaleString() : '—'} · Source: {source}
            </div>
            {isAdminOrAbove && (
              <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? <AppLoader variant="inline" className="mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Refresh now
              </Button>
            )}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
