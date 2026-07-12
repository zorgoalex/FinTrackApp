import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const NOTIFICATION_CRON_SECRET = Deno.env.get('NOTIFICATION_CRON_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const NOTIFICATION_FROM_EMAIL = Deno.env.get('NOTIFICATION_FROM_EMAIL') ?? 'FinTrackApp <onboarding@resend.dev>';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? '';
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

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
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[char] || char));
const money = (amount: number, currency: string) => `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${currency}`;

type Member = { workspace_id: string; user_id: string };
type Preference = {
  workspace_id: string;
  user_id: string;
  channels: string[];
  event_types: string[];
  reminder_days: number[];
  delivery_mode: 'individual' | 'digest';
  delivery_hour: number;
  timezone: string;
};
type Candidate = {
  source_type: 'cashflow_plan' | 'scheduled_operation' | 'debt_due';
  source_id: string;
  workspace_id: string;
  event_date: string;
  title: string;
  amount: number;
  currency: string;
  direction: string;
};
type NotificationRow = {
  id: string;
  title: string;
  body: string;
  telegram_sent_at: string | null;
  push_sent_at: string | null;
  email_sent_at: string | null;
};
type PushSubscriptionRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};
type Digest = {
  userId: string;
  workspaceId: string;
  lines: string[];
  notificationIds: string[];
};

async function sendTelegram(chatId: number, title: string, body: string) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('Telegram delivery is not configured');
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}` }),
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}: ${await response.text()}`);
}

async function sendEmail(email: string, subject: string, title: string, lines: string[]) {
  if (!RESEND_API_KEY) throw new Error('Email delivery is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: NOTIFICATION_FROM_EMAIL,
      to: [email],
      subject,
      html: `<!doctype html><html lang="ru"><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px"><main style="max-width:600px;margin:auto;background:white;border-radius:12px;padding:24px"><h1 style="font-size:20px">${escapeHtml(title)}</h1>${lines.map((line) => `<p style="line-height:1.5">${escapeHtml(line)}</p>`).join('')}<p style="font-size:12px;color:#777">Настройки каналов доступны в FinTrackApp.</p></main></body></html>`,
    }),
  });
  if (!response.ok) throw new Error(`Resend HTTP ${response.status}: ${await response.text()}`);
}

async function sendPush(subscriptions: PushSubscriptionRow[], title: string, body: string, tag: string) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) throw new Error('Web Push delivery is not configured');
  if (!subscriptions.length) throw new Error('Web Push subscription not found');
  let delivered = 0;
  const errors: string[] = [];
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({ title, body, tag, url: '/cashflow' }));
      delivered += 1;
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', subscription.id);
      }
      errors.push(error instanceof Error ? error.message : 'Web Push delivery failed');
    }
  }
  if (!delivered) throw new Error(errors.join('; ') || 'Web Push delivery failed');
}

function hourInTimezone(timezone: string) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: timezone }).format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

