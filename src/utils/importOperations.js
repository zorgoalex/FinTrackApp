const TYPE_MAP = new Map([
  ['доход', 'income'],
  ['income', 'income'],
  ['расход', 'expense'],
  ['expense', 'expense'],
  ['личная зарплата', 'personal_salary'],
  ['personal salary', 'personal_salary'],
  ['зарплата сотрудникам', 'employee_salary'],
  ['employee salary', 'employee_salary'],
]);

const FIELD_ALIASES = {
  date: ['дата', 'date'],
  type: ['тип', 'type'],
  amount: ['сумма', 'amount'],
  debit: ['дебет', 'debit', 'расход', 'списание', 'withdrawal'],
  credit: ['кредит', 'credit', 'приход', 'зачисление', 'deposit'],
  currency: ['валюта', 'currency'],
  rate: ['курс', 'exchange rate', 'exchange_rate'],
  baseAmount: ['сумма в базовой валюте', 'base amount', 'base_amount'],
  account: ['счёт', 'счет', 'account'],
  category: ['категория', 'category'],
  tags: ['теги', 'tags'],
  description: ['описание', 'description', 'назначение платежа', 'details'],
  counterparty: ['контрагент', 'counterparty', 'получатель', 'payee', 'merchant'],
};

function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
}

function parseDelimitedRecords(text, delimiter) {
  const records = [];
  let cells = [];
  let current = '';
  let quoted = false;
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else if (char === '\n' && !quoted) {
      cells.push(current.trim());
      if (cells.some((cell) => cell !== '')) records.push(cells);
      cells = [];
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  if (cells.some((cell) => cell !== '')) records.push(cells);
  return records;
}

function delimiterScore(text, delimiter, sampleStart = 0) {
  const records = parseDelimitedRecords(text, delimiter).slice(sampleStart, sampleStart + 8);
  if (!records.length) return -1;
  const widths = records.map((record) => record.length);
  const maxWidth = Math.max(...widths);
  const consistent = widths.filter((width) => width === maxWidth).length;
  return maxWidth > 1 ? maxWidth * 10 + consistent : 0;
}

export function detectCSVDelimiter(text, { headerRow = 1 } = {}) {
  const sampleStart = typeof headerRow === 'number' && headerRow > 0 ? headerRow - 1 : 0;
  return [';', ',', '\t', '|'].reduce((best, delimiter) => {
    const score = delimiterScore(text, delimiter, sampleStart);
    return score > best.score ? { delimiter, score } : best;
  }, { delimiter: ';', score: -1 }).delimiter;
}

function headerRowIndex(headerRow) {
  if (headerRow === false || headerRow === 0 || headerRow === null) return -1;
  if (headerRow === true || headerRow === undefined) return 0;
  const parsed = Number(headerRow);
  return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : 0;
}

function suggestedField(header, baseCurrency) {
  const normalized = normalize(header);
  if (normalized === `сумма в ${normalize(baseCurrency)}`) return 'baseAmount';
  return Object.entries(FIELD_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || null;
}

export function inspectOperationsCSV(text, { baseCurrency = 'KZT', format = {}, headerRow, delimiter } = {}) {
  const cleanText = String(text ?? '').replace(/^\uFEFF/, '');
  const resolvedHeaderRow = headerRow ?? format.headerRow ?? 1;
  const resolvedDelimiter = delimiter ?? format.delimiter;
  const detectedDelimiter = resolvedDelimiter && resolvedDelimiter !== 'auto'
    ? resolvedDelimiter
    : detectCSVDelimiter(cleanText, { headerRow: resolvedHeaderRow });
  const records = parseDelimitedRecords(cleanText, detectedDelimiter);
  const headerIndex = headerRowIndex(resolvedHeaderRow);
  const headers = headerIndex >= 0 && records[headerIndex] ? records[headerIndex] : [];
  const columns = headers.map((header, index) => ({
    index,
    header,
    normalizedHeader: normalize(header),
    suggestedField: suggestedField(header, baseCurrency),
  }));
  const suggestedMapping = {};
  columns.forEach(({ index, suggestedField: field }) => {
    if (field && suggestedMapping[field] === undefined) suggestedMapping[field] = index;
  });
  return {
    delimiter: detectedDelimiter,
    headerRow: headerIndex < 0 ? false : headerIndex + 1,
    headers,
    columns,
    suggestedMapping,
    dataRowCount: Math.max(0, records.length - (headerIndex >= 0 ? headerIndex + 1 : 0)),
  };
}

function resolveSelector(selector, headers) {
  if (Number.isInteger(selector)) return selector;
  if (selector && typeof selector === 'object') {
    if (Number.isInteger(selector.index)) return selector.index;
    if (selector.header !== undefined) return resolveSelector(selector.header, headers);
  }
  if (typeof selector === 'string') {
    const wanted = normalize(selector);
    return headers.findIndex((header) => normalize(header) === wanted);
  }
  return -1;
}

function parseNumber(value, { decimalSeparator = 'auto', thousandsSeparator } = {}) {
  let normalized = String(value ?? '').trim().replace(/[\s\u00a0]/g, '');
  if (!normalized) return NaN;
  if (thousandsSeparator) normalized = normalized.split(thousandsSeparator).join('');
  if (decimalSeparator === ',') normalized = normalized.replace(/\./g, '').replace(',', '.');
  else if (decimalSeparator === '.') normalized = normalized.replace(/,/g, '');
  else {
    const comma = normalized.lastIndexOf(',');
    const dot = normalized.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? ',' : '.';
      normalized = normalized.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
    } else if (comma >= 0) normalized = normalized.replace(',', '.');
  }
  const result = Number(normalized);
  return Number.isFinite(result) ? result : NaN;
}

function parseDate(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function resolveType(rawType, workspaceType) {
  const normalized = normalize(rawType);
  if (normalized === 'зарплата' || normalized === 'salary') {
    return workspaceType === 'personal' ? 'personal_salary' : 'employee_salary';
  }
  return TYPE_MAP.get(normalized);
}

export function parseOperationsCSV(text, options = {}) {
  const {
    categories = [], accounts = [], baseCurrency = 'KZT', workspaceType = 'business',
    mapping = {}, format = {}, headerRow, delimiter, defaultType,
  } = options;
  const cleanText = String(text ?? '').replace(/^\uFEFF/, '');
  const resolvedHeaderRow = headerRow ?? format.headerRow ?? 1;
  const resolvedDelimiter = delimiter ?? format.delimiter;
  const csvDelimiter = resolvedDelimiter && resolvedDelimiter !== 'auto'
    ? resolvedDelimiter
    : detectCSVDelimiter(cleanText, { headerRow: resolvedHeaderRow });
  const records = parseDelimitedRecords(cleanText, csvDelimiter);
  const headerIndex = headerRowIndex(resolvedHeaderRow);
  const headers = headerIndex >= 0 && records[headerIndex] ? records[headerIndex] : [];
  const dataStart = headerIndex >= 0 ? headerIndex + 1 : 0;
  if (records.length <= dataStart) return { rows: [], errors: ['CSV не содержит операций'] };
  const autoMapping = inspectOperationsCSV(cleanText, {
    baseCurrency, format: { headerRow: resolvedHeaderRow, delimiter: csvDelimiter },
  }).suggestedMapping;
  const effectiveMapping = { ...autoMapping, ...mapping };
  const indexes = Object.fromEntries(Object.keys(FIELD_ALIASES).map((field) => [
    field, resolveSelector(effectiveMapping[field], headers),
  ]));
  const amountMode = format.amountMode || (
    indexes.debit >= 0 || indexes.credit >= 0 ? 'debitCredit' : 'amountAndType'
  );
  const fallbackType = resolveType(defaultType ?? format.defaultType, workspaceType);
  const required = ['date'];
  if (amountMode === 'debitCredit') required.push('debit', 'credit');
  else required.push('amount');
  if (amountMode === 'amountAndType' && !fallbackType) required.push('type');
  if (required.some((key) => indexes[key] < 0)) {
    const legacy = amountMode === 'amountAndType' && !Object.keys(mapping).length;
    return { rows: [], errors: [legacy
      ? 'Нужны обязательные колонки: Дата, Тип, Сумма'
      : `Не настроены обязательные колонки: ${required.filter((key) => indexes[key] < 0).join(', ')}`] };
  }
  const accountMap = new Map(accounts.map((item) => [normalize(item.name), item]));
  const categoryMap = new Map(categories.map((item) => [`${normalize(item.type)}:${normalize(item.name)}`, item]));
  const rows = [];
  const errors = [];
  records.slice(dataStart).forEach((cells, offset) => {
    const lineNumber = dataStart + offset + 1;
    const get = (key) => indexes[key] >= 0 ? cells[indexes[key]] ?? '' : '';
    let type = fallbackType || resolveType(get('type'), workspaceType);
    let rawAmount;
    if (amountMode === 'debitCredit') {
      const debit = parseNumber(get('debit'), format);
      const credit = parseNumber(get('credit'), format);
      const hasDebit = Number.isFinite(debit) && debit !== 0;
      const hasCredit = Number.isFinite(credit) && credit !== 0;
      if (hasDebit !== hasCredit) {
        type = hasDebit ? 'expense' : 'income';
        rawAmount = hasDebit ? debit : credit;
      } else rawAmount = NaN;
    } else {
      rawAmount = parseNumber(get('amount'), format);
      if (amountMode === 'signed' && Number.isFinite(rawAmount) && !fallbackType) {
        type = rawAmount < 0 ? 'expense' : 'income';
      }
    }
    const amount = Math.abs(rawAmount);
    const date = parseDate(get('date'));
    const account = get('account') ? accountMap.get(normalize(get('account'))) : null;
    const categoryType = type === 'personal_salary' ? 'income' : type === 'employee_salary' ? 'expense' : type;
    const category = get('category') ? categoryMap.get(`${categoryType}:${normalize(get('category'))}`) : null;
    const rowErrors = [];
    if (!type) rowErrors.push('неподдерживаемый тип');
    if (!date) rowErrors.push('некорректная дата');
    if (!Number.isFinite(amount) || amount <= 0) rowErrors.push('сумма должна быть больше нуля');
    if (get('account') && !account) rowErrors.push(`счёт «${get('account')}» не найден`);
    if (get('category') && !category) rowErrors.push(`категория «${get('category')}» не найдена для этого типа`);
    if (rowErrors.length) {
      errors.push(`Строка ${lineNumber}: ${rowErrors.join(', ')}`);
      return;
    }

    const rate = Math.abs(parseNumber(get('rate'), format));
    const baseAmount = Math.abs(parseNumber(get('baseAmount'), format));
    const row = {
      type,
      operation_date: date,
      amount,
      currency: get('currency').trim().toUpperCase() || baseCurrency,
      exchange_rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
      base_amount: Number.isFinite(baseAmount) && baseAmount > 0 ? baseAmount : amount,
      account_id: account?.id || null,
      category_id: category?.id || null,
      tagNames: get('tags').split(',').map((tag) => tag.trim()).filter(Boolean),
      description: get('description'),
      sourceLine: lineNumber,
    };
    if (indexes.counterparty >= 0) row.counterpartyName = get('counterparty');
    rows.push(row);
  });

  return { rows, errors };
}
