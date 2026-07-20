export const OCR_MAX_PIXELS = 3_000_000;
export const OCR_MAX_DIMENSION = 2400;
export const OCR_TIMEOUT_MS = 75_000;

export function calculateOcrImageSize(
  width,
  height,
  {
    maxPixels = OCR_MAX_PIXELS,
    maxDimension = OCR_MAX_DIMENSION,
  } = {},
) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!(safeWidth > 0) || !(safeHeight > 0)) {
    throw new Error('Не удалось определить размер изображения');
  }

  const dimensionScale = Math.min(1, maxDimension / Math.max(safeWidth, safeHeight));
  const pixelScale = Math.min(1, Math.sqrt(maxPixels / (safeWidth * safeHeight)));
  const scale = Math.min(dimensionScale, pixelScale);

  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
    scale,
    resized: scale < 0.999,
  };
}

function cancellationError(message, name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

export async function runWithOcrDeadline(
  task,
  {
    signal,
    timeoutMs = OCR_TIMEOUT_MS,
    onCancel,
  } = {},
) {
  if (signal?.aborted) {
    onCancel?.('abort');
    throw cancellationError('Распознавание отменено', 'AbortError');
  }

  let timerId;
  let abortHandler;
  let cancelled = false;
  const cancellation = new Promise((_, reject) => {
    const cancel = (reason) => {
      if (cancelled) return;
      cancelled = true;
      Promise.resolve(onCancel?.(reason)).catch(() => {});
      reject(reason === 'timeout'
        ? cancellationError(
          `Локальное распознавание заняло больше ${Math.max(1, Math.ceil(timeoutMs / 1000))} секунд и было остановлено. Попробуйте обрезать фото до области чека.`,
          'OcrTimeoutError',
        )
        : cancellationError('Распознавание отменено', 'AbortError'));
    };

    timerId = globalThis.setTimeout(() => cancel('timeout'), timeoutMs);
    if (signal) {
      abortHandler = () => cancel('abort');
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });

  try {
    return await Promise.race([
      Promise.resolve().then(task),
      cancellation,
    ]);
  } finally {
    globalThis.clearTimeout(timerId);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}
