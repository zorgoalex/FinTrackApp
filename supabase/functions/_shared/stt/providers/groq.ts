import { SttError } from '../errors.ts';
import type { SttProvider, SttRequest, SttResult } from '../types.ts';

const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3';
const DEFAULT_TIMEOUT_MS = 45_000;

type GroqSegment = {
  start?: number;
  end?: number;
  text?: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  compression_ratio?: number;
};

type GroqWord = {
  start?: number;
  end?: number;
  word?: string;
};

type GroqResponse = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: GroqSegment[];
  words?: GroqWord[];
  x_groq?: { id?: string };
};

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

async function providerMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return String(payload?.error?.message || payload?.message || `HTTP ${response.status}`).slice(0, 300);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export class GroqSttProvider implements SttProvider {
  readonly id = 'groq' as const;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #timeoutMs: number;

  constructor(options: { apiKey: string; model?: string; timeoutMs?: number }) {
    this.#apiKey = options.apiKey.trim();
    this.#model = options.model?.trim() || DEFAULT_MODEL;
    this.#timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    if (!this.#apiKey) {
      throw new SttError('PROVIDER_NOT_CONFIGURED', 'Groq STT не настроен', 503);
    }
  }

  async transcribe(request: SttRequest): Promise<SttResult> {
    const startedAt = performance.now();
    const form = new FormData();
    form.append('file', request.audio, request.audio.name || 'audio.webm');
    form.append('model', this.#model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (request.language) form.append('language', request.language);
    if (request.prompt) form.append('prompt', request.prompt);
    for (const granularity of request.timestampGranularities) {
      form.append('timestamp_granularities[]', granularity);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await fetch(GROQ_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new SttError('PROVIDER_TIMEOUT', 'Groq не успел обработать аудио', 504, true);
      }
      throw new SttError('PROVIDER_ERROR', 'Не удалось связаться с Groq', 502, true);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const message = await providerMessage(response);
      if (response.status === 429) {
        throw new SttError(
          'PROVIDER_RATE_LIMITED',
          'Лимит Groq временно исчерпан',
          429,
          true,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
      const retryable = response.status >= 500;
      throw new SttError('PROVIDER_ERROR', `Groq отклонил аудио: ${message}`, retryable ? 502 : 422, retryable);
    }

    let payload: GroqResponse;
    try {
      payload = await response.json();
    } catch {
      throw new SttError('INVALID_PROVIDER_RESPONSE', 'Groq вернул некорректный ответ', 502, true);
    }

    const transcript = String(payload.text || '').trim();
    if (!transcript && !Array.isArray(payload.segments)) {
      throw new SttError('INVALID_PROVIDER_RESPONSE', 'Groq не вернул результат распознавания', 502, true);
    }

    return {
      transcript,
      provider: this.id,
      model: this.#model,
      language: payload.language || request.language || null,
      duration_seconds: finiteNumber(payload.duration),
      segments: (payload.segments || []).map((segment) => ({
        start_seconds: finiteNumber(segment.start) || 0,
        end_seconds: finiteNumber(segment.end) || 0,
        text: String(segment.text || '').trim(),
        avg_log_probability: finiteNumber(segment.avg_logprob),
        no_speech_probability: finiteNumber(segment.no_speech_prob),
        compression_ratio: finiteNumber(segment.compression_ratio),
      })),
      words: (payload.words || []).map((word) => ({
        start_seconds: finiteNumber(word.start) || 0,
        end_seconds: finiteNumber(word.end) || 0,
        text: String(word.word || '').trim(),
      })),
      request_id: payload.x_groq?.id || response.headers.get('x-request-id') || null,
      latency_ms: Math.round(performance.now() - startedAt),
    };
  }
}
