import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(repoRoot, '..', '..');
const outputDir = resolve(workspaceRoot, 'artifacts', 'voice_benchmark_scenarios');
const participantDir = resolve(outputDir, 'participants');
const labelDir = resolve(outputDir, 'labels');

const referenceNow = '2026-07-12T12:00:00+05:00';
const timezone = 'Asia/Qyzylorda';

function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260712);
const pick = (items) => items[Math.floor(random() * items.length)];

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const unitsMale = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const unitsFemale = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function pluralForm(value, one, few, many) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function underThousand(value, feminine = false) {
  const words = [];
  const h = Math.floor(value / 100);
  const rest = value % 100;
  if (h) words.push(hundreds[h]);
  if (rest >= 10 && rest <= 19) {
    words.push(teens[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) words.push(tens[t]);
    if (u) words.push((feminine ? unitsFemale : unitsMale)[u]);
  }
  return words;
}

function integerToRussian(value) {
  if (value === 0) return 'ноль';
  const words = [];
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const remainder = value % 1_000;
  if (millions) {
    words.push(...underThousand(millions));
    words.push(pluralForm(millions, 'миллион', 'миллиона', 'миллионов'));
  }
  if (thousands) {
    words.push(...underThousand(thousands, true));
    words.push(pluralForm(thousands, 'тысяча', 'тысячи', 'тысяч'));
  }
  if (remainder) words.push(...underThousand(remainder));
  return words.join(' ');
}

const currencyMeta = {
  KZT: { one: 'тенге', few: 'тенге', many: 'тенге', minorOne: 'тиын', minorFew: 'тиына', minorMany: 'тиынов' },
  USD: { one: 'доллар', few: 'доллара', many: 'долларов', minorOne: 'цент', minorFew: 'цента', minorMany: 'центов' },
  RUB: { one: 'рубль', few: 'рубля', many: 'рублей', minorOne: 'копейка', minorFew: 'копейки', minorMany: 'копеек' },
  EUR: { one: 'евро', few: 'евро', many: 'евро', minorOne: 'евроцент', minorFew: 'евроцента', minorMany: 'евроцентов' },
};

function amountToSpeech(amount, currency) {
  const [wholeRaw, minorRaw = '00'] = String(amount).split('.');
  const whole = Number(wholeRaw);
  const minor = Number(minorRaw.padEnd(2, '0').slice(0, 2));
  const meta = currencyMeta[currency];
  const result = `${integerToRussian(whole)} ${pluralForm(whole, meta.one, meta.few, meta.many)}`;
  if (!minor) return result;
  return `${result} ${integerToRussian(minor)} ${pluralForm(minor, meta.minorOne, meta.minorFew, meta.minorMany)}`;
}

const workspaces = ['Семья', 'Личное', 'ИП Астана', 'Магазин', 'Проект Север'];
const accounts = {
  KZT: ['Kaspi Gold', 'Kaspi Deposit', 'Halyk Bonus', 'Freedom Card', 'Наличные тенге'],
  USD: ['Freedom USD', 'Наличные доллары'],
  RUB: ['Счёт RUB', 'Наличные рубли'],
  EUR: ['Freedom EUR', 'Наличные евро'],
};
const expenseCategories = ['Продукты', 'Транспорт', 'Такси', 'Кафе', 'Коммунальные услуги', 'Аренда', 'Реклама', 'Закуп товара', 'Здоровье', 'Образование', 'Подписки', 'Связь', 'Ремонт', 'Налоги', 'Одежда', 'Другое'];
const incomeCategories = ['Зарплата', 'Продажи', 'Возврат', 'Проценты', 'Подарок', 'Подработка', 'Инвестиционный доход', 'Прочие доходы'];
const employeeNames = ['Алия', 'Данияр', 'Руслан', 'Айгерим', 'Мария', 'Сергей', 'Нурлан', 'Ольга'];
const environments = ['тихое помещение', 'домашний фон', 'кафе', 'улица', 'автомобиль или эхо'];

const dates = [
  ['сегодня', '2026-07-12'],
  ['вчера', '2026-07-11'],
  ['позавчера', '2026-07-10'],
  ['завтра', '2026-07-13'],
  ['в понедельник', '2026-07-13'],
  ['в прошлую пятницу', '2026-07-10'],
  ['двенадцатого июля', '2026-07-12'],
  ['одиннадцатого июля', '2026-07-11'],
  ['первого июля', '2026-07-01'],
  ['тридцатого июня', '2026-06-30'],
  ['пятнадцатого июля', '2026-07-15'],
  ['первого августа', '2026-08-01'],
];

const amountPool = [
  1, 5, 12, 15, 50, 55, 99, 100, 105, 115, 150, 250, 499, 500, 550, 600, 750, 990,
  1000, 1005, 1050, 1100, 1250, 1500, 1990, 2500, 5000, 5050, 5500, 7500, 9990,
  10000, 10050, 10500, 12050, 12500, 15000, 15500, 25000, 50500, 55000, 99999,
  100000, 105000, 150000, 250000, 500000, 750000, 999999, 1_000_000, 1_200_000, 2_500_000,
];
const minorPool = ['25', '50', '75', '90'];

function makeAmount(currency, index) {
  const whole = amountPool[(index * 7 + Math.floor(random() * amountPool.length)) % amountPool.length];
  const allowMinor = index % 9 === 0 && whole < 100_000;
  return allowMinor ? `${whole}.${pick(minorPool)}` : String(whole);
}

function operationTypeFor(index) {
  const bucket = index % 100;
  if (bucket < 40) return 'expense';
  if (bucket < 55) return 'income';
  if (bucket < 73) return 'transfer';
  if (bucket < 81) return 'personal_salary';
  if (bucket < 88) return 'employee_salary';
  return index % 2 ? 'expense' : 'transfer';
}

function modeFor(index) {
  if (index <= 500) return 'scripted';
  if (index <= 800) return 'paraphrase';
  if (index <= 900) return 'correction';
  if (index <= 970) return 'ambiguous';
  return 'invalid';
}

function baseScenario(index) {
  const type = operationTypeFor(index);
  const currency = index % 10 < 7 ? 'KZT' : index % 10 === 7 ? 'USD' : index % 10 === 8 ? 'RUB' : 'EUR';
  const amount = makeAmount(currency, index);
  const amountSpeech = amountToSpeech(amount, currency);
  const workspace = workspaces[(index * 3) % workspaces.length];
  const [datePhrase, expectedDate] = dates[(index * 5 + Math.floor(random() * dates.length)) % dates.length];
  const accountList = accounts[currency];
  const account = accountList[(index * 3) % accountList.length];
  const otherAccount = accountList[(index * 3 + 1) % accountList.length];
  const category = type === 'employee_salary'
    ? 'Зарплата сотрудникам'
    : type === 'personal_salary'
      ? 'Зарплата'
      : type === 'income'
        ? pick(incomeCategories)
        : pick(expenseCategories);
  return {
    type,
    currency,
    amount,
    amountSpeech,
    workspace,
    datePhrase,
    expectedDate,
    account,
    otherAccount,
    category,
    employee: pick(employeeNames),
  };
}

function standardPhrase(data, variant) {
  const { type, amountSpeech, category, datePhrase, account, otherAccount, workspace, employee } = data;
  if (type === 'expense') {
    const templates = [
      `Расход ${amountSpeech}, категория ${category}, дата ${datePhrase}, счёт ${account}, пространство ${workspace}.`,
      `Запиши расход на ${amountSpeech}: ${category}, ${datePhrase}, оплата со счёта ${account}, пространство ${workspace}.`,
      `Я потратил ${amountSpeech} на категорию ${category} ${datePhrase}, счёт ${account}, пространство ${workspace}.`,
    ];
    return templates[variant % templates.length];
  }
  if (type === 'income') {
    const templates = [
      `Доход ${amountSpeech}, категория ${category}, дата ${datePhrase}, счёт ${account}, пространство ${workspace}.`,
      `Добавь поступление ${amountSpeech} в категорию ${category} ${datePhrase} на счёт ${account}, пространство ${workspace}.`,
      `Получил ${amountSpeech}, это ${category}, дата ${datePhrase}, счёт ${account}, пространство ${workspace}.`,
    ];
    return templates[variant % templates.length];
  }
  if (type === 'transfer') {
    const templates = [
      `Перевод ${amountSpeech} со счёта ${account} на счёт ${otherAccount}, дата ${datePhrase}, пространство ${workspace}.`,
      `Переведи ${amountSpeech} с ${account} на ${otherAccount} ${datePhrase}, пространство ${workspace}.`,
      `Запиши перевод на сумму ${amountSpeech}: откуда ${account}, куда ${otherAccount}, ${datePhrase}, пространство ${workspace}.`,
    ];
    return templates[variant % templates.length];
  }
  if (type === 'personal_salary') {
    return `Личная зарплата ${amountSpeech}, дата ${datePhrase}, счёт ${account}, пространство ${workspace}.`;
  }
  return `Зарплата сотруднику ${employee} ${amountSpeech}, дата ${datePhrase}, счёт ${account}, пространство ${workspace}.`;
}

function scenarioFor(index) {
  const id = `VB-${String(index).padStart(4, '0')}`;
  const mode = modeFor(index);
  const data = baseScenario(index);
  let participantInstruction = '';
  let spokenText = standardPhrase(data, index);
  let intent = 'create_operation';
  let expectedType = data.type;
  let expectedAmount = data.amount;
  let expectedDate = data.expectedDate;
  let expectedAccount = data.type === 'transfer' ? '' : data.account;
  let expectedFromAccount = data.type === 'transfer' ? data.account : '';
  let expectedToAccount = data.type === 'transfer' ? data.otherAccount : '';
  let expectedCategory = ['expense', 'income', 'personal_salary', 'employee_salary'].includes(data.type) ? data.category : '';
  let difficulty = 'normal';
  const tags = [data.currency.toLowerCase(), data.type, index % 9 === 0 ? 'fractional' : 'integer'];
  let notes = '';

  if (mode === 'scripted') {
    participantInstruction = `Прочитайте естественно, не по слогам: «${spokenText}»`;
  } else if (mode === 'paraphrase') {
    participantInstruction = `Скажите своими словами, не читая готовую фразу: ${spokenText}`;
    tags.push('natural-speech');
  } else if (mode === 'correction') {
    difficulty = 'hard';
    tags.push('self-correction');
    if (index % 4 === 0) {
      const wrongAmount = makeAmount(data.currency, index + 31);
      spokenText = `${standardPhrase({ ...data, amount: wrongAmount, amountSpeech: amountToSpeech(wrongAmount, data.currency) }, index)} Нет, сумма не ${amountToSpeech(wrongAmount, data.currency)}, а ${data.amountSpeech}.`;
      notes = 'После самокоррекции должна использоваться последняя сумма.';
    } else if (index % 4 === 1) {
      const wrongDate = dates[(index + 3) % dates.length][0];
      spokenText = `${standardPhrase({ ...data, datePhrase: wrongDate }, index)} Поправка: не ${wrongDate}, а ${data.datePhrase}.`;
      notes = 'После самокоррекции должна использоваться последняя дата.';
    } else if (index % 4 === 2 && data.type === 'transfer') {
      spokenText = `Перевод ${data.amountSpeech} с ${data.account} на ${data.account}. Нет, получатель не ${data.account}, а ${data.otherAccount}, дата ${data.datePhrase}, пространство ${data.workspace}.`;
      notes = 'Исправляется счёт получателя.';
    } else {
      const wrongCategory = data.type === 'income' ? pick(incomeCategories) : pick(expenseCategories);
      spokenText = `${standardPhrase({ ...data, category: wrongCategory }, index)} Нет, категория не ${wrongCategory}, а ${data.category}.`;
      expectedCategory = data.category;
      notes = 'После самокоррекции должна использоваться последняя категория.';
    }
    participantInstruction = `Прочитайте фразу с естественной паузой перед исправлением: «${spokenText}»`;
  } else if (mode === 'ambiguous') {
    difficulty = 'critical';
    intent = 'needs_clarification';
    tags.push('ambiguity');
    const variant = index % 5;
    if (variant === 0) {
      spokenText = `Расход пятнадцать или пятьдесят тысяч тенге на ${data.category} ${data.datePhrase}, счёт ${data.account}, пространство ${data.workspace}.`;
      expectedAmount = '';
      notes = 'Неоднозначная сумма: нельзя выбирать между 15 000 и 50 000.';
    } else if (variant === 1) {
      spokenText = `Расход ${data.amountSpeech} на ${data.category} ${data.datePhrase} с Каспи, пространство ${data.workspace}.`;
      expectedAccount = '';
      notes = 'Неоднозначный счёт: Kaspi Gold или Kaspi Deposit.';
    } else if (variant === 2) {
      spokenText = `Расход ${data.amountSpeech} на ${data.category}, сегодня или вчера, счёт ${data.account}, пространство ${data.workspace}.`;
      expectedDate = '';
      notes = 'Неоднозначная дата.';
    } else if (variant === 3) {
      spokenText = `Перевод ${data.amountSpeech} с Каспи на Freedom ${data.datePhrase}, пространство ${data.workspace}.`;
      expectedType = 'transfer';
      expectedFromAccount = '';
      expectedToAccount = '';
      expectedAccount = '';
      expectedCategory = '';
      notes = 'Оба названия счетов недостаточно точны.';
    } else {
      spokenText = `Запиши ${data.amountSpeech} на ${data.category}, счёт ${data.account}, пространство ${data.workspace}.`;
      expectedType = '';
      notes = 'Не указан тип: расход или доход.';
    }
    participantInstruction = `Прочитайте как обычную команду, не пытайтесь устранить неоднозначность: «${spokenText}»`;
  } else {
    difficulty = 'critical';
    tags.push('invalid');
    const variant = index % 6;
    intent = variant === 0 ? 'no_speech' : 'needs_clarification';
    expectedType = '';
    expectedAmount = '';
    expectedDate = '';
    expectedCategory = '';
    expectedAccount = '';
    expectedFromAccount = '';
    expectedToAccount = '';
    if (variant === 0) {
      const silenceSeconds = 4 + (index % 5);
      const noiseType = environments[index % environments.length];
      spokenText = `[молчание ${silenceSeconds} секунд, окружение: ${noiseType}]`;
      participantInstruction = `Не произносите команду: сохраните ${silenceSeconds} секунд тишины или фонового шума в окружении «${noiseType}».`;
      notes = 'Система не должна придумывать операцию.';
    } else if (variant === 1) {
      const genericPhrases = [
        'Запиши операцию как обычно.',
        'Добавь это в мои финансы.',
        'Создай новую запись без подробностей.',
        'Внеси какую-нибудь операцию за сегодня.',
        'Запиши тот платёж, о котором мы говорили.',
      ];
      spokenText = genericPhrases[Math.floor(index / 6) % genericPhrases.length];
      participantInstruction = `Прочитайте: «${spokenText}»`;
      notes = 'Нет типа, суммы и остальных обязательных полей.';
    } else if (variant === 2) {
      spokenText = `Не записывай расход ${data.amountSpeech} на ${data.category}.`;
      participantInstruction = `Прочитайте с отчётливым отрицанием: «${spokenText}»`;
      notes = 'Отрицание: операция не должна создаваться.';
    } else if (variant === 3) {
      spokenText = `Расход на ${data.category}, счёт ${data.account}, пространство ${data.workspace}.`;
      participantInstruction = `Прочитайте: «${spokenText}»`;
      notes = 'Отсутствует сумма.';
    } else if (variant === 4) {
      spokenText = `Кажется, я покупал что-то из категории ${data.category} ${data.datePhrase} со счёта ${data.account}, но сумму не помню.`;
      participantInstruction = `Скажите задумчиво: «${spokenText}»`;
      notes = 'Недостаточно данных для операции.';
    } else {
      spokenText = `То ли доход, то ли возврат ${data.amountSpeech}, разберёмся потом.`;
      participantInstruction = `Прочитайте с естественными паузами: «${spokenText}»`;
      notes = 'Противоречивый тип операции.';
    }
  }

  if (new Date(`${data.expectedDate}T00:00:00+05:00`) > new Date(referenceNow) && intent === 'create_operation') {
    tags.push('future-date');
  }

  return {
    id,
    mode,
    participant_instruction: participantInstruction,
    target_spoken_text: spokenText,
    expected_intent: intent,
    expected_type: expectedType,
    expected_amount: expectedAmount,
    expected_currency: expectedAmount ? data.currency : '',
    expected_date: expectedDate,
    expected_category: expectedCategory,
    expected_account: expectedAccount,
    expected_from_account: expectedFromAccount,
    expected_to_account: expectedToAccount,
    expected_workspace: intent === 'create_operation' ? data.workspace : '',
    reference_now: referenceNow,
    timezone,
    recommended_environment: environments[index % environments.length],
    difficulty,
    tags: tags.join('|'),
    notes,
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

const columns = [
  'id', 'mode', 'participant_instruction', 'target_spoken_text', 'expected_intent', 'expected_type',
  'expected_amount', 'expected_currency', 'expected_date', 'expected_category', 'expected_account',
  'expected_from_account', 'expected_to_account', 'expected_workspace', 'reference_now', 'timezone',
  'recommended_environment', 'difficulty', 'tags', 'notes',
];

function toCsv(rows) {
  return `\uFEFF${columns.map(csvEscape).join(';')}\n${rows.map((row) => columns.map((column) => csvEscape(row[column])).join(';')).join('\n')}\n`;
}

function participantMarkdown(rows, part) {
  const first = (part - 1) * 100 + 1;
  const last = first + 99;
  const lines = [
    `# Сценарии голосового теста ${String(part).padStart(2, '0')}: ${first}–${last}`,
    '',
    'Перед каждой записью назовите участнику рекомендуемое окружение. Не показывайте эталонные поля из CSV. Участник выполняет только инструкцию сценария.',
    '',
  ];
  for (const row of rows) {
    lines.push(`## ${row.id}`);
    lines.push('');
    lines.push(`- Режим: ${row.mode}`);
    lines.push(`- Окружение: ${row.recommended_environment}`);
    lines.push(`- Инструкция: ${row.participant_instruction}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

const modeLabels = {
  scripted: 'контролируемое чтение',
  paraphrase: 'свободный пересказ',
  correction: 'самокоррекция',
  ambiguous: 'неоднозначная команда',
  invalid: 'некорректная команда или тишина',
};

async function main() {
  await mkdir(participantDir, { recursive: true });
  await mkdir(labelDir, { recursive: true });
  const scenarios = shuffle(Array.from({ length: 1000 }, (_, i) => scenarioFor(i + 1)));

  for (let part = 1; part <= 10; part += 1) {
    const rows = scenarios.slice((part - 1) * 100, part * 100);
    const suffix = String(part).padStart(2, '0');
    await writeFile(resolve(participantDir, `scenarios_${suffix}.md`), participantMarkdown(rows, part), 'utf8');
    await writeFile(resolve(labelDir, `scenarios_${suffix}.csv`), toCsv(rows), 'utf8');
  }
  await writeFile(resolve(labelDir, 'all_scenarios.csv'), toCsv(scenarios), 'utf8');

  const counts = Object.fromEntries(Object.keys(modeLabels).map((mode) => [mode, scenarios.filter((item) => item.mode === mode).length]));
  const indexCsv = `\uFEFF${['file', 'first_row', 'last_row', 'count'].map(csvEscape).join(';')}\n${Array.from({ length: 10 }, (_, i) => {
    const suffix = String(i + 1).padStart(2, '0');
    return [suffix, i * 100 + 1, i * 100 + 100, 100].map(csvEscape).join(';');
  }).join('\n')}\n`;
  await writeFile(resolve(outputDir, 'index.csv'), indexCsv, 'utf8');

  const readme = `# Корпус сценариев голосового ввода\n\nСгенерировано 1 000 сценариев, разбитых на 10 частей по 100.\n\n## Структура\n\n- \`participants/scenarios_XX.md\` — инструкции, которые можно показывать участникам.\n- \`labels/scenarios_XX.csv\` — эталонные поля для организатора и автоматического scorer.\n- \`index.csv\` — индекс частей.\n\n## Распределение режимов\n\n${Object.entries(counts).map(([mode, count]) => `- ${modeLabels[mode]}: ${count}`).join('\n')}\n\n## Правила проведения\n\n1. Один участник записывает не более 30–50 сценариев.\n2. Для \`paraphrase\` участник не должен читать текст дословно.\n3. После записи организатор заполняет фактически произнесённую транскрипцию в отдельном manifest; \`target_spoken_text\` — задание, а не замена прослушиванию.\n4. Не использовать реальные финансовые данные.\n5. Для относительных дат scorer использует \`reference_now=${referenceNow}\` и \`timezone=${timezone}\`.\n6. В ambiguous/invalid сценариях правильный результат — запрос уточнения или отказ, а не заполненная операция.\n7. CSV использует разделитель \`;\` и UTF-8 BOM для корректного открытия в Excel.\n\nГенератор: \`Git/repo_fintrackapp/scripts/generate-voice-benchmark-scenarios.mjs\`.\n`;
  const documentedReadme = readme.replace(
    '- `labels/scenarios_XX.csv` — эталонные поля для организатора и автоматического scorer.',
    '- `labels/scenarios_XX.csv` — эталонные поля для организатора и автоматического scorer.\n- `labels/all_scenarios.csv` — общий CSV со всеми 1 000 сценариями.',
  );
  await writeFile(resolve(outputDir, 'README.md'), documentedReadme, 'utf8');

  if (scenarios.length !== 1000) throw new Error(`Expected 1000 scenarios, got ${scenarios.length}`);
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== 1000) throw new Error('Mode counts do not sum to 1000');
  process.stdout.write(`${JSON.stringify({ outputDir, total: scenarios.length, counts }, null, 2)}\n`);
}

await main();
