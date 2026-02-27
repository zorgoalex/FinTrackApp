# Phase 4 — Финальный план (после ревью Sonnet + Codex gpt-5.3)

## Порядок выполнения

### Задача 1: MonthPicker + dateFrom/dateTo (СРЕДНЯЯ, ~3-4ч)
**Файлы:**
- `src/utils/dateRange.js` — НОВЫЙ: getPeriodRange(), normalizeDateRange(), todayLocalISO()
- `src/components/MonthPicker.jsx` — НОВЫЙ: компонент (стрелки + название месяца)
- `src/hooks/useOperations.js` — добавить options {dateFrom, dateTo} в Supabase-запрос
- `src/pages/OperationPage.jsx` — selectedMonth state, убрать isDateInCurrentMonth

**Контракт useOperations:**
- Без dateFrom/dateTo: грузит ВСЕ операции (backward-compatible для WorkspacePage)
- С dateFrom/dateTo: добавляет .gte/.lte фильтр на серверный запрос
- summary рассчитывается из загруженных данных (не ломает дашборд)

**Политика TZ:**
- Единый helper todayLocalISO() вместо toISOString().slice(0,10)
- Все даты операций в локальной TZ пользователя
- Запретить UTC-срез для operation_date

### Задача 2: Архивация справочников (НИЗКАЯ, ~3ч)
**Файлы:**
- `supabase/migrations/20260227_phase4_archive.sql` — НОВЫЙ: ALTER TABLE + индексы + partial unique
- `src/hooks/useCategories.js` — showArchived, archiveCategory(), is_archived в select
- `src/hooks/useTags.js` — аналогично
- `src/pages/DictionariesPage.jsx` — toggle + кнопка архивации
- `src/components/AddOperationModal.jsx` — фильтровать архивные в select
- `src/components/EditOperationModal.jsx` — фильтровать архивные, но показать текущую если архивная
- `src/components/QuickButtonsSettings.jsx` — фильтровать архивные категории в select
- `src/pages/OperationPage.jsx` — фильтр категорий: показать все (включая архивные) для корректного отображения имён

**Политика уникальности:**
- UNIQUE(workspace_id, name) WHERE is_archived = false (partial unique index)
- При создании с именем архивной: предложить разархивировать

**Политика отображения:**
- В селектах создания/редактирования: только активные
- В списках операций: показывать имя архивной категории с пометкой "(архив)"
- useCategories грузит ВСЕ (включая архивные) для отображения имён в операциях
- Отдельный метод getActiveCategories() фильтрует для селектов

### Задача 3: AnalyticsPage (ВЫСОКАЯ, ~8-12ч)
**Файлы:**
- `src/hooks/useAnalytics.js` — НОВЫЙ: read-only хук, загрузка + агрегация за период
- `src/utils/analytics/aggregations.js` — НОВЫЙ: computeAnalytics() — общая функция
- `src/pages/AnalyticsPage.jsx` — полная реализация (заменить заглушку)

**Компоненты страницы:**
- PeriodSelector: текущий/прошлый месяц, квартал, год, произвольный (2 date inputs)
- SummaryTable: доходы/расходы/зарплаты/баланс за период
- Табы: [По категориям] [По тегам]
- CategoryBreakdown: имя + сумма + % + прогресс-бар (цвет категории)
- TagBreakdown: имя + сумма + %

**Решения:**
- Клиентская аналитика (без Supabase RPC)
- Переиспользует dateRange.js утилиты из задачи 1
- Не использует analyticsProvider (over-engineering)

### Задача 4: Группировка по дате (СРЕДНЯЯ, ~2-3ч)
**Файлы:**
- `src/pages/OperationPage.jsx` — groupedOperations useMemo, рендер с разделителями
- `src/utils/formatters.js` — formatGroupDate() с isToday/isYesterday

**Зависимости:** задача 1 (общие date-utils/TZ)

### Задача 5: Виджеты категорий на дашборде (СРЕДНЯЯ, ~2-3ч)
**Файлы:**
- `src/pages/WorkspacePage.jsx` — useCategories + topExpenseCategories useMemo + прогресс-бары

**Переиспользует:** aggregations.js из задачи 3

### Задача 6: Экспорт (СРЕДНЯЯ, ~3-4ч)
**Файлы:**
- `src/utils/export.js` — НОВЫЙ: exportToCSV(), buildTextReport()
- `src/pages/AnalyticsPage.jsx` — кнопки экспорта

**Решения:**
- CSV + BOM (\ufeff) + разделитель точка-с-запятой (для Excel с кириллицей)
- Текстовый отчёт: копирование в буфер через navigator.clipboard
- Без SheetJS (0 зависимостей)

## Граф зависимостей
```
Задача 1 (MonthPicker) ─→ Задача 3 (Analytics) ─→ Задача 5 (Виджеты)
         │                        │
         └─→ Задача 4 (Группировка)   └─→ Задача 6 (Экспорт)
Задача 2 (Архивация) — независимая, можно параллельно с 1
```

## Acceptance Criteria (минимум)
- [ ] MonthPicker: переключение месяцев корректно на границах года
- [ ] TZ: операция созданная в 23:50 попадает в правильный день
- [ ] Архивные категории скрыты в селектах, но видны в операциях
- [ ] Создание категории с именем архивной предлагает разархивацию
- [ ] Analytics: суммы совпадают с дашбордом за тот же период
- [ ] CSV: открывается в Excel с корректной кириллицей
- [ ] Прогресс-бары категорий корректны при 0 расходов

## Итого: ~22-29 часов
