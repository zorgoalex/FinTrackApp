const SENSITIVE_PATTERNS = [
  { type: 'iin_bin', label: 'ИИН/БИН', regex: /(?:ИИН|БИН)(?:\s*\/\s*БИН)?\s*[:№]?\s*\d{12}(?!\d)/giu },
  { type: 'iban', label: 'банковский счёт', regex: /\bKZ[0-9A-Z]{18}\b/giu },
  { type: 'card', label: 'номер карты', regex: /\b(?:\d[ -]?){12,19}\b/g },
  { type: 'phone', label: 'телефон', regex: /(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g },
  { type: 'email', label: 'email', regex: /[\w.+-]+@[\w.-]+\.[A-Za-zА-Яа-я]{2,}/g },
  { type: 'receipt', label: 'номер документа', regex: /\b(?:№\s*(?:чека|квитанции)|номер\s+(?:операции|документа|плат[её]жного поручения)|идентификатор|референс)\s*[:№]?\s*[A-ZА-Я0-9-]{6,}\b/giu },
];

export function detectSensitiveData(text) {
  return SENSITIVE_PATTERNS.flatMap(({ type, label, regex }) => {
    regex.lastIndex = 0;
    const count = Array.from(String(text || '').matchAll(regex)).length;
    return count ? [{ type, label, count }] : [];
  });
}

export function redactSensitiveText(value) {
  let text = String(value || '');
  for (const { label, regex } of SENSITIVE_PATTERNS) {
    regex.lastIndex = 0;
    text = text.replace(regex, `[скрыто: ${label}]`);
  }
  text = text
    .replace(/((?:ФИО|клиент|владелец|отправитель|получатель|налогоплательщик)\s*[:：]?\s*)([^\n,;]{3,80})/giu, '$1[скрыто: ФИО]')
    .replace(/(Перевод\s+)([А-ЯЁA-Z][а-яёa-z-]+\s+[А-ЯЁA-Z]\.?)(?=\s|$)/gu, '$1[получатель скрыт]');
  return text.replace(/\s{2,}/g, ' ').trim();
}

export async function sha256Hex(value) {
  const bytes = value instanceof ArrayBuffer
    ? value
    : new globalThis.TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function operationFingerprint(operation, bank = 'unknown') {
  const stableReference = operation.reference || redactSensitiveText(operation.description || '').toLocaleLowerCase('ru-RU');
  return sha256Hex([
    bank,
    operation.operation_date,
    Number(operation.amount).toFixed(2),
    operation.currency || 'KZT',
    operation.type,
    stableReference,
  ].join('|'));
}
