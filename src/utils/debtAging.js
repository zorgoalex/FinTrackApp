const toDateString = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const calendarDaysBetween = (from, to) => {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  return Math.round((end - start) / 86400000);
};

export function getDebtAging(debt, referenceDate = new Date()) {
  if (debt.is_archived || Number(debt.remaining_amount) <= 0) {
    return { key: 'closed', label: 'Погашен', days: null };
  }
  if (!debt.due_on) return { key: 'no_due', label: 'Без срока', days: null };

  const days = calendarDaysBetween(toDateString(referenceDate), debt.due_on);
  if (days < 0) return { key: 'overdue', label: `Просрочен на ${Math.abs(days)} дн.`, days };
  if (days === 0) return { key: 'due_today', label: 'Срок сегодня', days };
  if (days <= 7) return { key: 'due_soon', label: `Срок через ${days} дн.`, days };
  return { key: 'later', label: `Срок через ${days} дн.`, days };
}

const STATUS_PRIORITY = { overdue: 0, due_today: 1, due_soon: 2, later: 3, no_due: 4, closed: 5 };

export function sortDebtsByUrgency(debts, referenceDate = new Date()) {
  return [...debts].sort((left, right) => {
    const leftStatus = getDebtAging(left, referenceDate);
    const rightStatus = getDebtAging(right, referenceDate);
    const priority = STATUS_PRIORITY[leftStatus.key] - STATUS_PRIORITY[rightStatus.key];
    if (priority) return priority;
    if (left.due_on && right.due_on && left.due_on !== right.due_on) return left.due_on.localeCompare(right.due_on);
    return Number(right.remaining_amount || 0) - Number(left.remaining_amount || 0);
  });
}

export function matchesDebtStatus(debt, filter, referenceDate = new Date()) {
  if (!filter) return true;
  const status = getDebtAging(debt, referenceDate).key;
  if (filter === 'urgent') return ['overdue', 'due_today', 'due_soon'].includes(status);
  return status === filter;
}