async function markDelivery(ids: string[], channel: 'telegram' | 'push' | 'email', error: string | null) {
  if (!ids.length) return;
  await admin.from('app_notifications').update(error
    ? { [`${channel}_error`]: error.slice(0, 2000) }
    : { [`${channel}_sent_at`]: new Date().toISOString(), [`${channel}_error`]: null }
  ).in('id', ids);
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

  const [plansResult, schedulesResult, debtsResult, debtPaymentsResult, telegramResult, pushResult] = await Promise.all([
    admin.from('cashflow_plans').select('id,workspace_id,planned_date,title,amount,currency,direction').eq('status', 'planned').gte('planned_date', today).lte('planned_date', through),
    admin.from('scheduled_operations').select('id,workspace_id,next_date,description,amount,currency,type').eq('is_active', true).gte('next_date', today).lte('next_date', through),
    admin.from('debts').select('id,workspace_id,due_on,title,counterparty,initial_amount,currency,direction').eq('is_archived', false).gte('due_on', today).lte('due_on', through),
    admin.from('operations').select('debt_id,debt_applied_amount').not('debt_id', 'is', null),
    admin.from('telegram_users').select('telegram_id,chat_id,user_id'),
    admin.from('push_subscriptions').select('id,workspace_id,user_id,endpoint,p256dh,auth'),
  ]);
  const queryError = plansResult.error || schedulesResult.error || debtsResult.error || debtPaymentsResult.error || telegramResult.error || pushResult.error;
  if (queryError) return json({ error: queryError.message }, 500);

  const paidByDebt = new Map<string, number>();
  for (const payment of debtPaymentsResult.data || []) paidByDebt.set(payment.debt_id, (paidByDebt.get(payment.debt_id) || 0) + Number(payment.debt_applied_amount || 0));
  const candidates: Candidate[] = [
    ...(plansResult.data || []).map((item) => ({ source_type: 'cashflow_plan' as const, source_id: item.id, workspace_id: item.workspace_id, event_date: item.planned_date, title: item.title, amount: Number(item.amount), currency: item.currency, direction: item.direction })),
    ...(schedulesResult.data || []).map((item) => ({ source_type: 'scheduled_operation' as const, source_id: item.id, workspace_id: item.workspace_id, event_date: item.next_date, title: item.description || 'Регулярная операция', amount: Number(item.amount), currency: item.currency, direction: ['income', 'personal_salary'].includes(item.type) ? 'income' : 'expense' })),
    ...(debtsResult.data || []).map((item) => ({ source_type: 'debt_due' as const, source_id: item.id, workspace_id: item.workspace_id, event_date: item.due_on, title: `${item.title} · ${item.counterparty}`, amount: Math.max(0, Number(item.initial_amount) - (paidByDebt.get(item.id) || 0)), currency: item.currency, direction: item.direction === 'owed_to_me' ? 'income' : 'expense' })).filter((item) => item.amount > 0),
  ];

  const telegramByUser = new Map((telegramResult.data || []).map((item) => [item.user_id, Number(item.chat_id || item.telegram_id)]));
  const pushByMember = new Map<string, PushSubscriptionRow[]>();
  for (const subscription of (pushResult.data as PushSubscriptionRow[] || [])) {
    const key = `${subscription.workspace_id}:${subscription.user_id}`;
    pushByMember.set(key, [...(pushByMember.get(key) || []), subscription]);
  }
  const emailByUser = new Map<string, string | null>();
  const digests = new Map<string, Digest>();
  let notificationsProcessed = 0;
  let telegramSent = 0;
  let pushSent = 0;
  let emailSent = 0;

  const addDigest = (channel: string, member: Member, row: NotificationRow) => {
    const key = `${channel}:${member.workspace_id}:${member.user_id}`;
    const digest = digests.get(key) || { userId: member.user_id, workspaceId: member.workspace_id, lines: [], notificationIds: [] };
    digest.lines.push(`${row.title}: ${row.body}`);
    digest.notificationIds.push(row.id);
    digests.set(key, digest);
  };

  for (const member of (members as Member[] || [])) {
    const preference = preferenceMap.get(`${member.workspace_id}:${member.user_id}`) || {
      channels: ['in_app', 'telegram'], event_types: ['cashflow_plan', 'scheduled_operation', 'debt_due'],
      reminder_days: [1, 0], delivery_mode: 'individual' as const, delivery_hour: 9, timezone: 'UTC',
    };
    if (hourInTimezone(preference.timezone) !== Number(preference.delivery_hour)) continue;
    const reminderDays = preference.reminder_days || [1, 0];
    const memberCandidates = candidates.filter((item) => item.workspace_id === member.workspace_id && preference.event_types.includes(item.source_type) && item.event_date <= addDays(today, Math.max(...reminderDays)));
    for (const candidate of memberCandidates) {
      const offset = Math.max(0, Math.round((new Date(`${candidate.event_date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86400000));
      if (!reminderDays.includes(offset)) continue;
      const timing = offset === 0 ? 'сегодня' : offset === 1 ? 'завтра' : `через ${offset} дн.`;
      const title = `${candidate.direction === 'income' ? 'Поступление' : 'Платёж'} ${timing}`;
      const body = `${candidate.title}: ${money(candidate.amount, candidate.currency)}`;
      const { data: notification, error: notificationError } = await admin.from('app_notifications').upsert({
        workspace_id: member.workspace_id, user_id: member.user_id, source_type: candidate.source_type,
        source_id: candidate.source_id, event_date: candidate.event_date, reminder_offset: offset,
        title, body, severity: offset === 0 ? 'warning' : 'info', in_app_visible: preference.channels.includes('in_app'),
      }, { onConflict: 'user_id,source_type,source_id,event_date,reminder_offset' })
        .select('id,title,body,telegram_sent_at,push_sent_at,email_sent_at').single();
      if (notificationError || !notification) continue;
      const row = notification as NotificationRow;
      notificationsProcessed += 1;

      if (preference.channels.includes('telegram') && !row.telegram_sent_at) {
        if (preference.delivery_mode === 'digest') addDigest('telegram', member, row);
        else {
          try {
            const chatId = telegramByUser.get(member.user_id);
            if (!chatId) throw new Error('Telegram account is not linked');
            await sendTelegram(chatId, title, body);
            await markDelivery([row.id], 'telegram', null);
            telegramSent += 1;
          } catch (error) {
            await markDelivery([row.id], 'telegram', error instanceof Error ? error.message : 'Telegram delivery failed');
          }
        }
      }
      if (preference.channels.includes('browser') && !row.push_sent_at) {
        if (preference.delivery_mode === 'digest') addDigest('push', member, row);
        else {
          try {
            await sendPush(pushByMember.get(`${member.workspace_id}:${member.user_id}`) || [], title, body, row.id);
            await markDelivery([row.id], 'push', null);
            pushSent += 1;
          } catch (error) {
            await markDelivery([row.id], 'push', error instanceof Error ? error.message : 'Web Push delivery failed');
          }
        }
      }
      if (preference.channels.includes('email') && !row.email_sent_at) {
        if (preference.delivery_mode === 'digest') addDigest('email', member, row);
        else {
          try {
            if (!emailByUser.has(member.user_id)) {
              const { data } = await admin.auth.admin.getUserById(member.user_id);
              emailByUser.set(member.user_id, data.user?.email || null);
            }
            const email = emailByUser.get(member.user_id);
            if (!email) throw new Error('User email not found');
            await sendEmail(email, title, title, [body]);
            await markDelivery([row.id], 'email', null);
            emailSent += 1;
          } catch (error) {
            await markDelivery([row.id], 'email', error instanceof Error ? error.message : 'Email delivery failed');
          }
        }
      }
    }
  }

  for (const [key, digest] of digests) {
    const channel = key.split(':', 1)[0] as 'telegram' | 'push' | 'email';
    try {
      if (channel === 'telegram') {
        const chatId = telegramByUser.get(digest.userId);
        if (!chatId) throw new Error('Telegram account is not linked');
        await sendTelegram(chatId, 'Платежи и поступления', digest.lines.map((line) => `• ${line}`).join('\n'));
        telegramSent += digest.notificationIds.length;
      } else if (channel === 'push') {
        await sendPush(pushByMember.get(`${digest.workspaceId}:${digest.userId}`) || [], 'Платежи и поступления', digest.lines.join('\n'), `digest-${today}`);
        pushSent += digest.notificationIds.length;
      } else {
        if (!emailByUser.has(digest.userId)) {
          const { data } = await admin.auth.admin.getUserById(digest.userId);
          emailByUser.set(digest.userId, data.user?.email || null);
        }
        const email = emailByUser.get(digest.userId);
        if (!email) throw new Error('User email not found');
        await sendEmail(email, 'Платежи и поступления — FinTrackApp', 'Платежи и поступления', digest.lines);
        emailSent += digest.notificationIds.length;
      }
      await markDelivery(digest.notificationIds, channel, null);
    } catch (error) {
      await markDelivery(digest.notificationIds, channel, error instanceof Error ? error.message : `${channel} delivery failed`);
    }
  }

  return json({ ok: true, date: today, candidates: candidates.length, notificationsProcessed, telegramSent, pushSent, emailSent });
});
