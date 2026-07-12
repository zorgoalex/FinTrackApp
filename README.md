# FinTrackApp

Приложение для совместного учёта финансов с ролевой моделью, аналитикой и запланированными операциями.

**Стек:** React 18 + Vite + Tailwind CSS + Supabase (PostgreSQL + RLS + Edge Functions) + Resend

**Деплой:** https://fintrackapp-wheat.vercel.app

---

## Возможности

- **Рабочие пространства** — личные и командные, переключение, приглашения по email
- **Ролевая модель** — Владелец / Админ / Участник / Наблюдатель с RLS на уровне БД
- **Операции** — доходы, расходы, зарплаты с категориями и тегами
- **Быстрые кнопки** — настраиваемые шаблоны для частых операций
- **MonthPicker** — навигация по месяцам, группировка по дням с дневными итогами
- **Категории и теги** — CRUD, архивация, фильтрация по категории и типу
- **Аналитика** — итоги по периодам (месяц, квартал, год, произвольный), мультиселект пространств, разбивка по категориям/тегам
- **Экспорт** — CSV (с BOM для Excel) и копирование текстового отчёта
- **Безопасный импорт** — PDF, фото/скриншоты и CSV; локальный OCR, маскирование персональных данных, предпросмотр и защита от дублей
- **Обучаемая категоризация** — правила «текст операции → категория» из предпросмотра импорта с управлением в справочниках
- **Запланированные операции** — повторяющиеся платежи (ежедневно/еженедельно/ежемесячно/ежегодно), пауза/возобновление
- **Долги** — учёт долгов, частичные погашения, история платежей
- **Счета** — управление счетами и переводы между ними
- **Бюджеты** — лимиты по категориям, прогноз до конца месяца, копирование прошлого месяца
- **AI-ассистент** — read-only аналитика на естественном языке, RBAC-политики и локальный fallback
- **REST API** — полноценный API для внешних интеграций (CRUD операций, сводки, экспорт)
- **Telegram-бот** — добавление операций, сводки за день/месяц, привязка аккаунта
- **Настройки** — переименование, управление участниками, приглашения, удаление пространства
- **Дизайн-система** — шрифт Golos Text, CSS-переменные, анимации модалок, tabular-nums, оптимистичные обновления
- **Тёмная тема** — переключатель Sun/Moon, `prefers-color-scheme` по умолчанию, единая indigo-палитра
- **Редизайн** — glassmorphism навигация, увеличенные закругления и тени, активное состояние в sidebar
- **Lazy loading** — все страницы загружаются через React.lazy + Suspense, code splitting

---

## Статус по фазам

| Фаза | Описание | Статус |
|------|----------|--------|
| 1 | Инфраструктура, Auth, авто-workspace | ✅ Готово |
| 2 | Рабочие пространства, приглашения, роли | ✅ Готово |
| 3 | CRUD операций, dashboard, категории, теги, быстрые кнопки | ✅ Готово |
| 4 | MonthPicker, архивация, аналитика, группировка по дням, виджеты, экспорт | ✅ Готово |
| 5 | Производительность и дизайн (code splitting, vendor chunks, Golos Text, анимации) | ✅ Готово |
| — | Запланированные операции | ✅ Готово |
| — | Настройки пространства (e2e tested) | ✅ Готово |
| — | Редизайн UI + тёмная тема (indigo палитра, glassmorphism, dark mode) | ✅ Готово |
| — | Долги (CRUD, погашения, история) | ✅ Готово |
| — | Счета и переводы | ✅ Готово |
| 6 | REST API, Telegram-бот, аналитика мультиселект пространств | ✅ Готово |
| 7 | Read-only AI-аналитика с ролевым доступом и аудитом | ✅ Готово |

---

## Архитектура

