const PRODUCTION_BROWSER_ORIGINS = new Set([
  'https://fintrackapp.vip',
  'https://fintrackapp-wheat.vercel.app',
]);

const LOCAL_FUNCTION_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOCAL_BROWSER_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

export const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
};

function isLocalFunctionRequest(request) {
  try {
    return LOCAL_FUNCTION_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function isAllowedBrowserOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  if (PRODUCTION_BROWSER_ORIGINS.has(origin)) return true;
  return isLocalFunctionRequest(request) && LOCAL_BROWSER_ORIGIN.test(origin);
}

export function corsHeadersFor(request) {
  const headers = new Headers(corsHeaders);
  const origin = request.headers.get('Origin');
  if (origin && isAllowedBrowserOrigin(request)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

function forbiddenOriginResponse(request) {
  return new Response(JSON.stringify({ error: 'Origin is not allowed' }), {
    status: 403,
    headers: { ...Object.fromEntries(corsHeadersFor(request)), 'Content-Type': 'application/json' },
  });
}

export function withCors(handler) {
  return async (request) => {
    if (!isAllowedBrowserOrigin(request)) return forbiddenOriginResponse(request);

    if (request.method === 'OPTIONS') {
      if (!request.headers.get('Origin')) return forbiddenOriginResponse(request);
      return new Response(null, { status: 204, headers: corsHeadersFor(request) });
    }

    const response = await handler(request);
    const headers = new Headers(response.headers);
    corsHeadersFor(request).forEach((value, key) => headers.set(key, value));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
