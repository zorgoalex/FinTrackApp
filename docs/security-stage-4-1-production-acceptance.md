# Stage 4.1 — финальная production security acceptance

Дата проверки: **24 августа 2026 года**
Production: `https://fintrackapp.vip`
Проверенный production SHA: `8c22aab3800f16250bbf220c9237422b6c1a8337`
Вердикт: **CONDITIONAL GO для существующего закрытого beta-пилота на 3–5 доверенных пользователей**.

Расширять пилот до незнакомых пользователей пока не следует. Критических или высоких проблем не найдено, но до полного GO нужно применить одну defense-in-depth миграцию и получить зелёный production monitor на актуальном release SHA.

## Доказательства

| Контур | Подтверждённое состояние |
| --- | --- |
| Git/Vercel | `main`, `origin/main` и production bundle совпадают на `8c22aab`. Service worker не кеширует versioned JS/CSS и содержит stale-tab recovery. |
| Локальный release gate | Чистый `supabase db reset --local` применил всю цепочку миграций. `npm run verify:release` завершился успешно: lint, 145/145 Node-тестов, production build, 20 SQL-файлов и 326/326 pgTAP-проверок. |
| GitHub CI | Quality gates `32659546844` и Security checks `32659546799` успешны для `8c22aab`. Все actions закреплены на immutable SHA; permissions минимальны. |
| Supply chain | `npm ci` и `npm audit` показывают 0 уязвимостей. Failed Dependabot PR #11 относится только к несовместимому обновлению ESLint 10 и не присутствует в `main`. |
| Web perimeter | Ненагрузочный production smoke прошёл для 12 browser Edge Functions: разрешённый origin получает точный CORS, hostile origin — 403 без ACAO. Security headers присутствуют; типовые secret/source paths возвращают 404; sourcemap не опубликован. |
| Auth/Edge | Turnstile и email confirmation включены; anonymous/social/phone auth и manual linking выключены. Access token — 30 минут, refresh replay protection включён. Все 15 ожидаемых Edge Functions имеют статус `ACTIVE`. |
| PostgreSQL | Все ожидаемые security/privacy миграции до `20260823030000` присутствуют. У 38 таблиц `public` включён RLS, таблиц без RLS нет. Browser roles не имеют доступа к `private`, Data API публикует только `public`. Четыре cron-задачи активны. SSL enforcement применён, DB allowlist пуст для IPv4 и IPv6. |
| Audit/retention | За последние 7 дней в `private.security_events` было 3 события, без `failure` и `blocked`; персональные данные в проверку не выводились. Security Advisor показывает 0 ошибок. Девять info-пунктов — намеренные deny-by-default таблицы с RLS без browser policy. |
| Backup/recovery | Encrypted backup `32614962375` успешен: временное `/32` окно открыто и закрыто, dump проверен, зашифрован и загружен в private R2, локальный материал удалён. Restore drill от 9 августа подтверждает восстановление схем, таблиц, RLS и функций. |

## Найденное и локально исправленное

Production metadata обнаружил избыточные явные права `anon` на 21 RLS-защищённую таблицу `public` и наследуемый `EXECUTE` на 6 public-функций. Ограниченная impersonation-проверка завершилась `permission denied`; обхода RLS и раскрытия строк не выявлено. Поэтому это **Medium defense-in-depth finding**, а не подтверждённая утечка.

Локально добавлена forward-миграция `20260824010000_revoke_anonymous_public_privileges.sql`, которая:

- отзывает у `PUBLIC` и `anon` права на все таблицы, последовательности и функции схемы `public`;
- закрывает PostgreSQL default privileges, чтобы поздние миграции не возвращали анонимный доступ;
- сохраняет явные grants для `authenticated` и `service_role` и все RLS-политики.

В pgTAP добавлены регрессионные проверки отсутствия у `anon` table, sequence и function privileges. После чистого reset у `anon` нет executable `SECURITY DEFINER` функций; 40 authenticated `SECURITY DEFINER` RPC остаются намеренной прикладной поверхностью. У 39 определений есть непосредственная проверка Auth/JWT, а оставшийся balance-history wrapper вызывает закрытую реализацию с membership-проверкой; non-member сценарий покрыт pgTAP.

Security Advisor production сейчас показывает 45 предупреждений: 2 — публично вызываемые `SECURITY DEFINER` функции, которые закрывает новая миграция, остальные относятся к намеренно доступным signed-in RPC. После production-миграции linter нужно запустить повторно и отдельно подтвердить отсутствие категории `Public Can Execute SECURITY DEFINER Function`.

## Почему пока не полный GO

1. Миграция `20260824010000_revoke_anonymous_public_privileges.sql` проверена только локально и ещё не применена к production.
2. Последний scheduled Production security monitor `32659105778` успешен, но относится к предыдущему SHA `8418599`; локальный ручной smoke для текущего production прошёл, однако формальный monitor на актуальном SHA ещё отсутствует.

## Действия после отдельного разрешения владельца

1. Опубликовать проверенный Stage 4.1 commit в `origin/main`; дождаться зелёных Quality/Security gates и синхронизации Vercel production SHA.
2. Применить только `20260824010000_revoke_anonymous_public_privileges.sql` к связанному Supabase production и повторить read-only grants/function queries.
3. Перезапустить Supabase Security Advisor и убедиться, что public `SECURITY DEFINER` warnings исчезли.
4. Запустить Production security monitor на новом release SHA и получить `success`.
5. Повторить короткий login/signup/Turnstile smoke без массовых регистраций и без load test.

Полный **GO** можно выставить после этих подтверждений. Production mutation, push, migration и deploy выполняются только после отдельного явного разрешения.
