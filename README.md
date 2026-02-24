# FinTrackApp

Приложение для учёта финансов рабочих пространств с ролевой моделью и системой приглашений.

**Стек:** React 18 + Vite + Tailwind + Supabase (PostgreSQL + RLS + Edge Functions) + Resend

**Деплой:** https://fintrackapp-alexeys-projects-7afd0399.vercel.app

---

## Статус по фазам

### ✅ Phase 1 — Инфраструктура
- Supabase проект (`ofnwfuqmwrshojcfhwyk`, eu-central-1)
- Vercel деплой с SPA routing (`vercel.json`)
- Auth: регистрация, вход, выход, email redirect
- Автосоздание личного workspace при регистрации

### ✅ Phase 2.1 — Рабочие пространства и приглашения
- Создание / переключение workspace
- Workspace Switcher: роли (Владелец/Участник/Админ), жирный текст для своих, голубой фон для чужих, email владельца
- Система приглашений end-to-end:
  - Edge Function `invite-user` (с валидацией роли, whitelist, нормализацией email)
  - Edge Function `accept-invitation` (атомарность, rollback, email-check)
  - Email через Resend (`onboarding@resend.dev`)
  - Ссылка сохраняется после login/signup (fix `location.state`)
- Soft delete участников (`is_active = false`)
- Настройки workspace: управление участниками, роли, приглашения
- Срок приглашения: 7 дней (настраивается)

### ✅ Phase 3 — Учёт операций
- Схема БД: таблица `operations` (amount, type, date, workspace_id, user_id nullable)
- RLS политики: Owner/Admin — любые операции, Member — только свои
- `useOperations` hook — CRUD (add, delete, refresh, summary)
- Frontend: формы добавления Доход / Расход / Зарплата (модальное окно)
- Список операций за текущий месяц с автором записи
- Удаление операций с подтверждением
- Dashboard с реальными данными (суммы за сегодня и за месяц)
- Поддержка нескольких пользователей в одном workspace

### 📋 Phase 4 — Категории и кастомный дашборд
- Таблица `categories` (name, type, workspace_id)
- Привязка операций к категории
- Пользователь выбирает 2 категории расходов для главной страницы
- Кастомные кнопки вместо фиксированной "Зарплата"

### 📋 Phase 5 — API и интеграции
- REST/Webhook API для внешних сервисов
- Telegram-бот: добавление операций командами/кнопками
- Авторизация по токену пользователя

### 📋 Phase 6 — AI-инструменты
- Голосовой ввод (STT → парсинг → создание операции)
- AI-аналитика: ответы на вопросы по финансовым данным

### 📋 Backlog
- Верификация домена в Resend (для отправки на любые email)
- Включить email-подтверждение перед продакшеном
- Запланированные операции

---

## Архитектура

```
src/
  pages/
    LoginPage.jsx          — вход (сохраняет redirect после invite)
    SignupPage.jsx         — регистрация (аналогично)
    WorkspaceSelectPage.jsx
    WorkspaceCreatePage.jsx
    WorkspacePage.jsx      — dashboard с реальными данными
    WorkspaceSettingsPage.jsx — участники + приглашения
    InvitationAcceptPage.jsx
    OperationPage.jsx      — CRUD операций (Доход/Расход/Зарплата)
    AnalyticsPage.jsx      — заглушка (Phase 4+)
  components/
    WorkspaceSwitcher.jsx  — переключатель с ролями и owner email
    Layout.jsx
  contexts/
    AuthContext.jsx
    WorkspaceContext.jsx   — workspace + searchParams workspaceId support
  hooks/
    useOperations.js       — CRUD операций, summary за день/месяц
    usePermissions.js      — ролевые права (canCreate/Delete/Edit)

supabase/
  functions/
    invite-user/           — отправка приглашения + Resend
    accept-invitation/     — принятие с rollback
    _shared/               — cors, email-config, html template
```

---

## Credentials

Хранятся в `specdata/supabase_credentials.md` (не в git).

- **Supabase:** `ofnwfuqmwrshojcfhwyk.supabase.co`
- **Vercel project:** `prj_vnYvd0kNsQaPhb2C9YhpoStteznm`
- **GitHub:** `zorgoalex/FinTrackApp`

---

## Запуск локально

```bash
npm install
cp .env.example .env.local  # заполнить Supabase URL + anon key
npm run dev
```

## Деплой на Vercel

```bash
node /tmp/deploy_vercel.js  # REST API деплой (vercel CLI с vcp_ токеном не работает)
```

## Edge Functions

```bash
SUPABASE_ACCESS_TOKEN=... npx supabase@latest functions deploy invite-user \
  --project-ref ofnwfuqmwrshojcfhwyk --no-verify-jwt
```
