type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function consumeRateLimit(
  admin: RpcClient,
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
) {
  const { data, error } = await admin.rpc('consume_security_rate_limit', {
    p_bucket: bucket,
    p_subject: subject,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error('Rate limit check failed');
  return data === true;
}

export async function opaqueClientSubject(request: Request) {
  const forwarded = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const salt = Deno.env.get('RATE_LIMIT_SALT') || Deno.env.get('SUPABASE_URL') || 'fintrack';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${forwarded}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function opaqueValue(value: string) {
  const salt = Deno.env.get('RATE_LIMIT_SALT') || Deno.env.get('SUPABASE_URL') || 'fintrack';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
