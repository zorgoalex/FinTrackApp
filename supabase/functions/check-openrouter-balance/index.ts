import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type AlertLevel = 'healthy' | 'warning' | 'critical' | 'severe' | 'error';

const jsonHeaders = { 'Content-Type': 'application/json' };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function levelForBalance(remaining: number): AlertLevel {
  if (remaining <= numberEnv('AI_BALANCE_SEVERE_USD', 5)) return 'severe';
  if (remaining <= numberEnv('AI_BALANCE_CRITICAL_USD', 10)) return 'critical';
  if (remaining <= numberEnv('AI_BALANCE_WARNING_USD', 15)) return 'warning';
  return 'healthy';
}

function shouldNotify(previous: { alert_level?: string; alert_sent_at?: string } | null, level: AlertLevel) {
  if (!previous) return level !== 'healthy';
  if (previous.alert_level !== level) return true;
  if (!previous.alert_sent_at) return true;
  if (level === 'healthy') return false;
  return Date.now() - new Date(previous.alert_sent_at).getTime() >= 24 * 60 * 60 * 1000;
}

async function sendAlert(apiKey: string, recipients: string[], level: AlertLevel, remaining: number | null, error?: string) {
  const subject = level === 'healthy'
    ? 'FinTrack AI: баланс OpenRouter восстановлен'
    : `FinTrack AI: OpenRouter — ${level.toUpperCase()}`;
  const detail = error
    ? `Проверка завершилась ошибкой: ${error}`
    : `Доступный баланс: $${remaining?.toFixed(2) ?? 'неизвестно'}.`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('ALERT_FROM_EMAIL') || 'FinTrackApp <onboarding@resend.dev>',
      to: recipients,
      subject,
      text: `${detail}\n\nПровайдер: OpenRouter\nУровень: ${level}\nВремя: ${new Date().toISOString()}`,
    }),
  });

  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const cronSecret = requiredEnv('AI_MONITOR_CRON_SECRET');
    const suppliedSecret = request.headers.get('x-cron-secret')
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (suppliedSecret !== cronSecret) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    );
    const { data: previous, error: previousError } = await admin
      .from('ai_provider_status')
      .select('alert_level, alert_sent_at')
      .eq('provider', 'openrouter')
      .maybeSingle();
    if (previousError) throw previousError;

    let level: AlertLevel = 'error';
    let remaining: number | null = null;
    let totalCredits: number | null = null;
    let totalUsage: number | null = null;
    let providerError: string | null = null;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${requiredEnv('OPENROUTER_MANAGEMENT_KEY')}` },
      });
      if (!response.ok) throw new Error(`OpenRouter returned ${response.status}: ${await response.text()}`);
      const payload = await response.json();
      totalCredits = Number(payload?.data?.total_credits);
      totalUsage = Number(payload?.data?.total_usage);
      if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) {
        throw new Error('OpenRouter returned an invalid credits response');
      }
      remaining = totalCredits - totalUsage;
      level = levelForBalance(remaining);
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
    }

    const notify = shouldNotify(previous, level);
    let alertSent = false;
    let alertError: string | null = null;
    if (notify) {
      const recipients = (Deno.env.get('AI_ADMIN_ALERT_EMAILS') || '')
        .split(',').map((email) => email.trim()).filter(Boolean);
      const resendKey = Deno.env.get('RESEND_API_KEY')?.trim();
      if (recipients.length && resendKey) {
        try {
          await sendAlert(resendKey, recipients, level, remaining, providerError || undefined);
          alertSent = true;
        } catch (error) {
          alertError = error instanceof Error ? error.message : String(error);
        }
      } else {
        alertError = 'AI_ADMIN_ALERT_EMAILS or RESEND_API_KEY is not configured';
      }
    }

    const now = new Date().toISOString();
    const { error: upsertError } = await admin.from('ai_provider_status').upsert({
      provider: 'openrouter', status: level, remaining_credits: remaining,
      total_credits: totalCredits, total_usage: totalUsage, last_error: providerError || alertError,
      checked_at: now, alert_level: level,
      alert_sent_at: alertSent
        ? now
        : previous?.alert_level === level ? previous.alert_sent_at || null : null,
      updated_at: now,
    });
    if (upsertError) throw upsertError;

    return json({ provider: 'openrouter', status: level, remaining_credits: remaining, alert_sent: alertSent });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
