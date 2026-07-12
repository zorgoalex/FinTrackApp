const NUMBER_WORDS = new Map([
  ['ноль', 0], ['один', 1], ['одна', 1], ['одно', 1], ['два', 2], ['две', 2], ['три', 3], ['четыре', 4],
  ['пять', 5], ['шесть', 6], ['семь', 7], ['восемь', 8], ['девять', 9], ['десять', 10],
  ['одиннадцать', 11], ['двенадцать', 12], ['тринадцать', 13], ['четырнадцать', 14],
  ['пятнадцать', 15], ['шестнадцать', 16], ['семнадцать', 17], ['восемнадцать', 18], ['девятнадцать', 19],
  ['двадцать', 20], ['тридцать', 30], ['сорок', 40], ['пятьдесят', 50], ['шестьдесят', 60],
  ['семьдесят', 70], ['восемьдесят', 80], ['девяносто', 90], ['сто', 100], ['двести', 200],
  ['триста', 300], ['четыреста', 400], ['пятьсот', 500], ['шестьсот', 600], ['семьсот', 700],
  ['восемьсот', 800], ['девятьсот', 900],
]);
const THOUSANDS = new Set(['тысяча', 'тысячи', 'тысяч']);
const MILLIONS = new Set(['миллион', 'миллиона', 'миллионов']);
const CURRENCY_WORDS = new Set(['тенге', 'тг', 'kzt', 'рубль', 'рубля', 'рублей', 'rub', 'доллар', 'доллара', 'долларов', 'usd', 'евро', 'eur']);

export function normalizeVoiceText(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9₸₽$€.,]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function localDateString(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function matchesTokenPattern(text, pattern) {
  return new RegExp(`(?:^|\\s)(?:${pattern})(?=\\s|$)`, 'i').test(text);
}

function relativeDate(text, now) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (matchesTokenPattern(text, 'позавчера')) date.setDate(date.getDate() - 2);
  else if (matchesTokenPattern(text, 'вчера')) date.setDate(date.getDate() - 1);
  else if (!matchesTokenPattern(text, 'сегодня')) return null;
  return localDateString(date);
}

function parseNumericAmount(text) {
  const currency = '(?:₸|тенге|тг|kzt|₽|руб(?:ль|ля|лей)?|rub|\\$|доллар(?:а|ов)?|usd|€|евро|eur)';
  const currencyMatch = text.match(new RegExp(`(?:^|\\s)([0-9][0-9 \\u00a0]*(?:[.,][0-9]{1,2})?)\\s*${currency}(?:\\s|$)`, 'i'));
  const candidate = currencyMatch?.[1] || text.match(/\b\d[\d \u00a0]*(?:[.,]\d{1,2})?\b/)?.[0];
  if (!candidate) return null;
  const compact = candidate.replace(/[\s\u00a0]/g, '');
  const normalized = compact.includes(',') ? compact.replaceAll('.', '').replace(',', '.') : compact;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 1900 && value <= 2100 && !currencyMatch) return null;
  return value;
}

function parseNumberWords(words) {
  let total = 0;
  let group = 0;
  let consumed = 0;
  for (const word of words) {
    if (NUMBER_WORDS.has(word)) {
      group += NUMBER_WORDS.get(word);
      consumed += 1;
    } else if (THOUSANDS.has(word)) {
      total += (group || 1) * 1000;
      group = 0;
      consumed += 1;
    } else if (MILLIONS.has(word)) {
      total += (group || 1) * 1_000_000;
      group = 0;
      consumed += 1;
    } else break;
  }
  const value = total + group;
  return consumed > 0 && value > 0 ? { value, consumed } : null;
}

function parseSpokenAmount(text) {
  const words = text.split(' ');
  for (let currencyIndex = 0; currencyIndex < words.length; currencyIndex += 1) {
    if (!CURRENCY_WORDS.has(words[currencyIndex])) continue;
    for (let start = Math.max(0, currencyIndex - 8); start < currencyIndex; start += 1) {
      const parsed = parseNumberWords(words.slice(start, currencyIndex));
      if (parsed && parsed.consumed === currencyIndex - start) return parsed.value;
    }
  }
  return null;
}

function detectType(text) {
  if (matchesTokenPattern(text, 'перевод|переведи|перевести|перекинь|между счетами')) return 'transfer';
  if (matchesTokenPattern(text, 'зарплат[ауеы]? сотрудник(?:у|ам|ов)?|сотрудникам|фонд оплаты труда|фот')) return 'employee_salary';
  if (matchesTokenPattern(text, 'личная зарплата|получил зарплату|получила зарплату|зарплата пришла')) return 'personal_salary';
  if (matchesTokenPattern(text, 'доход|приход|поступил[аои]?|получил[аи]?|зачислен[ао]?')) return 'income';
  if (matchesTokenPattern(text, 'расход|потратил[аи]?|заплатил[аи]?|купил[аи]?|оплатил[аи]?|списал[ои]?')) return 'expense';
  return null;
}

function matchNamedItem(text, items, nameOf) {
  const haystack = ` ${text.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  return items
    .map((item) => ({ item, normalizedName: normalizeVoiceText(nameOf(item)) }))
    .filter(({ normalizedName }) => normalizedName.length >= 2 && haystack.includes(` ${normalizedName} `))
    .sort((left, right) => right.normalizedName.length - left.normalizedName.length)[0] || null;
}

function labelForField(field) {
  return {
    type: 'тип', amount: 'сумма', operationDate: 'дата', categoryId: 'категория', accountId: 'счёт',
    fromAccountId: 'счёт списания', toAccountId: 'счёт зачисления', description: 'описание',
  }[field] || field;
}

export function parseVoiceOperationTranscript(transcript, options = {}) {
  const cleanTranscript = String(transcript || '').trim();
  const text = normalizeVoiceText(cleanTranscript);
  const detectedType = detectType(text);
  const type = detectedType || options.fallbackType || 'expense';
  const amount = parseNumericAmount(text) ?? parseSpokenAmount(text);
  const operationDate = relativeDate(text, options.now || new Date());
  const categories = (options.categories || []).filter((category) => !category.is_archived);
  const categoryType = ['income', 'personal_salary'].includes(type) ? 'income' : 'expense';
  const category = type === 'transfer' ? null : matchNamedItem(
    text,
    categories.filter((item) => item.type === categoryType),
    (item) => item.name,
  );
  const accountMatches = (options.accounts || [])
    .filter((account) => !account.is_archived)
    .map((account) => ({ account, name: normalizeVoiceText(account.name), position: text.indexOf(normalizeVoiceText(account.name)) }))
    .filter(({ name, position }) => name.length >= 2 && position >= 0)
    .sort((left, right) => left.position - right.position);

  const patch = { description: cleanTranscript };
  if (detectedType) patch.type = detectedType;
  if (amount !== null) patch.amount = String(amount);
  if (operationDate) patch.operationDate = operationDate;
  if (category) patch.categoryId = category.item.id;
  if (type === 'transfer') {
    if (accountMatches[0]) patch.fromAccountId = accountMatches[0].account.id;
    if (accountMatches[1]) patch.toAccountId = accountMatches[1].account.id;
  } else if (accountMatches[0]) patch.accountId = accountMatches[0].account.id;

  return {
    patch,
    appliedFields: Object.keys(patch).map(labelForField),
    hasCriticalAmount: amount !== null,
  };
}
