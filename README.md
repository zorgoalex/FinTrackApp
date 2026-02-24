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

### 🚧 Phase 3 — Учёт операций (в работе)
- [ ] Схема БД: таблица `operations` (amount, type, date, workspace_id, user_id)
- [ ] RLS политики для `operations`
- [ ] Frontend: формы добавления Доход / Расход / Зарплата
- [ ] Список операций с фильтрацией
- [ ] Удаление операций
- [ ] Dashboard с реальными данными
- [ ] Аналитика (графики по месяцам/категориям)

### 📋 Backlog
- Верификация домена в Resend (для отправки на любые email)
- Личный кабинет клиента (другой проект)
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
    WorkspacePage.jsx      — dashboard (stub для операций)
    WorkspaceSettingsPage.jsx — участники + приглашения
    InvitationAcceptPage.jsx
    OperationPage.jsx      — страница операций
    AnalyticsPage.jsx      — заглушка
  components/
    WorkspaceSwitcher.jsx  — переключатель с ролями и owner email
    Layout.jsx
  contexts/
    AuthContext.jsx
    WorkspaceContext.jsx   — loadAllWorkspaces с ролями и owner email

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
