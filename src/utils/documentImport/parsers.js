import { operationFingerprint, redactSensitiveText } from './privacy.js';

const TYPE_WORDS = 'Покупка|Пополнение|Перевод|Снятие|Разное|Платеж|Платёж|Комиссия';

function parseMoney(value) {
  let normalized = String(value || '')
    .replace(/[₸$€₽KZTUSDEURRUB]/gi, '')
    .replace(/\s/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    const decimalSeparator = normalized.lastIndexOf(',') > normalized.lastIndexOf('.') ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? /\./g : /,/g;
    normalized = normalized.replace(thousandsSeparator, '').replace(decimalSeparator, '.');
  } else if (normalized.includes(',')) {
    normalized = /,\d{1,2}$/.test(normalized) ? normalized.replace(',', '.') : normalized.replace(/,/g, '');
  } else if ((normalized.match(/\./g) || []).length > 1) {
    const last = normalized.lastIndexOf('.');
    normalized = `${normalized.slice(0, last).replace(/\./g, '')}${normalized.slice(last)}`;
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.abs(amount) : NaN;
}

function parseDate(value) {
  const match = String(value || '').match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4}|\d{2})/);
  if (!match) return '';
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function normalizeCurrency(symbol, code) {
  if (/\$|USD/i.test(`${symbol} ${code}`)) return 'USD';
  if (/€|EUR/i.test(`${symbol} ${code}`)) return 'EUR';
  if (/₽|RUB/i.test(`${symbol} ${code}`)) return 'RUB';
  return 'KZT';
}

function mapDirection(sign, operationWord) {
  if (sign === '+' || /пополнение|возврат|зачисление|поступление/i.test(operationWord)) return 'income';
  return 'expense';
}

function cleanDetails(value, operationWord) {
  const details = String(value || '').replace(/\s+/g, ' ').trim();
  return redactSensitiveText(details || operationWord || 'Импортированная операция').slice(0, 240);
}

export function detectDocumentKind(text) {
  const value = String(text || '');
  const candidates = [
    { bank: 'kaspi', index: value.search(/kaspi|каспи/i) },
    { bank: 'freedom', index: value.search(/freedom|фридом|bankffin/i) },
    { bank: 'halyk', index: value.search(/halyk|халық|народн/i) },
  ].filter((candidate) => candidate.index >= 0).sort((a, b) => a.index - b.index);
  const bank = candidates[0]?.bank || 'unknown';
  const datedSignedRows = value.match(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\s*[+-]\s*\d/g) || [];
  const isStatement = /выписка|краткое содержание операций|дата\s+сумма\s+(?:валюта\s+)?операция/i.test(value)
    || datedSignedRows.length >= 3;
  return { bank, documentType: isStatement ? 'statement' : 'receipt' };
}

function normalizeOcrArtifacts(text) {
  return String(text || '')
    .replace(/(\d{2}\.)\s+(?=\d)/g, '$1')
    .replace(/(\d{2}\.\d{2}\.\d{2,4})\s*=\s*(?=\d)/g, '$1 - ')
    .replace(/([,.]\d{2})\s*[7TТ](?=\s|$)/giu, '$1 ₸')
    .replace(/([\d ])\s+[TТ](?=\s|$)/giu, '$1 ₸');
}

