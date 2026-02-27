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

/**
 * Build a text report for clipboard copying.
 */
export function buildTextReport(analytics, dateFrom, dateTo) {
  const lines = [];
  lines.push(`📊 Аналитика за ${dateFrom} — ${dateTo}`);
  lines.push('');
  lines.push(`Доходы:    ${formatNum(analytics.totalIncome)} ₽`);
  lines.push(`Расходы:   ${formatNum(analytics.totalExpense)} ₽`);
  lines.push(`Зарплаты:  ${formatNum(analytics.totalSalary)} ₽`);
  lines.push(`Баланс:    ${formatNum(analytics.balance)} ₽`);
  lines.push(`Операций:  ${analytics.operationCount}`);

  if (analytics.categoryBreakdown.length > 0) {
    lines.push('');
    lines.push('По категориям:');
    analytics.categoryBreakdown.forEach(cat => {
      lines.push(`  ${cat.name}: ${formatNum(cat.amount)} ₽ (${cat.count} оп.)`);
    });
  }

  if (analytics.tagBreakdown.length > 0) {
    lines.push('');
    lines.push('По тегам:');
    analytics.tagBreakdown.forEach(tag => {
      lines.push(`  #${tag.name}: ${formatNum(tag.amount)} ₽ (${tag.count} оп.)`);
    });
  }

  return lines.join('\n');
}

function formatNum(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
}
