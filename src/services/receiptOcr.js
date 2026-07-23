export const RECEIPT_OCR_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const RECEIPT_OCR_DEFAULT_TIMEOUT_MS = 75_000;

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
  return String(value || '').trim().replace(/\/+$/u, '');
}

function validateImage(image) {
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
}

async function errorFromResponse(response) {
  let details = null;
  try {
    details = await response.json();
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
          code: 'NOT_CONFIGURED',
          message: 'Высокоточный OCR-сервер пока не настроен',
        });
      }
      if (!/^[0-9a-f-]{36}$/iu.test(String(workspaceId || ''))) {
        throw new ReceiptOcrClientError({ code: 'INVALID_WORKSPACE', message: 'Не выбрано рабочее пространство' });
      }
      if (typeof fetchImpl !== 'function') {
        throw new ReceiptOcrClientError({ code: 'NETWORK_UNAVAILABLE', message: 'Браузер не поддерживает отправку изображения' });
      }
      validateImage(image);

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
        const result = await response.json();
        const text = String(result?.text || '').trim();
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
          engine: String(result.engine || 'glm-ocr'),
          model: String(result.model || 'GLM-OCR'),
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
