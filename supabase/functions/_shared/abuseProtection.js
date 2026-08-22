export class PayloadTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Payload exceeds ${maxBytes} bytes`);
    this.name = 'PayloadTooLargeError';
    this.maxBytes = maxBytes;
  }
}

export class UpstreamTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Upstream request timed out after ${timeoutMs} ms`);
    this.name = 'UpstreamTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function checkedLimit(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }
  return maxBytes;
}

function declaredLength(headers) {
  const raw = headers.get('content-length');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function readStreamWithLimit(stream, maxBytes) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('payload too large').catch(() => {});
        throw new PayloadTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readBodyWithLimit(request, maxBytes) {
  checkedLimit(maxBytes);
  const length = declaredLength(request.headers);
  if (length !== null && length > maxBytes) throw new PayloadTooLargeError(maxBytes);
  return readStreamWithLimit(request.body, maxBytes);
}

export async function readJsonWithLimit(request, maxBytes) {
  const body = await readBodyWithLimit(request, maxBytes);
  if (body.byteLength === 0) return null;
  return JSON.parse(new TextDecoder().decode(body));
}

export async function readFormDataWithLimit(request, maxBytes) {
  const contentType = request.headers.get('content-type') || '';
  const body = await readBodyWithLimit(request, maxBytes);
  return new Response(body, { headers: { 'content-type': contentType } }).formData();
}

export async function readResponseTextWithLimit(response, maxBytes) {
  checkedLimit(maxBytes);
  const length = declaredLength(response.headers);
  if (length !== null && length > maxBytes) {
    await response.body?.cancel('upstream payload too large').catch(() => {});
    throw new PayloadTooLargeError(maxBytes);
  }
  const body = await readStreamWithLimit(response.body, maxBytes);
  return new TextDecoder().decode(body);
}

export async function readResponseJsonWithLimit(response, maxBytes) {
  const text = await readResponseTextWithLimit(response, maxBytes);
  return JSON.parse(text);
}

export async function fetchWithTimeout(input, options = {}, timeoutMs = 10_000, fetchImpl = fetch) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
  const controller = new AbortController();
  const parentSignal = options.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new UpstreamTimeoutError(timeoutMs)), timeoutMs);

  try {
    return await fetchImpl(input, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !parentSignal?.aborted) {
      throw controller.signal.reason instanceof UpstreamTimeoutError
        ? controller.signal.reason
        : new UpstreamTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}
