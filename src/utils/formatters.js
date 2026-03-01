import { isToday, isYesterday, format } from 'date-fns';
import { ru } from 'date-fns/locale';

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
export function formatUnsignedAmount(value, symbol = '₸') {
  const n = parseAmount(value);
  return `${ruFormatter.format(Number.isFinite(n) ? Math.abs(n) : 0)} ${symbol}`;
}

/** Форматирует со знаком типа операции: «+1 234,56 ₽» */
export function formatSignedAmount(type, value, symbol = '₸') {
  const signs = { income: '+', expense: '−', salary: '−' };
  const sign = signs[type] ?? '';
  return `${sign}${formatUnsignedAmount(value, symbol)}`;
}

/** Форматирует баланс со знаком: «+1 234,56 ₽» или «−1 234,56 ₽» */
export function formatBalance(value, symbol = '₸') {
  const n = parseAmount(value);
  const abs = Number.isFinite(n) ? Math.abs(n) : 0;
  const sign = n >= 0 ? '+' : '−';
  return `${sign}${ruFormatter.format(abs)} ${symbol}`;
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
 * Formats a date string for use as a group header.
 * Returns "Сегодня", "Вчера", or a formatted date like "25 февраля 2026"
 */
export function formatGroupDate(dateStr) {
  if (!dateStr) return 'Без даты';
  const date = new Date(dateStr + 'T00:00:00'); // force local TZ
  if (Number.isNaN(date.getTime())) return 'Без даты';
  if (isToday(date)) return 'Сегодня';
  if (isYesterday(date)) return 'Вчера';
  return format(date, 'd MMMM yyyy', { locale: ru });
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

/* ===== Мультивалютные форматтеры ===== */

let _currencyMeta = {};

/** Инициализирует метаданные валют из справочника currencies */
export function setCurrencyMeta(currencies) {
  _currencyMeta = {};
  (currencies || []).forEach(c => {
    _currencyMeta[c.code] = { symbol: c.symbol, decimal_digits: c.decimal_digits ?? 2 };
  });
}

/** Возвращает символ валюты по коду */
export function getCurrencySymbol(code) {
  return _currencyMeta[code]?.symbol || code;
}

/** Форматирует сумму с символом валюты: «1 234,56 $» */
export function formatMoney(value, currencyCode = 'KZT') {
  const n = parseAmount(value);
  const digits = _currencyMeta[currencyCode]?.decimal_digits ?? 2;
  const sym = getCurrencySymbol(currencyCode);
  const fmt = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return `${fmt.format(Number.isFinite(n) ? Math.abs(n) : 0)} ${sym}`;
}

/** Форматирует со знаком типа операции: «+1 234,56 $» */
export function formatSignedMoney(type, value, currencyCode = 'KZT') {
  const signs = { income: '+', expense: '−', salary: '−' };
  const sign = signs[type] ?? '';
  return `${sign}${formatMoney(value, currencyCode)}`;
}

/** Форматирует баланс со знаком: «+1 234,56 $» или «−1 234,56 $» */
export function formatMoneyBalance(value, currencyCode = 'KZT') {
  const n = parseAmount(value);
  const digits = _currencyMeta[currencyCode]?.decimal_digits ?? 2;
  const sym = getCurrencySymbol(currencyCode);
  const abs = Number.isFinite(n) ? Math.abs(n) : 0;
  const sign = n >= 0 ? '+' : '−';
  const fmt = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return `${sign}${fmt.format(abs)} ${sym}`;
}
