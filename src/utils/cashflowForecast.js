import { isIncomeType } from './operationTypes.js';

const dateString = (date) => date.toISOString().slice(0, 10);

export function addScheduledDate(current, frequency, anchorDay, anchorMonth) {
  const date = new Date(`${current}T12:00:00`);
  if (frequency === 'daily') date.setDate(date.getDate() + 1);
  else if (frequency === 'weekly') date.setDate(date.getDate() + 7);
  else if (frequency === 'monthly') {
    const targetMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1, 12);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
    targetMonth.setDate(Math.min(Number(anchorDay) || date.getDate(), lastDay));
    return dateString(targetMonth);
  } else if (frequency === 'yearly') {
    const month = Math.max(1, Math.min(12, Number(anchorMonth) || date.getMonth() + 1));
    const target = new Date(date.getFullYear() + 1, month - 1, 1, 12);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(Number(anchorDay) || date.getDate(), lastDay));
    return dateString(target);
  }
  return dateString(date);
}

export function expandScheduled(items, from, to, convertToBase = (amount) => amount) {
  const events = [];
  for (const item of items || []) {
    if (!item.is_active || !item.next_date) continue;
    let occurrence = item.next_date;
    let guard = 0;
    while (occurrence <= to && guard < 400) {
      if (occurrence >= from) {
        const amount = convertToBase(Number(item.amount) || 0, item.currency, occurrence);
        events.push({
          id: `scheduled:${item.id}:${occurrence}`,
          source: 'scheduled',
          sourceId: item.id,
          date: occurrence,
          title: item.description || 'Регулярная операция',
          direction: isIncomeType(item.type) ? 'income' : 'expense',
          amount,
          currency: item.currency,
        });
      }
      occurrence = addScheduledDate(occurrence, item.frequency, item.anchor_day, item.anchor_month);
      guard += 1;
    }
  }
  return events;
}

export function buildCashflowForecast({ openingBalance = 0, plans = [], scheduled = [], debts = [] }) {
  const events = [...plans, ...scheduled, ...debts]
    .filter((event) => Number(event.amount) > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  let balance = Number(openingBalance) || 0;
  let minimumBalance = balance;
  let firstGapDate = null;
  const timeline = events.map((event) => {
    balance += event.direction === 'income' ? Number(event.amount) : -Number(event.amount);
    minimumBalance = Math.min(minimumBalance, balance);
    if (balance < 0 && !firstGapDate) firstGapDate = event.date;
    return { ...event, projectedBalance: balance };
  });
  return {
    openingBalance: Number(openingBalance) || 0,
    closingBalance: balance,
    minimumBalance,
    firstGapDate,
    totalIncome: events.filter((event) => event.direction === 'income').reduce((sum, event) => sum + Number(event.amount), 0),
    totalExpense: events.filter((event) => event.direction === 'expense').reduce((sum, event) => sum + Number(event.amount), 0),
    timeline,
  };
}

export function getDebtForecastDate(dueOn, forecastFrom) {
  if (!dueOn) return null;
  return dueOn < forecastFrom ? forecastFrom : dueOn;
}
