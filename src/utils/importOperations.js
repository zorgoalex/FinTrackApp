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

function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseAmount(value) {
  const normalized = String(value ?? '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const result = Number(normalized);
  return Number.isFinite(result) ? Math.abs(result) : NaN;
}

function parseDate(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

export function parseOperationsCSV(text, { categories = [], accounts = [], baseCurrency = 'KZT', workspaceType = 'business' } = {}) {
  const cleanText = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { rows: [], errors: ['CSV не содержит операций'] };

  const delimiter = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = parseDelimitedLine(lines[0], delimiter).map(normalize);
  const column = (...names) => headers.findIndex((header) => names.includes(header));
  const indexes = {
    date: column('дата', 'date'),
    type: column('тип', 'type'),
    amount: column('сумма', 'amount'),
    currency: column('валюта', 'currency'),
    rate: column('курс', 'exchange rate', 'exchange_rate'),
    baseAmount: column(`сумма в ${normalize(baseCurrency)}`, 'сумма в базовой валюте', 'base amount', 'base_amount'),
    account: column('счёт', 'счет', 'account'),
    category: column('категория', 'category'),
    tags: column('теги', 'tags'),
    description: column('описание', 'description'),
  };
  const missing = ['date', 'type', 'amount'].filter((key) => indexes[key] < 0);
  if (missing.length) {
    return { rows: [], errors: ['Нужны обязательные колонки: Дата, Тип, Сумма'] };
  }

  const accountMap = new Map(accounts.map((item) => [normalize(item.name), item]));
  const categoryMap = new Map(categories.map((item) => [`${normalize(item.type)}:${normalize(item.name)}`, item]));
  const rows = [];
  const errors = [];

  lines.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2;
    const cells = parseDelimitedLine(line, delimiter);
    const get = (key) => indexes[key] >= 0 ? cells[indexes[key]] ?? '' : '';
    const rawType = normalize(get('type'));
    const type = rawType === 'зарплата' || rawType === 'salary'
      ? (workspaceType === 'personal' ? 'personal_salary' : 'employee_salary')
      : TYPE_MAP.get(rawType);
    const date = parseDate(get('date'));
    const amount = parseAmount(get('amount'));
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

    const rate = parseAmount(get('rate'));
    const baseAmount = parseAmount(get('baseAmount'));
    rows.push({
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
    });
  });

  return { rows, errors };
}
