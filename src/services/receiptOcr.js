import { safePublicHttpsEndpoint } from '../utils/externalUrls.js';

export const RECEIPT_OCR_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const RECEIPT_OCR_DEFAULT_TIMEOUT_MS = 75_000;
export const RECEIPT_OCR_MAX_RESPONSE_BYTES = 512 * 1024;

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class ReceiptOcrClientError extends Error {
  constructor({ code, message, retryable = false, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReceiptOcrClientError';
    this.code = code;
    this.retryable = retryable;
  }
}

function normalizeEndpoint(value) {
  return safePublicHttpsEndpoint(value) || '';
}

function detectedImageType(bytes) {
  const ascii = String.fromCharCode(...bytes);
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function validateImage(image) {
  if (!(image instanceof Blob)) {
    throw new ReceiptOcrClientError({ code: 'INVALID_IMAGE', message: 'Ожидается изображение чека' });
  }
  if (image.size === 0) {
    throw new ReceiptOcrClientError({ code: 'INVALID_IMAGE', message: 'Изображение пустое' });
  }
  if (image.size > RECEIPT_OCR_MAX_FILE_BYTES) {
    throw new ReceiptOcrClientError({ code: 'FILE_TOO_LARGE', message: 'Изображение превышает 15 МБ' });
  }
  if (!SUPPORTED_TYPES.has(String(image.type || '').toLowerCase())) {
    throw new ReceiptOcrClientError({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Серверный OCR поддерживает JPG, PNG и WEBP',
    });
  }
  const signature = new Uint8Array(await image.slice(0, 16).arrayBuffer());
  if (detectedImageType(signature) !== String(image.type || '').toLowerCase()) {
    throw new ReceiptOcrClientError({
      code: 'MEDIA_SIGNATURE_MISMATCH',
      message: 'Тип изображения не соответствует содержимому файла',
    });
  }
}

async function readJsonWithLimit(response, maxBytes = RECEIPT_OCR_MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('response too large');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new globalThis.TextEncoder().encode(text).length > maxBytes) throw new Error('response too large');
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('response too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new globalThis.TextDecoder().decode(bytes));
}

function cleanMetadata(value, maxLength = 80) {
  return Array.from(String(value || ''))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .slice(0, maxLength);
}

async function errorFromResponse(response) {
  let details = null;
  try {
    details = await readJsonWithLimit(response, 64 * 1024);
  } catch {
    // The OCR gateway may be temporarily unavailable and return a proxy error page.
  }
  return new ReceiptOcrClientError({
    code: details?.error?.code || `HTTP_${response.status}`,
    message: details?.error?.message || `OCR-сервер вернул ошибку ${response.status}`,
    retryable: details?.error?.retryable ?? response.status >= 429,
  });
}

export function createReceiptOcrClient({
  endpoint,
  supabase,
  fetchImpl = globalThis.fetch,
  timeoutMs = RECEIPT_OCR_DEFAULT_TIMEOUT_MS,
} = {}) {
  const baseUrl = normalizeEndpoint(endpoint);

  return {
    isConfigured: Boolean(baseUrl),

    async recognize(image, { workspaceId, signal, onProgress } = {}) {
      if (!baseUrl) {
        throw new ReceiptOcrClientError({
          code: endpoint ? 'UNSAFE_ENDPOINT' : 'NOT_CONFIGURED',
          message: endpoint ? 'OCR endpoint не прошёл проверку безопасности' : 'Высокоточный OCR-сервер пока не настроен',
        });
      }
      if (!/^[0-9a-f-]{36}$/iu.test(String(workspaceId || ''))) {
        throw new ReceiptOcrClientError({ code: 'INVALID_WORKSPACE', message: 'Не выбрано рабочее пространство' });
      }
      if (typeof fetchImpl !== 'function') {
        throw new ReceiptOcrClientError({ code: 'NETWORK_UNAVAILABLE', message: 'Браузер не поддерживает отправку изображения' });
      }
      await validateImage(image);

      const { data, error } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (error || !accessToken) {
        throw new ReceiptOcrClientError({ code: 'UNAUTHORIZED', message: 'Сессия истекла. Войдите снова.' });
      }

      const controller = new globalThis.AbortController();
      const abortFromCaller = () => controller.abort(signal?.reason);
      if (signal?.aborted) abortFromCaller();
      else signal?.addEventListener('abort', abortFromCaller, { once: true });
      const timer = globalThis.setTimeout(() => controller.abort(new Error('OCR timeout')), timeoutMs);
      let recognizingTimer = null;

      try {
        onProgress?.({ stage: 'ocr', engine: 'glm-ocr', status: 'uploading', overallProgress: 0.12 });
        recognizingTimer = globalThis.setTimeout(() => {
          onProgress?.({ stage: 'ocr', engine: 'glm-ocr', status: 'recognizing', overallProgress: 0.35 });
        }, 400);
        const response = await fetchImpl(`${baseUrl}/v1/ocr`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': image.type,
            'X-Workspace-Id': workspaceId,
          },
          body: image,
          signal: controller.signal,
        });
        if (!response.ok) throw await errorFromResponse(response);
        onProgress?.({ stage: 'ocr', engine: 'glm-ocr', status: 'recognizing', overallProgress: 0.88 });
        const result = await readJsonWithLimit(response);
        const text = String(result?.text || '').trim().slice(0, 100_000);
        if (!text) {
          throw new ReceiptOcrClientError({
            code: 'EMPTY_RESULT',
            message: 'GLM-OCR не вернул читаемый текст',
            retryable: true,
          });
        }
        onProgress?.({ stage: 'ocr', engine: 'glm-ocr', status: 'complete', overallProgress: 0.96 });
        return {
          text,
          engine: cleanMetadata(result.engine || 'glm-ocr'),
          model: cleanMetadata(result.model || 'GLM-OCR'),
          latencyMs: Number.isFinite(result.latency_ms) ? result.latency_ms : null,
          requestId: result.request_id || null,
        };
      } catch (requestError) {
        if (requestError instanceof ReceiptOcrClientError) throw requestError;
        if (controller.signal.aborted) {
          const cancelledByUser = Boolean(signal?.aborted);
          const aborted = new Error(cancelledByUser
            ? 'Распознавание отменено'
            : `OCR-сервер не ответил за ${Math.ceil(timeoutMs / 1000)} секунд`);
          aborted.name = cancelledByUser ? 'AbortError' : 'OcrTimeoutError';
          throw aborted;
        }
        throw new ReceiptOcrClientError({
          code: 'NETWORK_ERROR',
          message: 'Не удалось связаться с OCR-сервером',
          retryable: true,
          cause: requestError,
        });
      } finally {
        globalThis.clearTimeout(timer);
        if (recognizingTimer) globalThis.clearTimeout(recognizingTimer);
        signal?.removeEventListener('abort', abortFromCaller);
      }
    },
  };
}
