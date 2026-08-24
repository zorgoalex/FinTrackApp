# Stage 4.1 — финальная production security acceptance

Дата проверки: **24 августа 2026 года**
Production: `https://fintrackapp.vip`
Проверенный production SHA: `ff4d699790a4747ff848f366c519669c32ace6bd`
Вердикт: **GO для закрытого beta-пилота на 3–5 доверенных пользователей**.

Критических или высоких проблем не найдено. Открытый self-service запуск для незнакомых пользователей остаётся отдельным этапом и не входит в этот GO.

## Доказательства

| Контур | Подтверждённое состояние |
| --- | --- |
| Git/Vercel | `main`, `origin/main` и production bundle совпадают на `ff4d699`; production entry `/assets/index-CGvrtAJq.js` содержит этот build SHA. Service worker не кеширует versioned JS/CSS и содержит stale-tab recovery. |
| Локальный release gate | Чистый `supabase db reset --local` применил миграции `20260824010000` и `20260824020000`. Lint, 145/145 Node-тестов, production build, 20 SQL-файлов и 328/328 pgTAP-проверок прошли. |
| GitHub CI | Quality gates `32749131124` и Security checks `32749131095` успешны для `ff4d699`. Ручной Production security monitor `32749403961` успешен на этом же SHA. |
| Supply chain | `npm ci` и `npm audit` показывают 0 уязвимостей. Failed Dependabot PR #11 относится только к несовместимому обновлению ESLint 10 и не присутствует в `main`. |
| Web perimeter | Ненагрузочный production smoke прошёл для 12 browser Edge Functions: разрешённый origin получает точный CORS, hostile origin — 403 без ACAO. Security headers присутствуют; типовые secret/source paths возвращают 404; sourcemap не опубликован. |
| Auth/Edge | Turnstile и email confirmation включены; anonymous/social/phone auth и manual linking выключены. Access token — 30 минут, refresh replay protection включён. Все 15 ожидаемых Edge Functions имеют статус `ACTIVE`. |
| PostgreSQL | Все ожидаемые security/privacy миграции до `20260824020000` присутствуют. У 38 таблиц `public` включён RLS, таблиц без RLS нет. Browser roles не имеют доступа к `private`, Data API публикует только `public`. Четыре cron-задачи активны. SSL enforcement применён, DB allowlist пуст для IPv4 и IPv6. |
| Audit/retention | За последние 7 дней в `private.security_events` было 3 события, без `failure` и `blocked`; персональные данные в проверку не выводились. Security Advisor после обеих production-миграций показывает 0 errors, 41 warning и 9 info; public warnings и обе trigger-only функции отсутствуют. |
| Backup/recovery | Свежий encrypted backup `32685980177` успешен: временное `/32` окно открыто и закрыто, dump проверен, зашифрован и загружен в private R2, локальный материал удалён. Restore drill от 9 августа подтверждает восстановление схем, таблиц, RLS и функций. |

## Найденное и локально исправленное

Production metadata обнаружил избыточные явные права `anon` на 21 RLS-защищённую таблицу `public` и наследуемый `EXECUTE` на 6 public-функций. Ограниченная impersonation-проверка завершилась `permission denied`; обхода RLS и раскрытия строк не выявлено. Поэтому это **Medium defense-in-depth finding**, а не подтверждённая утечка.

Локально добавлена forward-миграция `20260824010000_revoke_anonymous_public_privileges.sql`, которая:

- отзывает у `PUBLIC` и `anon` права на все таблицы, последовательности и функции схемы `public`;
- закрывает PostgreSQL default privileges, чтобы поздние миграции не возвращали анонимный доступ;
- сохраняет явные grants для `authenticated` и `service_role` и все RLS-политики.

В pgTAP добавлены регрессионные проверки отсутствия у `anon` table, sequence и function privileges. Миграция `20260824010000` применена в production и записана в migration history; независимая проверка дала нули для table, sequence, function и default privileges.

Повторный Advisor подтвердил исчезновение двух public warnings. Затем сравнение production с чистой локальной схемой выявило drift: `authenticated` и `service_role` имели явный `EXECUTE` на trigger-only функциях `create_user_profile()` и `protect_operation_reconciliation()`. Миграция `20260824020000_revoke_trigger_function_execute.sql` опубликована и применена. Независимая проверка подтвердила четыре отозванных grants, 40 ожидаемых authenticated `SECURITY DEFINER` RPC и 0 anonymous executable functions.

## Закрытие Stage 4.1

Все обязательные критерии закрыты: код, production SHA, обе миграции, grants/RLS, Advisor, CI, Vercel, backup и production monitor подтверждены фактическими проверками. Production load test не выполнялся.

Операционное сопровождение: сохранять ежедневный encrypted backup, шестичасовой production monitor и выполнять restore drill после существенных изменений схемы или backup workflow.

Итог: **GO для закрытого beta-пилота на 3–5 доверенных пользователей**.
