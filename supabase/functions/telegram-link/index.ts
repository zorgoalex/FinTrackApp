import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});

async function getBotUsername() {
  const result = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
  const payload = await result.json();
  if (!result.ok || !payload?.ok || !payload?.result?.username) throw new Error('Telegram-бот недоступен');
  return String(payload.result.username);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return response({ error: 'Unauthorized' }, 401);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return response({ error: 'Unauthorized' }, 401);

  try {
    const { action = 'status' } = await request.json().catch(() => ({}));
    if (action === 'status') {
      const { data, error } = await client.rpc('get_my_telegram_link_status');
      if (error) throw error;
      return response({ ...(data?.[0] || { linked: false }) });
    }
    if (action === 'create') {
      if (!TELEGRAM_BOT_TOKEN) throw new Error('Telegram-бот не настроен');
      const [{ data, error }, botUsername] = await Promise.all([
        client.rpc('create_telegram_link_token'),
        getBotUsername(),
      ]);
      if (error) throw error;
      const link = data?.[0];
      if (!link?.token) throw new Error('Не удалось создать ссылку');
      return response({ linked: false, bot_username: botUsername, url: `https://t.me/${botUsername}?start=${link.token}`, expires_at: link.expires_at });
    }
    if (action === 'unlink') {
      const { error } = await client.rpc('unlink_my_telegram_account');
      if (error) throw error;
      return response({ linked: false });
    }
    return response({ error: 'Unknown action' }, 400);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'Ошибка Telegram-привязки';
    console.error('telegram-link:', message, error);
    return response({ error: message }, 400);
  }
});
