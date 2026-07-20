import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOcrImageSize,
  runWithOcrDeadline,
} from '../src/utils/documentImport/ocrPolicy.js';

test('keeps receipt photos at their original size instead of upscaling them', () => {
  assert.deepEqual(calculateOcrImageSize(729, 2000), {
    width: 729,
    height: 2000,
    scale: 1,
    resized: false,
  });
});

test('limits large camera photos to three megapixels', () => {
  assert.deepEqual(calculateOcrImageSize(4000, 3000), {
    width: 2000,
    height: 1500,
    scale: 0.5,
    resized: true,
  });
});

test('limits unusually tall images by their longest dimension', () => {
  assert.deepEqual(calculateOcrImageSize(1000, 5000), {
    width: 480,
    height: 2400,
    scale: 0.48,
    resized: true,
  });
});

test('stops OCR when the user cancels processing', async () => {
  const controller = new globalThis.AbortController();
  let cancellationReason = '';
  const result = runWithOcrDeadline(
    () => new Promise(() => {}),
    {
      signal: controller.signal,
      timeoutMs: 1000,
      onCancel: (reason) => { cancellationReason = reason; },
    },
  );

  controller.abort();
  await assert.rejects(result, (error) => error.name === 'AbortError');
  assert.equal(cancellationReason, 'abort');
});

test('stops OCR after the configured deadline', async () => {
  let cancellationReason = '';
  await assert.rejects(
    runWithOcrDeadline(
      () => new Promise(() => {}),
      {
        timeoutMs: 10,
        onCancel: (reason) => { cancellationReason = reason; },
      },
    ),
    (error) => error.name === 'OcrTimeoutError' && /1 секунд/.test(error.message),
  );
  assert.equal(cancellationReason, 'timeout');
});
