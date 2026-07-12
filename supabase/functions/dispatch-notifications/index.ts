import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const NOTIFICATION_CRON_SECRET = Deno.env.get('NOTIFICATION_CRON_SECRET') ?? '';
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
const dateString = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateString(date);
};
const escapeHtml = (value: string) => value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char));
const money = (amount: number, currency: string) => `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${currency}`;

type Member = { workspace_id: string; user_id: string };
type Preference = { workspace_id: string; user_id: string; channels: string[]; event_types: string[]; reminder_days: number[]; delivery_mode: 'individual' | 'digest'; delivery_hour: number; timezone: string };
type Candidate = { source_type: 'cashflow_plan' | 'scheduled_operation' | 'debt_due'; source_id: string; workspace_id: string; event_date: string; title: string; amount: number; currency: string; direction: string };

async function sendTelegram(chatId: number, title: string, body: string) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}` }),
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
}

function hourInTimezone(timezone: string) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: timezone }).format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ ok: true });
  if (!NOTIFICATION_CRON_SECRET || request.headers.get('x-cron-secret') !== NOTIFICATION_CRON_SECRET) return json({ error: 'Unauthorized' }, 401);

  const today = dateString(new Date());
  const { data: members, error: membersError } = await admin.from('workspace_members').select('workspace_id,user_id').eq('is_active', true);
  if (membersError) return json({ error: membersError.message }, 500);
  const { data: preferences, error: preferencesError } = await admin.from('notification_preferences').select('*');
  if (preferencesError) return json({ error: preferencesError.message }, 500);
  const preferenceMap = new Map((preferences as Preference[] || []).map((item) => [`${item.workspace_id}:${item.user_id}`, item]));
  const maxAdvance = Math.max(1, ...(preferences || []).flatMap((item: Preference) => item.reminder_days || [0]));
  const through = addDays(today, maxAdvance);

  const [plansResult, schedulesResult, debtsResult, debtPaymentsResult, telegramResult] = await Promise.all([
    admin.from('cashflow_plans').select('id,workspace_id,planned_date,title,amount,currency,direction').eq('status', 'planned').gte('planned_date', today).lte('planned_date', through),
    admin.from('scheduled_operations').select('id,workspace_id,next_date,description,amount,currency,type').eq('is_active', true).gte('next_date', today).lte('next_date', through),
    admin.from('debts').select('id,workspace_id,due_on,title,counterparty,initial_amount,currency,direction').eq('is_archived', false).gte('due_on', today).lte('due_on', through),
    admin.from('operations').select('debt_id,debt_applied_amount').not('debt_id', 'is', null),
    admin.from('telegram_users').select('telegram_id,user_id'),
  ]);
  const queryError = plansResult.error || schedulesResult.error || debtsResult.error || debtPaymentsResult.error || telegramResult.error;
  if (queryError) return json({ error: queryError.message }, 500);
  const paidByDebt = new Map<string, number>();
  for (const payment of debtPaymentsResult.data || []) paidByDebt.set(payment.debt_id, (paidByDebt.get(payment.debt_id) || 0) + Number(payment.debt_applied_amount || 0));

  const candidates: Candidate[] = [
    ...(plansResult.data || []).map((item) => ({ source_type: 'cashflow_plan' as const, source_id: item.id, workspace_id: item.workspace_id, event_date: item.planned_date, title: item.title, amount: Number(item.amount), currency: item.currency, direction: item.direction })),
    ...(schedulesResult.data || []).map((item) => ({ source_type: 'scheduled_operation' as const, source_id: item.id, workspace_id: item.workspace_id, event_date: item.next_date, title: item.description || 'Регулярная операция', amount: Number(item.amount), currency: item.currency, direction: ['income', 'personal_salary'].includes(item.type) ? 'income' : 'expense' })),
    ...(debtsResult.data || []).map((item) => ({ source_type: 'debt_due' as const, source_id: item.id, workspace_id: item.workspace_id, event_date: item.due_on, title: `${item.title} · ${item.counterparty}`, amount: Math.max(0, Number(item.initial_amount) - (paidByDebt.get(item.id) || 0)), currency: item.currency, direction: item.direction === 'owed_to_me' ? 'income' : 'expense' })).filter((item) => item.amount > 0),
  ];
  const telegramByUser = new Map((telegramResult.data || []).map((item) => [item.user_id, Number(item.telegram_id)]));
  let created = 0;
  let telegramSent = 0;
  const telegramDigests = new Map<string, { chatId: number; lines: string[]; notificationIds: string[] }>();

  for (const member of (members as Member[] || [])) {
    const preference = preferenceMap.get(`${member.workspace_id}:${member.user_id}`) || { channels: ['in_app', 'telegram'], event_types: ['cashflow_plan', 'scheduled_operation', 'debt_due'], reminder_days: [1, 0], delivery_mode: 'individual' as const, delivery_hour: 9, timezone: 'UTC' };
    if (hourInTimezone(preference.timezone) !== Number(preference.delivery_hour)) continue;
    const reminderDays = preference.reminder_days || [1, 0];
    const memberCandidates = candidates.filter((item) => item.workspace_id === member.workspace_id && preference.event_types.includes(item.source_type) && item.event_date <= addDays(today, Math.max(...reminderDays)));
    for (const candidate of memberCandidates) {
      const offset = Math.max(0, Math.round((new Date(`${candidate.event_date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86400000));
      if (!reminderDays.includes(offset)) continue;
      const timing = offset === 0 ? 'сегодня' : offset === 1 ? 'завтра' : `через ${offset} дн.`;
      const direction = candidate.direction === 'income' ? 'Поступление' : 'Платёж';
      const title = `${direction} ${timing}`;
      const body = `${candidate.title}: ${money(candidate.amount, candidate.currency)}`;
      const { data: inserted, error: insertError } = await admin.from('app_notifications').upsert({
        workspace_id: member.workspace_id, user_id: member.user_id, source_type: candidate.source_type,
        source_id: candidate.source_id, event_date: candidate.event_date, reminder_offset: offset,
        title, body, severity: offset === 0 ? 'warning' : 'info', in_app_visible: preference.channels.includes('in_app'),
      }, { onConflict: 'user_id,source_type,source_id,event_date,reminder_offset', ignoreDuplicates: true }).select('id').maybeSingle();
      if (insertError) continue;
      if (!inserted) continue;
      created += 1;
      const chatId = telegramByUser.get(member.user_id);
      if (preference.channels.includes('telegram') && chatId && TELEGRAM_BOT_TOKEN) {
        if (preference.delivery_mode === 'digest') {
          const key = `${member.user_id}:${member.workspace_id}`;
          const digest = telegramDigests.get(key) || { chatId, lines: [], notificationIds: [] };
          digest.lines.push(`• ${title}: ${body}`);
          digest.notificationIds.push(inserted.id);
          telegramDigests.set(key, digest);
          continue;
        }
        try {
          await sendTelegram(chatId, title, body);
          await admin.from('app_notifications').update({ telegram_sent_at: new Date().toISOString(), telegram_error: null }).eq('id', inserted.id);
          telegramSent += 1;
        } catch (error) {
          await admin.from('app_notifications').update({ telegram_error: error instanceof Error ? error.message : 'Telegram delivery failed' }).eq('id', inserted.id);
        }
      }
    }
  }
  for (const digest of telegramDigests.values()) {
    try {
      await sendTelegram(digest.chatId, 'Платежи и поступления', digest.lines.join('\n'));
      await admin.from('app_notifications').update({ telegram_sent_at: new Date().toISOString(), telegram_error: null }).in('id', digest.notificationIds);
      telegramSent += digest.notificationIds.length;
    } catch (error) {
      await admin.from('app_notifications').update({ telegram_error: error instanceof Error ? error.message : 'Telegram delivery failed' }).in('id', digest.notificationIds);
    }
  }
  return json({ ok: true, date: today, candidates: candidates.length, created, telegramSent });
});
