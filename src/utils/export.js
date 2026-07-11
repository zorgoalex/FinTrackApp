/**
 * Export analytics data to CSV with BOM for Excel compatibility.
 * Uses semicolon separator for Russian locale Excel.
 */
export function exportToCSV(analytics, dateFrom, dateTo) {
  const BOM = '\uFEFF';
  const lines = [];

  // Header
  lines.push(`Аналитика за период ${dateFrom} — ${dateTo}`);
  lines.push('');

  // Summary
  lines.push('Тип;Сумма');
  lines.push(`Доходы;${analytics.totalIncome}`);
  lines.push(`Расходы;${analytics.totalExpense}`);
  lines.push(`Зарплаты;${analytics.totalSalary}`);
  lines.push(`Баланс;${analytics.balance}`);
  lines.push(`Всего операций;${analytics.operationCount}`);
  lines.push('');

  // Category breakdown
  if (analytics.categoryBreakdown.length > 0) {
    lines.push('Категория;Сумма;Количество операций');
    analytics.categoryBreakdown.forEach(cat => {
      lines.push(`${cat.name};${cat.amount};${cat.count}`);
    });
    lines.push('');
  }

  // Tag breakdown
  if (analytics.tagBreakdown.length > 0) {
    lines.push('Тег;Сумма;Количество операций');
    analytics.tagBreakdown.forEach(tag => {
      lines.push(`${tag.name};${tag.amount};${tag.count}`);
    });
  }

  const csv = BOM + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analytics_${dateFrom}_${dateTo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCSVCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Prevent spreadsheet formula execution for user-controlled text fields.
  if (/^[=+@\t\r]/.test(text)) text = `'${text}`;
  if (/[;"\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Build a raw operation ledger suitable for Excel and long-term backup.
 */
export function buildOperationsCSV(
  operations,
  { categories = [], accounts = [], baseCurrency = 'KZT' } = {}
) {
  const BOM = '\uFEFF';
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const typeLabels = {
    income: 'Доход',
    expense: 'Расход',
    salary: 'Зарплата',
    transfer: 'Перевод'
  };
  const directionLabels = { in: 'Входящий', out: 'Исходящий' };
  const headers = [
    'Дата',
    'Тип',
    'Направление перевода',
    'Сумма',
    'Валюта',
    'Курс',
    `Сумма в ${baseCurrency}`,
    'Счёт',
    'Категория',
    'Теги',
    'Описание'
  ];
  const rows = (operations || []).map((operation) => [
    operation.operation_date || '',
    typeLabels[operation.type] || operation.type || '',
    directionLabels[operation.transfer_direction] || '',
    Number(operation.amount) || 0,
    operation.currency || baseCurrency,
    operation.exchange_rate ?? 1,
    operation.base_amount ?? operation.amount ?? 0,
    accountNames.get(operation.account_id) || '',
    categoryNames.get(operation.category_id) || '',
    (operation.tags || []).map((tag) => tag.name).join(', '),
    operation.description || ''
  ]);

  return BOM + [headers, ...rows]
    .map((row) => row.map(escapeCSVCell).join(';'))
    .join('\r\n');
}

export function downloadOperationsCSV(csv, dateFrom, dateTo) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `operations_${dateFrom}_${dateTo}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Build a text report for clipboard copying.
 */
export function buildTextReport(analytics, dateFrom, dateTo, currencySymbol = '₸') {
  const lines = [];
  lines.push(`📊 Аналитика за ${dateFrom} — ${dateTo}`);
  lines.push('');
  lines.push(`Доходы:    ${formatNum(analytics.totalIncome)} ${currencySymbol}`);
  lines.push(`Расходы:   ${formatNum(analytics.totalExpense)} ${currencySymbol}`);
  lines.push(`Зарплаты:  ${formatNum(analytics.totalSalary)} ${currencySymbol}`);
  lines.push(`Баланс:    ${formatNum(analytics.balance)} ${currencySymbol}`);
  lines.push(`Операций:  ${analytics.operationCount}`);

  if (analytics.categoryBreakdown.length > 0) {
    lines.push('');
    lines.push('По категориям:');
    analytics.categoryBreakdown.forEach(cat => {
      lines.push(`  ${cat.name}: ${formatNum(cat.amount)} ${currencySymbol} (${cat.count} оп.)`);
    });
  }

  if (analytics.tagBreakdown.length > 0) {
    lines.push('');
    lines.push('По тегам:');
    analytics.tagBreakdown.forEach(tag => {
      lines.push(`  #${tag.name}: ${formatNum(tag.amount)} ${currencySymbol} (${tag.count} оп.)`);
    });
  }

  return lines.join('\n');
}

function formatNum(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
}
