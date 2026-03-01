import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function errorResponse(error: string, status: number) {
  return jsonResponse({ error }, status);
}

/**
 * Fetch exchange rates from CBR (Central Bank of Russia) XML API.
 * Returns rates relative to RUB: { USD: 92.5, EUR: 100.3, ... }
 */
async function fetchCBRRates(): Promise<Record<string, number>> {
  const res = await fetch('https://www.cbr.ru/scripts/XML_daily.asp');
  if (!res.ok) throw new Error(`CBR API error: ${res.status}`);

  const xml = await res.text();
  const rates: Record<string, number> = {};

  // Parse XML manually (no DOM parser in Deno edge functions)
  const valuteRegex = /<Valute[^>]*>[\s\S]*?<CharCode>(.*?)<\/CharCode>[\s\S]*?<Nominal>(\d+)<\/Nominal>[\s\S]*?<Value>([\d,]+)<\/Value>[\s\S]*?<\/Valute>/g;
  let match;
  while ((match = valuteRegex.exec(xml)) !== null) {
    const code = match[1];
    const nominal = parseInt(match[2], 10);
    const value = parseFloat(match[3].replace(',', '.'));
    if (code && nominal && value) {
      // CBR gives: 1 USD = 92.5 RUB (value/nominal)
      // We store as: USD→RUB rate = value/nominal
      rates[code] = value / nominal;
    }
  }

  return rates;
}

/**
 * Fetch exchange rates from Open Exchange Rates API (free, no key needed).
 * Returns rates relative to baseCurrency: { USD: 1, EUR: 0.92, ... }
 */
async function fetchOpenERRates(baseCurrency: string): Promise<Record<string, number>> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
  if (!res.ok) throw new Error(`Open ER API error: ${res.status}`);

  const data = await res.json();
  if (data.result !== 'success') throw new Error(`Open ER API: ${data['error-type'] || 'unknown error'}`);

  return data.rates || {};
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    // Auth: get user from token
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return errorResponse('Unauthorized', 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user) return errorResponse('Unauthorized', 401);

    const body = await req.json();
    const { workspace_id } = body;
    if (!workspace_id) return errorResponse('workspace_id required', 400);

    // Check user is owner/admin
    const { data: member } = await userClient
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (!member || !['Owner', 'Admin'].includes(member.role)) {
      return errorResponse('Only owners/admins can fetch rates', 403);
    }

    // Get workspace base currency
    const { data: ws } = await userClient
      .from('workspaces')
      .select('base_currency')
      .eq('id', workspace_id)
      .single();

    const baseCurrency = ws?.base_currency || 'KZT';

    // Get all currencies used in this workspace (accounts + operations)
    const { data: accountCurrencies } = await userClient
      .from('accounts')
      .select('currency')
      .eq('workspace_id', workspace_id);

    const usedCurrencies = new Set<string>();
    usedCurrencies.add(baseCurrency);
    (accountCurrencies || []).forEach(a => usedCurrencies.add(a.currency));

    // Fetch rates
    let fetchedRates: Record<string, number> = {};
    let source = 'auto';

    if (baseCurrency === 'RUB') {
      // Use CBR for RUB-based workspaces
      fetchedRates = await fetchCBRRates();
      source = 'cbr';
    } else {
      // Use Open Exchange Rates for non-RUB
      const allRates = await fetchOpenERRates(baseCurrency);
      // Filter to only currencies we need
      for (const code of usedCurrencies) {
        if (code !== baseCurrency && allRates[code]) {
          // open.er-api gives rate FROM base TO target: 1 BASE = X TARGET
          // We need: TARGET→BASE rate, so: 1/allRates[code]
          // Actually store as FROM→TO where FROM=foreign, TO=base
          fetchedRates[code] = 1 / allRates[code];
        }
      }
      source = 'openexchangerates';
    }

    // Upsert rates into exchange_rates
    const today = new Date().toISOString().slice(0, 10);
    const upsertRows = [];

    for (const [code, rate] of Object.entries(fetchedRates)) {
      if (!usedCurrencies.has(code) && code !== baseCurrency) continue;
      if (code === baseCurrency) continue;

      upsertRows.push({
        workspace_id,
        from_currency: code,
        to_currency: baseCurrency,
        rate,
        rate_date: today,
        source,
      });
    }

    if (upsertRows.length > 0) {
      const { error: upsertErr } = await userClient
        .from('exchange_rates')
        .upsert(upsertRows, {
          onConflict: 'workspace_id,from_currency,to_currency,rate_date',
        });

      if (upsertErr) {
        console.error('Upsert error:', upsertErr);
        return errorResponse(`Failed to save rates: ${upsertErr.message}`, 500);
      }
    }

    return jsonResponse({
      success: true,
      source,
      base_currency: baseCurrency,
      rates_updated: upsertRows.length,
      rates: upsertRows.map(r => ({
        from: r.from_currency,
        to: r.to_currency,
        rate: r.rate,
      })),
    });
  } catch (err) {
    console.error('fetch-rates error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
