import test from 'node:test';
import assert from 'node:assert/strict';
import { createSttClient, SttClientError, STT_MAX_FILE_BYTES } from '../src/services/stt.js';

test('STT client sends provider-neutral multipart input and normalizes the response', async () => {
  let invocation;
  const client = createSttClient({
    invoke: async (name, options) => {
      invocation = { name, options };
      return {
        data: {
          transcript: 'Запиши пять тысяч тенге на продукты.',
          provider: 'groq',
          model: 'whisper-large-v3',
          language: 'ru',
          duration_seconds: 2.4,
          segments: [],
          words: [],
          request_id: 'req-1',
        },
        error: null,
      };
    },
  });
  const audio = new Blob(['audio'], { type: 'audio/webm' });
  const result = await client.transcribe(audio, { timestamps: 'both' });

  assert.equal(invocation.name, 'stt-transcribe');
  assert.ok(invocation.options.body instanceof FormData);
  assert.equal(invocation.options.body.get('language'), 'ru');
  assert.equal(invocation.options.body.get('timestamps'), 'both');
  assert.equal(result.transcript, 'Запиши пять тысяч тенге на продукты.');
  assert.equal(result.provider, 'groq');
  assert.equal(result.durationSeconds, 2.4);
  assert.equal(result.requestId, 'req-1');
});
test('STT client exposes normalized provider errors', async () => {
  const client = createSttClient({
    invoke: async () => ({
      data: { error: { code: 'PROVIDER_RATE_LIMITED', message: 'Лимит исчерпан', retryable: true, retry_after_seconds: 30 } },
      error: null,
    }),
  });

  await assert.rejects(
    () => client.transcribe(new Blob(['audio'], { type: 'audio/wav' })),
    (error) => error instanceof SttClientError
      && error.code === 'PROVIDER_RATE_LIMITED'
      && error.retryable
      && error.retryAfterSeconds === 30,
  );
});

test('STT client rejects oversized audio before upload', async () => {
  const client = createSttClient({ invoke: async () => assert.fail('invoke must not be called') });
  const audio = new Blob([new Uint8Array(STT_MAX_FILE_BYTES + 1)], { type: 'audio/webm' });
  await assert.rejects(() => client.transcribe(audio), { code: 'FILE_TOO_LARGE' });
});
