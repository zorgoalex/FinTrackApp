import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const response = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  const { identifier, password } = await req.json();
  const normalized = typeof identifier === 'string' ? identifier.trim().toLowerCase() : '';
  if (!/^[\p{L}\p{N}_]{3,30}$/u.test(normalized) || typeof password !== 'string') {
    return response({ error: 'Неверное имя аккаунта или пароль' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: profile } = await admin
    .from('profiles')
    .select('user_id')
    .ilike('username', normalized)
    .maybeSingle();
  if (!profile) return response({ error: 'Неверное имя аккаунта или пароль' }, 400);

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
  if (userError || !userData.user?.email) return response({ error: 'Неверное имя аккаунта или пароль' }, 400);

  const publicClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
  const { data, error } = await publicClient.auth.signInWithPassword({
    email: userData.user.email,
    password,
  });
  if (error || !data.session) return response({ error: 'Неверное имя аккаунта или пароль' }, 400);

  return response({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
});