function extractReceiptItems(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const ignored = /итог|всего|скидк|безнал|налич|сдач|ндс|оплат|т[өе]лем|жиын|жалпы|кассир|оператор|фиск|бин|иин|рнм|знм|ккм|чек|дата|время|телефон|consumer|oofd|спасибо/iu;
  const pricePattern = /(?:=|x\s*)?([1-9][\d ]*[,.]\d{1,2})(?:\s*(?:₸|тг|тенге|KZT|[TТ]))?/iu;
  const items = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const price = line.match(pricePattern);
    if (!price || ignored.test(line)) continue;
    let label = /\p{L}{3}/u.test(line) ? line : lines[index - 1] || '';
    if (!label || ignored.test(label) || !/\p{L}{3}/u.test(label)) continue;
    label = label.replace(/^\d{5,}\s*/u, '').trim();
    const amount = price[1].replace(/\s+/g, ' ');
    const normalized = redactSensitiveText(label.includes(price[0]) ? label : `${label} — ${amount}`).slice(0, 240);
    if (normalized && !items.includes(normalized)) items.push(normalized);
    if (items.length >= 30) break;
  }

  return items.length ? `Распознано автоматически — проверьте позиции:\n${items.map((item) => `• ${item}`).join('\n')}`.slice(0, 5000) : '';
}