```
src/
  pages/
    LoginPage.jsx              — вход
    SignupPage.jsx             — регистрация
    WorkspaceSelectPage.jsx    — выбор пространства
    WorkspaceCreatePage.jsx    — создание пространства
    WorkspacePage.jsx          — dashboard (итоги дня/месяца, топ категорий)
    WorkspaceSettingsPage.jsx  — участники, роли, приглашения
    OperationPage.jsx          — список операций, MonthPicker, фильтры, группировка
    AnalyticsPage.jsx          — аналитика по периодам, мультиселект пространств, экспорт
    ScheduledPage.jsx          — запланированные операции (CRUD, пауза/возобновление)
    DictionariesPage.jsx       — категории и теги (CRUD, архивация)
    DebtsPage.jsx              — учёт долгов, погашения
    BudgetsPage.jsx            — лимиты и прогноз расходов
    AssistantPage.jsx          — read-only AI-аналитика
    InvitationAcceptPage.jsx   — принятие приглашения по ссылке
    HomePage.jsx               — быстрые кнопки для добавления операций
    ComingSoonPage.jsx         — страница 404
  components/
    AddOperationModal.jsx      — модалка добавления операции
    EditOperationModal.jsx     — модалка редактирования операции
    ImportOperationsModal.jsx  — локальный разбор PDF/фото/CSV и безопасный предпросмотр
    DebtFormModal.jsx          — создание/редактирование долга
    DebtPaymentModal.jsx       — запись погашения долга
    DebtSelector.jsx           — виджет выбора долга
    MonthPicker.jsx            — навигация по месяцам
    QuickButtonsSettings.jsx   — настройка быстрых кнопок
    TagInput.jsx               — ввод тегов
    Toast.jsx                  — уведомления
    WorkspaceSwitcher.jsx      — переключатель пространств
    Layout.jsx                 — навигация, нижнее меню
    ProtectedRoute.jsx         — guard авторизации
  contexts/
    AuthContext.jsx             — Supabase auth + onAuthStateChange
    WorkspaceContext.jsx        — workspace, участники, приглашения, роли
    ThemeContext.jsx            — тёмная/светлая тема, localStorage + prefers-color-scheme
  hooks/
    useOperations.js            — CRUD операций, фильтрация по дате, summary
    useCategories.js            — CRUD категорий, архивация
    useTags.js                  — CRUD тегов, архивация
    useAccounts.js              — управление счетами
    useAnalytics.js             — агрегация аналитики, мультиселект пространств
    useScheduledOperations.js   — CRUD запланированных операций
    useDebts.js                 — CRUD долгов, погашения
    usePermissions.js           — ролевые права
  utils/
    dateRange.js                — утилиты периодов (getMonthRange, formatMonthYear)
    formatters.js               — форматирование сумм, дат
    export.js                   — exportToCSV, buildTextReport
    analytics/aggregations.js   — computeAnalytics()

supabase/
  functions/
    api/                       — Edge Function: REST API (операции, сводки, экспорт)
    telegram-bot/              — Edge Function: Telegram-бот
    invite-user/               — Edge Function: приглашение + Resend email
    accept-invitation/         — Edge Function: принятие с rollback
    _shared/                   — cors, email template
```

---

## Маршруты

| Путь | Страница |
|------|----------|
| `/login` | Вход |
| `/signup` | Регистрация |
| `/accept-invitation` | Принятие приглашения |
| `/workspaces` | Выбор пространства |
| `/workspaces/create` | Создание пространства |
| `/workspace/:id` | Dashboard |
| `/workspace/:id/settings` | Настройки пространства |
| `/workspace/:id/dictionaries` | Категории и теги |
| `/operations` | Операции |
| `/analytics` | Аналитика |
| `/debts` | Долги |
| `/scheduled` | Запланированные операции |
| `/budgets` | Бюджеты и прогноз |
| `/assistant` | AI-ассистент |

---

## REST API

**Endpoint:** `https://trpfmcggvixnfmcgvxsq.supabase.co/functions/v1/api`

