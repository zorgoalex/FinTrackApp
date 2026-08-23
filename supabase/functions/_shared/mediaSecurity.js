const AUDIO_SIGNATURE_BYTES = 32;

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export function detectAudioContainer(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (ascii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return 'webm';
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) return 'mp3';
  if (ascii(bytes, 4, 4) === 'ftyp') return 'mp4';
  return null;
}

const EXTENSION_CONTAINERS = new Map([
  ['flac', new Set(['flac'])],
  ['mp3', new Set(['mp3'])],
  ['mpeg', new Set(['mp3'])],
  ['mpga', new Set(['mp3'])],
  ['mp4', new Set(['mp4'])],
  ['m4a', new Set(['mp4'])],
  ['ogg', new Set(['ogg'])],
  ['wav', new Set(['wav'])],
  ['webm', new Set(['webm'])],
]);

const MIME_CONTAINERS = new Map([
  ['audio/flac', new Set(['flac'])],
  ['audio/m4a', new Set(['mp4'])],
  ['audio/mp3', new Set(['mp3'])],
  ['audio/mp4', new Set(['mp4'])],
  ['audio/mpeg', new Set(['mp3'])],
  ['audio/ogg', new Set(['ogg'])],
  ['audio/wav', new Set(['wav'])],
  ['audio/webm', new Set(['webm'])],
  ['audio/x-m4a', new Set(['mp4'])],
  ['audio/x-wav', new Set(['wav'])],
  ['video/mp4', new Set(['mp4'])],
  ['video/webm', new Set(['webm'])],
]);

export async function validateAudioSignature(file, extension = '', mimeType = '') {
  const bytes = new Uint8Array(await file.slice(0, AUDIO_SIGNATURE_BYTES).arrayBuffer());
  const container = detectAudioContainer(bytes);
  if (!container) throw new Error('Сигнатура аудиофайла не распознана');
  const expected = EXTENSION_CONTAINERS.get(String(extension || '').toLowerCase());
  if (expected && !expected.has(container)) throw new Error('Расширение аудиофайла не соответствует его содержимому');
  const expectedByMime = MIME_CONTAINERS.get(String(mimeType || '').toLowerCase());
  if (expectedByMime && !expectedByMime.has(container)) throw new Error('MIME-тип аудиофайла не соответствует его содержимому');
  return container;
}
