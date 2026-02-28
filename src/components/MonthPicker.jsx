import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonthYear, prevMonth, nextMonth, isCurrentMonth } from '../utils/dateRange';

export default function MonthPicker({ year, month, onChange }) {
  const handlePrev = () => {
    const prev = prevMonth(year, month);
    onChange(prev);
  };

  const handleNext = () => {
    const next = nextMonth(year, month);
    onChange(next);
  };

  const handleToday = () => {
    const now = new Date();
    onChange({ year: now.getFullYear(), month: now.getMonth() });
  };

  const isCurrent = isCurrentMonth(year, month);
  const label = formatMonthYear(year, month);

  return (
    <div className="flex items-center gap-2" data-testid="month-picker">
      <button
        onClick={handlePrev}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
        aria-label="Предыдущий месяц"
        data-testid="month-prev"
      >
        <ChevronLeft size={20} />
      </button>

      <span
        className="text-sm font-medium text-gray-800 dark:text-gray-200 min-w-[140px] text-center capitalize"
        data-testid="month-label"
      >
        {label}
      </span>

      <button
        onClick={handleNext}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
        aria-label="Следующий месяц"
        data-testid="month-next"
      >
        <ChevronRight size={20} />
      </button>

      {!isCurrent && (
        <button
          onClick={handleToday}
          className="ml-1 text-xs px-2 py-1 rounded border border-primary-300 dark:border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
          data-testid="month-today"
        >
          Сегодня
        </button>
      )}
    </div>
  );
}
