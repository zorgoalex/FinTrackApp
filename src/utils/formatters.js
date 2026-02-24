/**
 * Общие утилиты форматирования чисел для FinTrackApp.
 * Русский формат: пробел — разделитель разрядов, запятая — дробная часть.
 * Пример: 1 234 567,89 ₽
 */

const ruFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Форматирует абсолютное значение: «1 234,56 ₽» */
export function formatUnsignedAmount(value) {
  const n = parseAmount(value);
  return `${ruFormatter.format(Number.isFinite(n) ? Math.abs(n) : 0)} ₽`;
}

/** Форматирует со знаком типа операции: «+1 234,56 ₽» */
export function formatSignedAmount(type, value) {
  const signs = { income: '+', expense: '−', salary: '−' };
  const sign = signs[type] ?? '';
  return `${sign}${formatUnsignedAmount(value)}`;
}

/** Форматирует баланс со знаком: «+1 234,56 ₽» или «−1 234,56 ₽» */
export function formatBalance(value) {
  const n = parseAmount(value);
  const abs = Number.isFinite(n) ? Math.abs(n) : 0;
  const sign = n >= 0 ? '+' : '−';
  return `${sign}${ruFormatter.format(abs)} ₽`;
}

/**
 * Парсит строку ввода суммы в число.
 * Принимает: «1 234,56», «1234.56», «1234», «1,5» и т.д.
 * Возвращает NaN при некорректном вводе.
 */
export function parseAmount(str) {
  if (str === null || str === undefined || str === '') return NaN;
  // убираем пробелы (разделители разрядов), меняем запятую на точку
  const clean = String(str).replace(/\s/g, '').replace(',', '.');
  return parseFloat(clean);
}

/**
 * Нормализует ввод суммы: оставляет только цифры и запятую/точку (без пробелов).
 * Заменяет точку на запятую для единообразия.
 */
export function normalizeAmountInput(raw) {
  return raw
    .replace(/[^0-9.,]/g, '')   // только цифры, точка, запятая
    .replace('.', ',');          // точку → запятую
}

/**
 * Форматирует строку суммы для отображения в поле ввода (когда не в фокусе).
 * «25000,5» → «25 000,5»
 */
export function formatAmountInput(str) {
  if (!str && str !== 0) return '';
  const s = String(str).replace(/\s/g, '');
  const [intPart, decPart] = s.split(',');
  // разбиваем целую часть на группы по 3 (неразрывный пробел)
  const formatted = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return decPart !== undefined ? `${formatted},${decPart}` : formatted;
}
