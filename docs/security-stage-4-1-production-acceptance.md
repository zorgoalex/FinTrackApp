# Stage 4.1 — финальная production security acceptance

Дата проверки: **24 августа 2026 года**
Production: `https://fintrackapp.vip`
Проверенный production SHA: `a0a942e9c5f6e543982dbd757ddee6f5e11b97af`
Вердикт: **CONDITIONAL GO для существующего закрытого beta-пилота на 3–5 доверенных пользователей**.

Расширять пилот до незнакомых пользователей пока не следует. Критических или высоких проблем не найдено; до полного GO нужно применить одну оставшуюся drift-remediation миграцию.

## Доказательства

| Контур | Подтверждённое состояние |
| --- | --- |
| Git/Vercel | `main`, `origin/main` и production bundle совпадают на `a0a942e`; production entry `/assets/index-DMPIqIEn.js` содержит этот build SHA. Service worker не кеширует versioned JS/CSS и содержит stale-tab recovery. |
| Локальный release gate | Чистый `supabase db reset --local` применил миграции `20260824010000` и `20260824020000`. Lint, 145/145 Node-тестов, production build, 20 SQL-файлов и 328/328 pgTAP-проверок прошли. |
| GitHub CI | Quality gates `32665090153` и Security checks `32665090189` успешны для `a0a942e`. Scheduled production monitor успешен на этом же SHA, включая runs `32681367828`, `32700925750` и `32731213685`. |
| Supply chain | `npm ci` и `npm audit` показывают 0 уязвимостей. Failed Dependabot PR #11 относится только к несовместимому обновлению ESLint 10 и не присутствует в `main`. |
| Web perimeter | Ненагрузочный production smoke прошёл для 12 browser Edge Functions: разрешённый origin получает точный CORS, hostile origin — 403 без ACAO. Security headers присутствуют; типовые secret/source paths возвращают 404; sourcemap не опубликован. |
| Auth/Edge | Turnstile и email confirmation включены; anonymous/social/phone auth и manual linking выключены. Access token — 30 минут, refresh replay protection включён. Все 15 ожидаемых Edge Functions имеют статус `ACTIVE`. |
| PostgreSQL | Все ожидаемые security/privacy миграции до `20260824010000` присутствуют. У 38 таблиц `public` включён RLS, таблиц без RLS нет. Browser roles не имеют доступа к `private`, Data API публикует только `public`. Четыре cron-задачи активны. SSL enforcement применён, DB allowlist пуст для IPv4 и IPv6. |
| Audit/retention | За последние 7 дней в `private.security_events` было 3 события, без `failure` и `blocked`; персональные данные в проверку не выводились. Security Advisor после production hardening показывает 0 errors, 43 warnings и 9 info; категория public `SECURITY DEFINER` отсутствует. |
| Backup/recovery | Свежий encrypted backup `32685980177` успешен на `a0a942e`: временное `/32` окно открыто и закрыто, dump проверен, зашифрован и загружен в private R2, локальный материал удалён. Restore drill от 9 августа подтверждает восстановление схем, таблиц, RLS и функций. |

## Найденное и локально исправленное

Production metadata обнаружил избыточные явные права `anon` на 21 RLS-защищённую таблицу `public` и наследуемый `EXECUTE` на 6 public-функций. Ограниченная impersonation-проверка завершилась `permission denied`; обхода RLS и раскрытия строк не выявлено. Поэтому это **Medium defense-in-depth finding**, а не подтверждённая утечка.

Локально добавлена forward-миграция `20260824010000_revoke_anonymous_public_privileges.sql`, которая:

- отзывает у `PUBLIC` и `anon` права на все таблицы, последовательности и функции схемы `public`;
- закрывает PostgreSQL default privileges, чтобы поздние миграции не возвращали анонимный доступ;
- сохраняет явные grants для `authenticated` и `service_role` и все RLS-политики.

В pgTAP добавлены регрессионные проверки отсутствия у `anon` table, sequence и function privileges. Миграция `20260824010000` применена в production и записана в migration history; независимая проверка дала нули для table, sequence, function и default privileges.

Повторный Advisor подтвердил исчезновение двух public warnings. Затем сравнение production с чистой локальной схемой выявило drift: `authenticated` и `service_role` имеют явный `EXECUTE` на trigger-only функциях `create_user_profile()` и `protect_operation_reconciliation()`. Приложение и Edge Functions их как RPC не вызывают. Локально добавлена отдельная forward-миграция `20260824020000_revoke_trigger_function_execute.sql` и две pgTAP-регрессии; полный gate после чистого reset зелёный.

## Почему пока не полный GO

1. Новая drift-remediation миграция `20260824020000_revoke_trigger_function_execute.sql` проверена локально, но ещё не опубликована и не применена к production. Остальные критерии Stage 4.1 закрыты.

## Действия после отдельного разрешения владельца

1. Опубликовать follow-up commit с `20260824020000` и дождаться зелёных Quality/Security gates и Vercel SHA.
2. Применить только `20260824020000_revoke_trigger_function_execute.sql` к production.
3. Подтвердить, что authenticated `SECURITY DEFINER` count совпал с чистой локальной схемой (40), а Advisor больше не перечисляет две trigger-only функции.

Полный **GO** можно выставить после этих подтверждений. Production mutation, push, migration и deploy выполняются только после отдельного явного разрешения.