**Авторизация:** `Authorization: Bearer <supabase_access_token>`

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/workspaces` | Список пространств пользователя |
| GET | `/workspaces/:id/summary` | Сводка доходов/расходов за период |
| GET | `/workspaces/:id/operations` | Список операций (dateFrom, dateTo, limit, offset) |
| GET | `/workspaces/:id/export` | Экспорт с фильтрами (type, category_id, sortBy) |
| POST | `/workspaces/:id/operations` | Создать операцию |
| PUT | `/workspaces/:id/operations/:opId` | Обновить операцию |
| DELETE | `/workspaces/:id/operations/:opId` | Удалить операцию |

---

## Telegram-бот

| Команда | Описание |
|---------|----------|
| `/start` | Начало работы |
| `/link_account` | Привязка Telegram к FinTrackApp |
| `/summary` | Общая сводка |
| `/today` | Итоги за сегодня |
| `/month` | Итоги за месяц |
| `/ops` | Последние операции |
| `/add`, `/income`, `/expense` | Добавить операцию |

---

## Запуск локально

```bash
npm install
cp .env.example .env.local  # заполнить VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

## Деплой

Vercel автоматически собирает `main` через Git-интеграцию. GitHub Actions не используются.
Перед каждым локальным коммитом хук `.githooks/pre-commit` выполняет `npm run verify`
(lint, unit-тесты и production build).

## Edge Functions

```bash
SUPABASE_ACCESS_TOKEN=... npx supabase@latest functions deploy api \
  --project-ref trpfmcggvixnfmcgvxsq --no-verify-jwt
```

### AI-ассистент

`ai-assistant` не принимает и не исполняет SQL от модели. RPC
`get_ai_financial_context` сначала проверяет роль и политику пространства, затем возвращает
ограниченную сводку максимум за 366 дней. В настройках пространства владелец/администратор
может отдельно разрешить каждой роли общие суммы, свои либо все операции, категории, счета
и описания. Все запросы записываются в `ai_assistant_logs` без сохранения ответа модели.

Серверные secrets Supabase: `OPENROUTER_API_KEY` и необязательный `OPENROUTER_MODEL`
(по умолчанию `openrouter/free`). Если провайдер недоступен, функция возвращает локальную
детерминированную сводку. Эти значения нельзя добавлять с префиксом `VITE_` или в Vercel.

### Мониторинг баланса OpenRouter

Edge Function `check-openrouter-balance` сохраняет серверный баланс в закрытой таблице
`ai_provider_status` и отправляет администратору письмо при переходе через пороги $15, $10 и $5.
Для неизменившейся проблемы письмо повторяется не чаще раза в сутки.

1. Применить миграции и развернуть функцию: `supabase db push`, затем
   `supabase functions deploy check-openrouter-balance --no-verify-jwt`.
2. Добавить Supabase secrets: `OPENROUTER_MANAGEMENT_KEY`, `AI_MONITOR_CRON_SECRET`,
   `AI_ADMIN_ALERT_EMAILS` и `RESEND_API_KEY`. Это серверные значения без префикса `VITE_`;
   добавлять их в Vercel не нужно.
3. В Supabase Cron создать POST-вызов функции каждые 30–60 минут и передавать случайный
   `AI_MONITOR_CRON_SECRET` в заголовке `x-cron-secret`. Для расписания секрет хранить через
   Supabase Vault, а не открытым текстом в SQL-миграции.

Пороги переопределяются секретами `AI_BALANCE_WARNING_USD`,
`AI_BALANCE_CRITICAL_USD` и `AI_BALANCE_SEVERE_USD`.

---

## Инфраструктура

- **Supabase:** `trpfmcggvixnfmcgvxsq.supabase.co` (eu-central-1)
- **Vercel:** авто-деплой из GitHub
- **GitHub:** `zorgoalex/FinTrackApp`

## БД (таблицы)

`workspaces`, `workspace_members`, `operations`, `categories`, `category_rules`, `tags`, `operation_tags`, `accounts`, `scheduled_operations`, `debts`, `budgets`, `import_sessions`, `operation_comments`, `ai_access_policies`, `ai_assistant_logs`, `telegram_users`
