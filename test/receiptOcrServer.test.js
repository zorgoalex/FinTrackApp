import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { buildLlamaRequest, detectImageMime } from '../services/receipt-ocr/server.mjs';

test('receipt OCR gateway verifies image signatures instead of trusting content-type', () => {
  assert.equal(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(detectImageMime(Buffer.from('RIFF0000WEBP')), 'image/webp');
  assert.equal(detectImageMime(Buffer.from('not an image')), null);
});

test('receipt OCR gateway builds the proven GLM-OCR multimodal request', () => {
  const request = buildLlamaRequest(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', {
    model: 'GLM-OCR',
    maxTokens: 1800,
  });
  assert.equal(request.model, 'GLM-OCR');
  assert.equal(request.temperature, 0);
  assert.equal(request.max_tokens, 1800);
  assert.equal(request.messages[0].content[0].text, 'Text Recognition:');
  assert.match(request.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
});