function parseKaspiStatement(text) {
  const rows = [];
  const regex = new RegExp(`(\\d{2}\\.\\d{2}\\.(?:\\d{4}|\\d{2}))\\s*([+-])\\s*([\\d ]+(?:[,.]\\d{2})?)\\s*(₸|KZT)\\s*(${TYPE_WORDS})\\s*([\\s\\S]*?)(?=\\d{2}\\.\\d{2}\\.(?:\\d{4}|\\d{2})\\s*[+-]|АО [«"]?Kaspi|$)`, 'giu');
  for (const match of text.matchAll(regex)) {
    const amount = parseMoney(match[3]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    rows.push({
      operation_date: parseDate(match[1]),
      type: mapDirection(match[2], match[5]),
      amount,
      currency: 'KZT',
      description: cleanDetails(match[6], match[5]),
      source_label: match[5],
      confidence: 0.94,
    });
  }
  return rows;
}

function parseFreedomStatement(text) {
  const rows = [];
  const regex = new RegExp(`(\\d{2}\\.\\d{2}\\.(?:\\d{4}|\\d{2}))\\s*([+-])\\s*([\\d ,]+(?:\\.\\d{2})?)\\s*(₸|\\$|€|₽)\\s*(KZT|USD|EUR|RUB)?\\s*(${TYPE_WORDS})\\s*([\\s\\S]*?)(?=\\d{2}\\.\\d{2}\\.(?:\\d{4}|\\d{2})\\s*[+-]|Подлинность|$)`, 'giu');
  for (const match of text.matchAll(regex)) {
    const amount = parseMoney(match[3]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    rows.push({
      operation_date: parseDate(match[1]),
      type: mapDirection(match[2], match[6]),
      amount,
      currency: normalizeCurrency(match[4], match[5]),
      description: cleanDetails(match[7], match[6]),
      source_label: match[6],
      confidence: 0.94,
    });
  }
  return rows;
}

function parseGenericReceipt(text) {
  const dateCandidates = Array.from(text.matchAll(/(?<!\d)(\d{1,2}[.\-/]\d{1,2}[.\-/](?:\d{4}|\d{2}))(?!\d)/gu))
    .map((match) => {
      const nearby = text.slice(Math.max(0, match.index - 50), match.index + match[0].length + 20);
      let score = 0;
      if (/\d{1,2}[:.]\d{2}/u.test(nearby.slice(match[0].length))) score += 4;
      if (/дата|время|продажа|операц/iu.test(nearby)) score += 2;
      if (/св\.\s*по\s*ндс|свидетель|сертифик/iu.test(nearby)) score -= 5;
      const parsed = parseDate(match[1]);
      const year = Number(parsed.slice(0, 4));
      if (year >= 2009 && year <= new Date().getFullYear() + 1) score += 1;
      return { match, score, parsed };
    })
    .filter(({ parsed }) => parsed)
    .sort((a, b) => b.score - a.score || b.match.index - a.match.index);
  const dateMatch = dateCandidates[0]?.match;
  const totalMatch = text.match(/(?:ЖИЫНЫ?|ИТОГ(?:О|А)?|ВСЕГО|ЖАЛПЫ(?:\s+[ТT?ӨО]ЛЕМГЕ)?|TOTAL)[^\d]{0,24}=?\s*([\d ]+(?:[,.]\d{1,2}))/iu);
  const labelledAmountMatch = text.match(/(?:оплаченн(?:ая|о)\s+сумма|сумма платежа|плат[её]ж успешно совершен)[^\d]{0,24}([\d ]+(?:[,.]\d{2}))/iu);
  const fallbackDecimalAmounts = Array.from(text.matchAll(/(?<!\d)([1-9][\d ]*[,.]\d{2})(?!\d)/g))
    .map((match) => ({ match: [match[0], match[1], 'KZT'], amount: parseMoney(match[1]), inferredCurrency: 'KZT' }))
    .filter(({ amount }) => Number.isFinite(amount) && amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const amountMatches = Array.from(text.matchAll(/([+-]?\s*[\d ]+(?:[,.]\d{2})?)\s*(₸|KZT\b|\$|USD\b|€|EUR\b|₽|RUB\b|[TТ]\b)/giu));
  const meaningfulAmount = totalMatch
    ? { match: totalMatch, amount: parseMoney(totalMatch[1]), inferredCurrency: 'KZT' }
    : labelledAmountMatch
      ? { match: labelledAmountMatch, amount: parseMoney(labelledAmountMatch[1]), inferredCurrency: 'KZT' }
    : amountMatches
    .map((match) => ({ match, amount: parseMoney(match[1]) }))
    .filter(({ amount }) => Number.isFinite(amount) && amount > 0)
    .sort((a, b) => b.amount - a.amount)[0] || fallbackDecimalAmounts[0];
  if (!dateMatch && !meaningfulAmount) return [];
  const successfulIndex = text.search(/(?:плат[её]ж|перевод) успешно|успешно совершен/iu);
  const header = text.slice(0, successfulIndex > 0 ? successfulIndex : 180)
    .split(/\n/).map((line) => line.trim()).filter(Boolean).slice(-3).join(' · ');
  const operationWord = /перевод/iu.test(text) ? 'Перевод' : /налог|социальн|плат[её]ж/iu.test(text) ? 'Платёж' : 'Покупка';
  const sign = /возврат|пополнение|зачислен/iu.test(text) ? '+' : '-';
  const reference = text.match(/(?:№\s*(?:чека|квитанции)|номер операции|референс)\s*[:№]?\s*([A-ZА-Я0-9-]{6,})/iu)?.[1] || '';
  return [{
    operation_date: dateMatch ? parseDate(dateMatch[1]) : '',
    type: mapDirection(sign, operationWord),
    amount: meaningfulAmount?.amount || '',
    currency: meaningfulAmount?.inferredCurrency || normalizeCurrency(meaningfulAmount?.match?.[2], meaningfulAmount?.match?.[2]),
    description: cleanDetails(header, operationWord),
    source_label: operationWord,
    reference,
    receipt_items_comment: extractReceiptItems(text),
    confidence: dateMatch && meaningfulAmount ? 0.82 : 0.55,
  }];
}

export async function parseBankDocumentText(text, sourceKind = 'pdf') {
  const normalizedText = sourceKind === 'image' ? normalizeOcrArtifacts(text) : text;
  const detected = detectDocumentKind(normalizedText);
  let rows = [];
  if (detected.documentType === 'statement' && detected.bank === 'kaspi') rows = parseKaspiStatement(normalizedText);
  if (detected.documentType === 'statement' && detected.bank === 'freedom') rows = parseFreedomStatement(normalizedText);
  if (rows.length === 0) rows = parseGenericReceipt(normalizedText);
  const operations = await Promise.all(rows.map(async (row) => ({
    ...row,
    source_kind: sourceKind,
    bank: detected.bank,
    import_fingerprint: await operationFingerprint(row, detected.bank),
    selected: true,
    duplicate: false,
  })));
  return { ...detected, operations };
}
