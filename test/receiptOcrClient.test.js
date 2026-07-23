import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReceiptOcrClient,
  ReceiptOcrClientError,
  RECEIPT_OCR_MAX_FILE_BYTES,
} from '../src/services/receiptOcr.js';

const workspaceId = '265c4155-51b1-41c3-b4ae-f08fa26b0eaa';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function authenticatedSupabase() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'test-access-token' } },
        error: null,
      }),
    },
  };
}

test('receipt OCR client sends the image with user auth and workspace scope', async () => {
  let request;
  const progress = [];
  const client = createReceiptOcrClient({
    endpoint: 'https://ocr.example.com/',
    supabase: authenticatedSupabase(),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        text: '20.07.2026\nИТОГО 2180.00',
        engine: 'glm-ocr',
        model: 'GLM-OCR',
        latency_ms: 6800,
        request_id: 'request-1',
      });
    },
  });
  const image = new Blob(['receipt'], { type: 'image/jpeg' });

  const result = await client.recognize(image, {
    workspaceId,
    onProgress: (value) => progress.push(value),
  });

  assert.equal(request.url, 'https://ocr.example.com/v1/ocr');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-access-token');
  assert.equal(request.options.headers['X-Workspace-Id'], workspaceId);
  assert.equal(request.options.headers['Content-Type'], 'image/jpeg');
  assert.equal(request.options.body, image);
  assert.equal(result.text, '20.07.2026\nИТОГО 2180.00');
  assert.equal(result.engine, 'glm-ocr');
  assert.equal(result.latencyMs, 6800);
  assert.ok(progress.some((item) => item.status === 'uploading'));
  assert.ok(progress.some((item) => item.status === 'complete'));
});

test('receipt OCR client requires an explicit configured endpoint', async () => {
  const client = createReceiptOcrClient({ supabase: authenticatedSupabase() });
  assert.equal(client.isConfigured, false);
  await assert.rejects(
    () => client.recognize(new Blob(['receipt'], { type: 'image/jpeg' }), { workspaceId }),
    (error) => error instanceof ReceiptOcrClientError && error.code === 'NOT_CONFIGURED',
  );
});

test('receipt OCR client rejects unsupported and oversized images before upload', async () => {
  const client = createReceiptOcrClient({
    endpoint: 'https://ocr.example.com',
    supabase: authenticatedSupabase(),
    fetchImpl: async () => assert.fail('fetch must not be called'),
  });
  await assert.rejects(
    () => client.recognize(new Blob(['not-an-image'], { type: 'application/pdf' }), { workspaceId }),
    { code: 'UNSUPPORTED_MEDIA_TYPE' },
  );
  await assert.rejects(
    () => client.recognize(new Blob([new Uint8Array(RECEIPT_OCR_MAX_FILE_BYTES + 1)], { type: 'image/png' }), { workspaceId }),
    { code: 'FILE_TOO_LARGE' },
  );
});

test('receipt OCR client exposes safe retryable server errors', async () => {
  const client = createReceiptOcrClient({
    endpoint: 'https://ocr.example.com',
    supabase: authenticatedSupabase(),
    fetchImpl: async () => jsonResponse({
      error: { code: 'OCR_UNAVAILABLE', message: 'OCR-модель временно недоступна', retryable: true },
    }, 503),
  });

  await assert.rejects(
    () => client.recognize(new Blob(['receipt'], { type: 'image/webp' }), { workspaceId }),
    (error) => error instanceof ReceiptOcrClientError
      && error.code === 'OCR_UNAVAILABLE'
      && error.retryable,
  );
});
