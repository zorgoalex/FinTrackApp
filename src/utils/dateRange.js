// Утилиты для работы с периодами дат
// Все даты в локальной таймзоне пользователя

import { startOfMonth, endOfMonth, format, subMonths, addMonths } from 'date-fns';
import { ru } from 'date-fns/locale';

// Возвращает сегодняшнюю дату в формате YYYY-MM-DD (LOCAL timezone, не UTC!)
export function todayLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Возвращает {dateFrom, dateTo} для заданного месяца
// month — 0-indexed (0 = январь)
export function getMonthRange(year, month) {
  const date = new Date(year, month, 1);
  return {
    dateFrom: format(startOfMonth(date), 'yyyy-MM-dd'),
    dateTo: format(endOfMonth(date), 'yyyy-MM-dd'),
  };
}

// Форматирует название месяца: "Февраль 2026"
export function formatMonthYear(year, month) {
  const date = new Date(year, month, 1);
  return format(date, 'LLLL yyyy', { locale: ru });
}

// Предыдущий месяц
export function prevMonth(year, month) {
  const d = subMonths(new Date(year, month, 1), 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// Следующий месяц
export function nextMonth(year, month) {
  const d = addMonths(new Date(year, month, 1), 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// Проверяет, является ли {year, month} текущим месяцем
export function isCurrentMonth(year, month) {
  const now = new Date();
  return year === now.getFullYear() && month === now.getMonth();
}
