import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 70_000;
const DEFAULT_RATE_LIMIT = 12;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// GLM-OCR was benchmarked with its native OCR instruction. Extra prose can
// reduce recognition quality, so parsing, redaction and QR exclusion stay in
// the deterministic application layer.
const OCR_PROMPT = 'Text Recognition:';

export class HttpError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function detectImageMime(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

export function buildLlamaRequest(bytes, mime, { model = 'GLM-OCR', maxTokens = 2200 } = {}) {
  return {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: OCR_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } },
      ],
    }],
  };
}

function numberFromEnv(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function requiredEnv(name, env) {
  const value = String(env[name] || '').trim().replace(/\/+$/u, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function allowedOrigins(env) {
  return new Set(String(env.OCR_ALLOWED_ORIGINS || 'https://fintrackapp-wheat.vercel.app')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
}

function corsHeaders(origin, origins) {
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, content-type, x-workspace-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && origins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return headers;
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readBody(request, maxBytes) {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'Изображение превышает 15 МБ');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'FILE_TOO_LARGE', 'Изображение превышает 15 МБ');
    chunks.push(chunk);
  }
  if (!size) throw new HttpError(400, 'INVALID_IMAGE', 'Изображение пустое');
  return Buffer.concat(chunks);
}

function bearerToken(request) {
  const match = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/iu);
  if (!match) throw new HttpError(401, 'UNAUTHORIZED', 'Требуется авторизация');
  return match[1];
}

function workspaceId(request) {
  const value = String(request.headers['x-workspace-id'] || '').trim();
  if (!/^[0-9a-f-]{36}$/iu.test(value)) {
    throw new HttpError(400, 'INVALID_WORKSPACE', 'Не выбрано рабочее пространство');
  }
  return value;
}

async function fetchJson(url, options, timeoutMs) {
  const response = await globalThis.fetch(url, {
    ...options,
    signal: globalThis.AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Upstream response is reported without returning its body to the client.
  }
  return { response, payload };
}

function supabaseHeaders(token, anonKey) {
  return { apikey: anonKey, Authorization: `Bearer ${token}` };
}

async function authorizeRequest({ token, workspace, supabaseUrl, anonKey, timeoutMs }) {
  const auth = await fetchJson(`${supabaseUrl}/auth/v1/user`, {
    headers: supabaseHeaders(token, anonKey),
  }, timeoutMs);
  if (!auth.response.ok || !auth.payload?.id) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Сессия истекла');
  }

  const query = new globalThis.URLSearchParams({
    select: 'role',
    workspace_id: `eq.${workspace}`,
    user_id: `eq.${auth.payload.id}`,
    is_active: 'eq.true',
    limit: '1',
  });
  const membership = await fetchJson(`${supabaseUrl}/rest/v1/workspace_members?${query}`, {
    headers: supabaseHeaders(token, anonKey),
  }, timeoutMs);
  if (!membership.response.ok || !Array.isArray(membership.payload) || membership.payload.length === 0) {
    throw new HttpError(403, 'FORBIDDEN', 'Нет доступа к рабочему пространству');
  }
  const role = String(membership.payload[0]?.role || '').toLowerCase();
  if (!['owner', 'admin', 'member'].includes(role)) {
    throw new HttpError(403, 'FORBIDDEN', 'Роль не разрешает импорт операций');
  }
  return auth.payload.id;
}

function createRateLimiter(limit) {
  const buckets = new Map();
  return (userId) => {
    const now = Date.now();
    const bucket = buckets.get(userId);
    if (!bucket || now - bucket.startedAt >= 60_000) {
      buckets.set(userId, { startedAt: now, count: 1 });
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) throw new HttpError(429, 'RATE_LIMITED', 'Слишком много сканов. Повторите через минуту.', true);
  };
}

export function createReceiptOcrServer(env = process.env) {
  const supabaseUrl = requiredEnv('SUPABASE_URL', env);
  const anonKey = requiredEnv('SUPABASE_ANON_KEY', env);
  const llamaBaseUrl = requiredEnv('LLAMA_BASE_URL', env);
  const origins = allowedOrigins(env);
  const maxBytes = numberFromEnv(env.OCR_MAX_FILE_BYTES, DEFAULT_MAX_BYTES, 1024, DEFAULT_MAX_BYTES);
  const timeoutMs = numberFromEnv(env.OCR_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5000, 120_000);
  const authTimeoutMs = numberFromEnv(env.OCR_AUTH_TIMEOUT_MS, 8000, 1000, 20_000);
  const model = String(env.GLM_OCR_API_MODEL || 'GLM-OCR').trim();
  const maxTokens = numberFromEnv(env.GLM_OCR_MAX_TOKENS, 2200, 256, 4096);
  const limitRequest = createRateLimiter(numberFromEnv(env.OCR_REQUESTS_PER_MINUTE, DEFAULT_RATE_LIMIT, 1, 120));

  return createServer(async (request, response) => {
    const origin = String(request.headers.origin || '');
    const headers = corsHeaders(origin, origins);
    if (origin && !origins.has(origin)) {
      sendJson(response, 403, { error: { code: 'ORIGIN_FORBIDDEN', message: 'Origin not allowed' } }, headers);
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers);
      response.end();
      return;
    }

    try {
      if (request.method === 'GET' && request.url === '/health') {
        const health = await fetchJson(`${llamaBaseUrl}/health`, {}, 2500);
        sendJson(response, health.response.ok ? 200 : 503, {
          status: health.response.ok ? 'ok' : 'loading',
          engine: 'glm-ocr',
        }, headers);
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/ocr') {
        throw new HttpError(404, 'NOT_FOUND', 'Endpoint not found');
      }

      const token = bearerToken(request);
      const workspace = workspaceId(request);
      const userId = await authorizeRequest({ token, workspace, supabaseUrl, anonKey, timeoutMs: authTimeoutMs });
      limitRequest(userId);

      const declaredMime = String(request.headers['content-type'] || '').toLowerCase().split(';')[0];
      if (!IMAGE_MIMES.has(declaredMime)) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Поддерживаются JPG, PNG и WEBP');
      }
      const bytes = await readBody(request, maxBytes);
      const detectedMime = detectImageMime(bytes);
      if (!detectedMime || detectedMime !== declaredMime) {
        throw new HttpError(415, 'INVALID_IMAGE_SIGNATURE', 'Содержимое файла не соответствует формату изображения');
      }

      const startedAt = performance.now();
      const upstream = await fetchJson(`${llamaBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${String(env.LLAMA_API_KEY || 'no-key')}`,
        },
        body: JSON.stringify(buildLlamaRequest(bytes, detectedMime, { model, maxTokens })),
      }, timeoutMs);
      if (!upstream.response.ok) {
        throw new HttpError(503, 'OCR_UNAVAILABLE', 'OCR-модель временно недоступна', true);
      }
      const text = String(upstream.payload?.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new HttpError(422, 'EMPTY_RESULT', 'На изображении не найден читаемый текст', true);

      sendJson(response, 200, {
        text,
        engine: 'glm-ocr',
        model,
        latency_ms: Math.round(performance.now() - startedAt),
        request_id: randomUUID(),
      }, headers);
    } catch (error) {
      const safeError = error instanceof HttpError
        ? error
        : new HttpError(500, 'INTERNAL_ERROR', 'Внутренняя ошибка OCR-сервера');
      if (!(error instanceof HttpError)) globalThis.console.error('receipt-ocr request failed', error?.message || error);
      sendJson(response, safeError.status, {
        error: { code: safeError.code, message: safeError.message, retryable: safeError.retryable },
      }, headers);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = numberFromEnv(process.env.PORT, 8788, 1, 65535);
  const host = String(process.env.HOST || '0.0.0.0');
  createReceiptOcrServer().listen(port, host, () => {
    globalThis.console.log(`receipt-ocr gateway listening on ${host}:${port}`);
  });
}
