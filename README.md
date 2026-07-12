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
- **Чеки без хранения оригиналов** — фото/PDF распознаются локально в браузере; исходный файл, имя и raw OCR не загружаются и не сохраняются, в БД попадают только подтверждённые нормализованные данные и опциональный маскированный комментарий позиций (принятый P1 scope: [`DOCUMENT_IMPORT_PRIVACY.md`](DOCUMENT_IMPORT_PRIVACY.md))
- **Обучаемая категоризация** — правила «текст операции → категория» из предпросмотра импорта с управлением в справочниках
- **Запланированные операции** — повторяющиеся платежи (ежедневно/еженедельно/ежемесячно/ежегодно), пауза/возобновление
- **Платёжный календарь** — прогноз на 30/60/90 дней, разовые планы, регулярные операции, долги и предупреждение о кассовом разрыве
- **Долги** — учёт долгов, частичные погашения, история платежей
- **Счета** — управление счетами и переводы между ними
- **Бюджеты** — лимиты по категориям, прогноз до конца месяца, копирование прошлого месяца
- **AI-ассистент** — read-only аналитика на естественном языке, RBAC-политики и локальный fallback
- **Распознавание речи** — провайдер-независимый STT-клиент и защищённая Edge Function; основной backend — Groq Whisper Large V3
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
    CashflowPage.jsx           — платёжный календарь и прогноз остатка
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
    ImportOperationsModal.jsx  — локальный разбор PDF/фото/CSV без хранения оригинала и безопасный предпросмотр
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
  services/
    stt.js                      — нейтральный клиентский контракт STT
    appStt.js                   — подключение STT-клиента к Supabase Functions
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
    stt-transcribe/            — защищённый multipart endpoint распознавания речи
    _shared/stt/               — интерфейс провайдера, registry и Groq-адаптер
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
| `/cashflow` | Платёжный календарь и прогноз кассового разрыва |
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

Telegram подключается в личном кабинете: приложение создаёт одноразовую ссылку сроком
на 10 минут, пользователь открывает бота и нажимает **Start**. Токен хранится в БД только
в виде SHA-256-хеша. Email и пароль в Telegram вводить не нужно.

| Команда | Описание |
|---------|----------|
| `/start` | Помощь или завершение привязки по одноразовой ссылке |
| `/unlink` | Отключить Telegram от аккаунта |
| `/workspaces`, `/ws` | Список и выбор пространства |
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

### Уведомления о платежах

Центр уведомлений хранит непрочитанные in-app напоминания и индивидуальные настройки
каждого участника пространства. Пользователь выбирает каналы, типы событий, несколько
сроков до события, отдельные сообщения или дневную сводку, час доставки и часовой пояс.
Сейчас работают `in_app`, уведомления браузера при открытом приложении и `telegram`;
модель каналов расширяется строковыми идентификаторами без изменения схемы для будущих
`email`, `whatsapp` и других провайдеров.

Edge Function `dispatch-notifications` обрабатывает плановые платежи, регулярные операции
и сроки задолженностей. Она вызывается Supabase Cron раз в час на пятой минуте, а повторные
уведомления блокируются уникальным ключом события и срока напоминания. Серверные secrets:
`NOTIFICATION_CRON_SECRET` и `TELEGRAM_BOT_TOKEN`; в Vercel они не нужны. Секрет cron
хранится в Supabase Vault и передаётся функции заголовком `x-cron-secret`.

### AI-ассистент

`ai-assistant` не принимает и не исполняет SQL от модели. RPC
`get_ai_financial_context` сначала проверяет роль и политику пространства, затем возвращает
ограниченную сводку максимум за 366 дней. В настройках пространства владелец/администратор
может отдельно разрешить каждой роли общие суммы, свои либо все операции, категории, счета
и описания. Все запросы записываются в `ai_assistant_logs` без сохранения ответа модели.

Серверные secrets Supabase: `OPENROUTER_API_KEY` и необязательный `OPENROUTER_MODEL`
(по умолчанию `openrouter/free`). Если провайдер недоступен, функция возвращает локальную
детерминированную сводку. Эти значения нельзя добавлять с префиксом `VITE_` или в Vercel.

### Speech-to-Text

Клиентский код вызывает единый метод `sttClient.transcribe(audio, options)` из
`src/services/appStt.js`. Он не знает модель, API URL или формат ответа конкретного
провайдера. Edge Function `stt-transcribe` принимает авторизованный `multipart/form-data`
запрос с полем `audio`, валидирует размер и формат и возвращает стабильный контракт:
`transcript`, `provider`, `model`, `language`, `duration_seconds`, `segments`, `words`,
`request_id` и `latency_ms`.

В модалке создания операции кнопка «Продиктовать» записывает до 30 секунд аудио,
показывает расшифровку и консервативно заполняет черновик: тип, сумму, относительную дату,
категорию и счета при точном совпадении. Голосовой ввод никогда не сохраняет операцию сам —
денежные поля остаются на обязательном пользовательском подтверждении.

Первый адаптер использует Groq `whisper-large-v3`, русский язык, температуру `0` и
`verbose_json`. Аудио обрабатывается в памяти, не сохраняется и не логируется. Поддерживаются
FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG, WAV и WEBM; прикладной лимит по умолчанию — 18 МБ.
Клиент не может выбрать модель или передать произвольный provider prompt.

Локальный запуск:

```bash
npx supabase functions serve stt-transcribe --env-file .env.local
```

Деплой и серверная конфигурация:

```bash
npx supabase secrets set \
  STT_PROVIDER=groq \
  GROQ_API_KEY=YOUR_GROQ_KEY \
  GROQ_STT_MODEL=whisper-large-v3
npx supabase functions deploy stt-transcribe
```

Необязательные secrets: `STT_TIMEOUT_MS` (по умолчанию `45000`),
`STT_MAX_FILE_BYTES` (по умолчанию `18874368`) и короткий серверный `STT_PROMPT` с
финансовой лексикой. `GROQ_API_KEY` нельзя объявлять как `VITE_GROQ_API_KEY`.

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

`workspaces`, `workspace_members`, `operations`, `categories`, `category_rules`, `tags`, `operation_tags`, `accounts`, `scheduled_operations`, `cashflow_plans`, `debts`, `budgets`, `notification_preferences`, `app_notifications`, `import_sessions`, `operation_comments`, `ai_access_policies`, `ai_assistant_logs`, `telegram_users`, `telegram_link_tokens`
