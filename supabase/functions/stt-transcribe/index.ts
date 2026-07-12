import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { SttError } from '../_shared/stt/errors.ts';
import { createSttProvider } from '../_shared/stt/registry.ts';
import type { TimestampGranularity } from '../_shared/stt/types.ts';

const DEFAULT_MAX_BYTES = 18 * 1024 * 1024;
const GROQ_FREE_TIER_MAX_BYTES = 25 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm']);
const SUPPORTED_MIME_TYPES = new Set([
  'audio/flac', 'audio/m4a', 'audio/mp3', 'audio/mp4', 'audio/mpeg', 'audio/ogg',
  'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/x-wav', 'video/mp4', 'video/webm',
]);
const DEFAULT_PROMPT = 'Финансовая операция на русском языке. Суммы, тенге, KZT, категории, счета, Kaspi, Halyk, Forte, Freedom.';

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...headers, 'Content-Type': 'application/json' },
  });
}

function configuredMaxBytes() {
  const value = Number(Deno.env.get('STT_MAX_FILE_BYTES'));
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(Math.floor(value), GROQ_FREE_TIER_MAX_BYTES);
}

function extensionOf(filename: string) {
  return filename.toLowerCase().split('.').pop() || '';
}

function validateAudio(file: File) {
  if (file.size === 0) throw new SttError('INVALID_REQUEST', 'Аудиофайл пуст', 400);
  if (file.size > configuredMaxBytes()) {
    throw new SttError('FILE_TOO_LARGE', `Аудиофайл превышает лимит ${configuredMaxBytes()} байт`, 413);
  }
  const supportedByMime = SUPPORTED_MIME_TYPES.has(file.type.toLowerCase());
  const supportedByExtension = SUPPORTED_EXTENSIONS.has(extensionOf(file.name));
  if (!supportedByMime && !supportedByExtension) {
    throw new SttError('UNSUPPORTED_MEDIA_TYPE', 'Поддерживаются FLAC, MP3, MP4, M4A, OGG, WAV и WEBM', 415);
  }
}

function parseLanguage(value: FormDataEntryValue | null) {
  const language = String(value || 'ru').trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(language)) throw new SttError('INVALID_REQUEST', 'language должен быть кодом ISO-639-1', 400);
  return language;
}

function parseTimestamps(value: FormDataEntryValue | null): TimestampGranularity[] {
  switch (String(value || 'segment')) {
    case 'none': return [];
    case 'segment': return ['segment'];
    case 'word': return ['word'];
    case 'both': return ['segment', 'word'];
    default: throw new SttError('INVALID_REQUEST', 'timestamps: none, segment, word или both', 400);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }, 405);
  if (!request.headers.get('Authorization')) {
    return json({ error: { code: 'UNAUTHORIZED', message: 'Требуется авторизация', retryable: false } }, 401);
  }

  try {
    const authorization = request.headers.get('Authorization') || '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Сессия истекла', retryable: false } }, 401);
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      throw new SttError('INVALID_REQUEST', 'Ожидается multipart/form-data', 400);
    }
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File)) throw new SttError('INVALID_REQUEST', 'Поле audio обязательно', 400);
    validateAudio(audio);

    const language = parseLanguage(form.get('language'));
    const prompt = (Deno.env.get('STT_PROMPT')?.trim() || DEFAULT_PROMPT).slice(0, 800);
    const timestampGranularities = parseTimestamps(form.get('timestamps'));
    const provider = createSttProvider();
    const result = await provider.transcribe({ audio, language, prompt, timestampGranularities });
    return json(result);
  } catch (error) {
    if (error instanceof SttError) {
      const headers: Record<string, string> = {};
      if (error.retryAfterSeconds !== null) headers['Retry-After'] = String(error.retryAfterSeconds);
      return json({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          retry_after_seconds: error.retryAfterSeconds,
        },
      }, error.status, headers);
    }
    return json({
      error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка распознавания', retryable: false },
    }, 500);
  }
});
