import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireAdmin, requireCronSecret } from '../_shared/auth-gate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const QUOTES = ['USD', 'EUR', 'INR'] as const;
const BASE = 'USD';

async function fetchRates(): Promise<Record<string, number>> {
  // Primary: frankfurter.app (free, no key, ECB data) — only supports EUR/INR vs USD
  try {
    const r = await fetch(`https://api.frankfurter.app/latest?from=${BASE}&to=EUR,INR`);
    if (r.ok) {
      const j = await r.json();
      if (j?.rates?.EUR && j?.rates?.INR) {
        return { USD: 1, EUR: Number(j.rates.EUR), INR: Number(j.rates.INR) };
      }
    }
  } catch (_) { /* fall through */ }

  // Fallback: open.er-api.com (free, no key)
  const r2 = await fetch(`https://open.er-api.com/v6/latest/${BASE}`);
  if (!r2.ok) throw new Error(`open.er-api.com ${r2.status}`);
  const j2 = await r2.json();
  const rates = j2?.rates ?? {};
  if (!rates.EUR || !rates.INR) throw new Error('Provider returned incomplete rates');
  return { USD: 1, EUR: Number(rates.EUR), INR: Number(rates.INR) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let force = false;
    try {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        force = body?.force === true || body?.force === '1';
      }
      if (!force) {
        force = new URL(req.url).searchParams.get('force') === '1';
      }
    } catch (_) { /* ignore */ }

    // Auth: cron gate for scheduled/normal calls. `force=true` bypasses the
    // 20h freshness cache and drives outbound FX API traffic, so it must be
    // an admin (never an anon caller).
    if (force) {
      const admin = await requireAdmin(req);
      if ('response' in admin) return admin.response;
    } else {
      const cron = requireCronSecret(req);
      if ('response' in cron) return cron.response;
    }

    const { data: newest } = await supabase
      .from('currency_rates')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!force && newest?.fetched_at) {
      const ageHours = (Date.now() - new Date(newest.fetched_at).getTime()) / 36e5;
      if (ageHours < 20) {
        return new Response(
          JSON.stringify({ updated: false, reason: 'fresh', fetched_at: newest.fetched_at }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    const fresh = await fetchRates();
    const now = new Date().toISOString();
    const rows = QUOTES.map((q) => ({
      base: BASE,
      quote: q,
      rate: q === BASE ? 1 : Number(fresh[q]),
      fetched_at: now,
      source: 'frankfurter/open.er-api',
    })).filter((r) => Number.isFinite(r.rate) && r.rate > 0);

    if (rows.length < QUOTES.length) throw new Error('Incomplete rates after fetch');

    const { error } = await supabase
      .from('currency_rates')
      .upsert(rows, { onConflict: 'base,quote' });
    if (error) throw error;

    return new Response(
      JSON.stringify({
        updated: true,
        fetched_at: now,
        rates: Object.fromEntries(rows.map((r) => [r.quote, r.rate])),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('refresh-currency-rates error', e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
