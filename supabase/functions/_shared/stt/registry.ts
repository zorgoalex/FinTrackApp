import { SttError } from './errors.ts';
import { GroqSttProvider } from './providers/groq.ts';
import type { SttProvider, SttProviderId } from './types.ts';

export function createSttProvider(providerId = Deno.env.get('STT_PROVIDER')?.trim() || 'groq'): SttProvider {
  switch (providerId as SttProviderId) {
    case 'groq':
      return new GroqSttProvider({
        apiKey: Deno.env.get('GROQ_API_KEY') || '',
        model: Deno.env.get('GROQ_STT_MODEL') || 'whisper-large-v3',
        timeoutMs: Number(Deno.env.get('STT_TIMEOUT_MS')) || 45_000,
      });
    default:
      throw new SttError('PROVIDER_NOT_CONFIGURED', `Неизвестный STT-провайдер: ${providerId}`, 503);
  }
}
