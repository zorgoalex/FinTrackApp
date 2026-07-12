export const STT_MAX_FILE_BYTES = 18 * 1024 * 1024;
export const STT_SUPPORTED_EXTENSIONS = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm'];

export class SttClientError extends Error {
  constructor({ code, message, retryable = false, retryAfterSeconds = null, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SttClientError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
function extensionForMimeType(type) {
  const subtype = String(type || '').split('/')[1]?.split(';')[0];
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'x-m4a') return 'm4a';
  if (subtype === 'x-wav') return 'wav';
  return STT_SUPPORTED_EXTENSIONS.includes(subtype) ? subtype : 'webm';
}

function validateAudio(audio) {
  if (!(audio instanceof Blob)) {
    throw new SttClientError({ code: 'INVALID_AUDIO', message: 'Ожидается Blob или File с аудио' });
  }
  if (audio.size === 0) throw new SttClientError({ code: 'INVALID_AUDIO', message: 'Аудиозапись пустая' });
  if (audio.size > STT_MAX_FILE_BYTES) {
    throw new SttClientError({ code: 'FILE_TOO_LARGE', message: 'Аудиозапись превышает 18 МБ' });
  }
}

function validateResult(data) {
  if (!data || typeof data.transcript !== 'string' || typeof data.provider !== 'string' || typeof data.model !== 'string') {
    throw new SttClientError({ code: 'INVALID_RESPONSE', message: 'STT-сервис вернул некорректный ответ', retryable: true });
  }
  return {
    transcript: data.transcript,
    provider: data.provider,
    model: data.model,
    language: data.language || null,
    durationSeconds: Number.isFinite(data.duration_seconds) ? data.duration_seconds : null,
    segments: Array.isArray(data.segments) ? data.segments : [],
    words: Array.isArray(data.words) ? data.words : [],
    requestId: data.request_id || null,
    latencyMs: Number.isFinite(data.latency_ms) ? data.latency_ms : null,
  };
}

export function createSttClient(functionsClient) {
  if (!functionsClient?.invoke) throw new Error('Supabase Functions client is required');

  return {
    async transcribe(audio, options = {}) {
      validateAudio(audio);
      const timestamps = options.timestamps || 'segment';
      if (!['none', 'segment', 'word', 'both'].includes(timestamps)) {
        throw new SttClientError({ code: 'INVALID_OPTIONS', message: 'Некорректная детализация timestamps' });
      }

      const form = new FormData();
      const filename = options.filename || audio.name || `recording.${extensionForMimeType(audio.type)}`;
      form.append('audio', audio, filename);
      form.append('language', options.language || 'ru');
      form.append('timestamps', timestamps);
      const { data, error } = await functionsClient.invoke('stt-transcribe', { body: form });
      if (error || data?.error) {
        const details = data?.error || {};
        throw new SttClientError({
          code: details.code || 'STT_REQUEST_FAILED',
          message: details.message || error?.message || 'Не удалось распознать аудио',
          retryable: Boolean(details.retryable),
          retryAfterSeconds: details.retry_after_seconds ?? null,
          cause: error,
        });
      }
      return validateResult(data);
    },
  };
}
