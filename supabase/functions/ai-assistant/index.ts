import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { corsHeaders, withCors } from '../_shared/cors.ts';
import {
  PayloadTooLargeError,
  fetchWithTimeout,
  readJsonWithLimit,
  readResponseJsonWithLimit,
} from '../_shared/abuseProtection.js';
import {
  assistantMessages,
  isSafeAssistantAnswer,
  isSafeAssistantDateRange,
  normalizeAssistantQuestion,
  privateLogFingerprint,
  safeProviderUsage,
  sanitizeFinancialContext,
} from '../_shared/aiSecurity.js';

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const PROVIDER_TIMEOUT_MS = 15_000;

type FinancialContext = {
  period?: { from?: string; to?: string };
  base_currency?: string;
  summary?: { income?: number; expense?: number; net?: number; operation_count?: number };
  categories?: Array<{ name?: string; type?: string; amount?: number }>;
  accounts?: Array<{ name?: string; currency?: string; balance?: number }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...headers, 'Content-Type': 'application/json' },
  });
}

function money(value: number | undefined, currency: string) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0) + ` ${currency}`;
}

function fallbackAnswer(context: FinancialContext) {
  const currency = context.base_currency || 'KZT';
  const summary = context.summary || {};
  const topExpense = (context.categories || []).find((category) => ['expense', 'employee_salary'].includes(category.type || ''));
  const lines = [
    `За выбранный период доходы составили ${money(summary.income, currency)}, расходы — ${money(summary.expense, currency)}.`,
    `Итоговый денежный поток: ${money(summary.net, currency)}; учтено операций: ${summary.operation_count || 0}.`,
  ];
  if (topExpense) lines.push(`Самая крупная категория расходов: ${topExpense.name} — ${money(topExpense.amount, currency)}.`);
  lines.push('Это краткая локальная сводка; AI-провайдер сейчас недоступен или не настроен.');
  return lines.join(' ');
}

Deno.serve(withCors(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Требуется авторизация' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { global: { headers: { Authorization: authorization } } },
  );

  let workspaceId = '';
  let question = '';
  try {
    const body = await readJsonWithLimit(request, MAX_REQUEST_BYTES);
    workspaceId = String(body?.workspaceId || '');
    try {
      question = normalizeAssistantQuestion(body?.question);
    } catch {
      return json({ error: 'Некорректные параметры запроса' }, 400);
    }
    const dateFrom = String(body?.dateFrom || '');
    const dateTo = String(body?.dateTo || '');
    if (!UUID_PATTERN.test(workspaceId) || !isSafeAssistantDateRange(dateFrom, dateTo)) {
      return json({ error: 'Некорректные параметры запроса' }, 400);
    }

    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) return json({ error: 'Сессия истекла' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const [userAllowed, globalAllowed] = await Promise.all([
      consumeRateLimit(admin, 'assistant:user', userResult.user.id, 30, 3600),
      consumeRateLimit(admin, 'assistant:global', 'beta', 300, 3600),
    ]);
    if (!userAllowed || !globalAllowed) {
      return json({ error: 'Лимит запросов к помощнику временно исчерпан' }, 429, { 'Retry-After': '3600' });
    }

    const { data: context, error: contextError } = await supabase.rpc('get_ai_financial_context', {
      p_workspace_id: workspaceId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    if (contextError) return json({ error: 'Нет доступа к финансовому контексту' }, 403);
    const safeContext = sanitizeFinancialContext(context);
    const questionFingerprint = await privateLogFingerprint(question);

    const externalProviderEnabled = Deno.env.get('BETA_EXTERNAL_AI_ENABLED') === 'true';
    const apiKey = externalProviderEnabled ? Deno.env.get('OPENROUTER_API_KEY')?.trim() : '';
    const configuredModel = Deno.env.get('OPENROUTER_MODEL')?.trim() || '';
    const model = /^[A-Za-z0-9_.:/-]{1,120}$/.test(configuredModel) ? configuredModel : 'openrouter/free';
    if (!apiKey) {
      const answer = fallbackAnswer(safeContext as FinancialContext);
      await admin.from('ai_assistant_logs').insert({
        workspace_id: workspaceId, user_id: userResult.user.id, question: questionFingerprint, model: 'local-summary', status: 'mock',
      });
      return json({ answer, model: 'local-summary', mode: 'local' });
    }

    try {
      const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': Deno.env.get('SITE_URL') || 'https://fintrackapp-wheat.vercel.app',
          'X-OpenRouter-Title': 'FinTrackApp',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 350,
          messages: assistantMessages(safeContext, question),
        }),
      }, PROVIDER_TIMEOUT_MS);
      if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
      const payload = await readResponseJsonWithLimit(response, MAX_PROVIDER_RESPONSE_BYTES);
      const answer = String(payload?.choices?.[0]?.message?.content || '').trim();
      if (!isSafeAssistantAnswer(answer)) throw new Error('Провайдер вернул небезопасный ответ');
      const usage = safeProviderUsage(payload?.usage) as Record<string, number>;
      const responseModel = /^[A-Za-z0-9_.:/-]{1,120}$/.test(String(payload?.model || '')) ? String(payload.model) : model;
      await admin.from('ai_assistant_logs').insert({
        workspace_id: workspaceId,
        user_id: userResult.user.id,
        question: questionFingerprint,
        model: responseModel,
        status: 'success',
        prompt_tokens: Number(usage.prompt_tokens) || null,
        completion_tokens: Number(usage.completion_tokens) || null,
      });
      return json({ answer, model: responseModel, mode: 'provider', usage });
    } catch (providerError) {
      const answer = fallbackAnswer(safeContext as FinancialContext);
      await admin.from('ai_assistant_logs').insert({
        workspace_id: workspaceId,
        user_id: userResult.user.id,
        question: questionFingerprint,
        model,
        status: 'mock',
        error_code: providerError instanceof Error ? providerError.message.slice(0, 120) : 'provider_error',
      });
      return json({ answer, model: 'local-summary', mode: 'fallback', warning: 'AI-провайдер временно недоступен' });
    }
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: 'Запрос слишком большой' }, 413);
    if (error instanceof SyntaxError) return json({ error: 'Некорректный JSON' }, 400);
    return json({ error: 'Внутренняя ошибка' }, 500);
  }
}));
