# Stage 4.2 — закрытый beta-пилот и эксплуатационная приёмка

Статус на **24 августа 2026 года, 19:58 UTC**: выполнен pre-pilot baseline. Наблюдаемая неделя ещё не началась, участники не подключены.

Текущий промежуточный вердикт: **CONDITIONAL GO только к Day 0 owner smoke** после подтверждения владельцем когорты, admission policy и optional scope/support. Это не финальный GO этапа 4.2 и не разрешение на open self-service.

## Границы проверки

- Production: `https://fintrackapp.vip`.
- Реальные финансовые строки, email участников, privacy exports, cookies, JWT и секреты не читались и не сохранялись.
- Production load/stress test, массовые уведомления и искусственные incidents не выполнялись.
- Push, deploy, migration, production configuration change, приглашения и сообщения участникам не выполнялись.
- Будущие участники обозначаются только `P01`–`P05`.

## Pre-pilot baseline

Baseline window: **24 августа 2026 года, 19:50–19:58 UTC**.

| Контур | Фактически проверенное состояние |
| --- | --- |
| Git | Ветка `main`; локальный `HEAD` `fc8961c3b7108ed9cf568163e75a716df3b8af76`; обновлённый `origin/main` `ff4d699790a4747ff848f366c519669c32ace6bd`; divergence `0 behind / 1 ahead`. Локальный commit — только Stage 4.1 documentation. Рабочее дерево до создания этого отчёта было чистым. |
| Production/Vercel | GitHub deployment `6066576462` указывает Production на `ff4d699`. `https://fintrackapp.vip` отвечает 200, entry `/assets/index-CGvrtAJq.js` содержит `ff4d699` и не содержит локальный `fc8961c`. Security headers и `fintrack-static-v3` присутствуют. |
| GitHub Quality | Run `32749131124`, SHA `ff4d699`, success. Успешны application verify и strict SQL/TAP job. |
| GitHub Security | Run `32749131095`, SHA `ff4d699`, success. Успешны dependency audit, gitleaks и CodeQL. |
| Production monitor | Последний run baseline `32765389654`, SHA `ff4d699`, success в `2026-08-24T18:58:09Z`. Необъяснённого разрыва более 12 часов нет. |
| Encrypted backup | Run `32685980177`, success в `2026-08-24T03:19:43Z`. Успешны dump validation, закрытие временного network window, encryption verification, private R2 upload и удаление локального материала. |
| Supabase control plane | DB allowlist: IPv4 `[]`, IPv6 `[]`, status `applied`. Все 15 ожидаемых Edge Functions имеют статус `ACTIVE`. |
| Local release gate | `npm ci`: 0 vulnerabilities. Чистый локальный Supabase reset прошёл. `npm run verify:release`: lint, 145/145 Node-тестов, production build, 20 SQL-файлов и 328/328 запланированных pgTAP-проверок; exit 0, `not ok`/`# Failed test` не обнаружены. |
| Production Edge smoke | Ненагрузочный `production-security-smoke.mjs` прошёл для 12 browser-facing Edge Functions в `2026-08-24T19:50:16Z`. |
| Public browser smoke | Login/signup доступны, UI показывает `ff4d699 · production`, beta-consent присутствует, Turnstile response-контур загружен. На viewport 390×844 горизонтального overflow и console errors нет. Формы и CAPTCHA не отправлялись. |

## Разобранные operational signals

- Monitor run `32651812408` от 23 августа завершился ошибкой, потому что сразу после push новый `privacy-export` ещё отвечал 404. Успешный workflow-dispatch `32652075394` прошёл примерно через пять минут; последующие scheduled runs успешны. Сигнал классифицирован как объяснённый deploy-race, а не текущий incident.
- Backup failure `31923776013` от 16 августа находится вне текущего семидневного baseline window. Все перечисленные в GitHub runs с 18 по 24 августа успешны.
- Build сохраняет известные size warnings для тяжёлого OCR/browser bundle. В baseline нет подтверждённого runtime defect; OCR остаётся optional и не включается в пилот автоматически.

## Не завершено в baseline

- Агрегаты `private.security_events` за 24 часа и 7 дней не читались: безопасная owner-controlled SQL-сессия в этой проверке не была доступна. Нужны только группировки по дню, `event_type` и `outcome`, без `subject`, `details` и строк финансовых таблиц.
- Admission policy, размер когорты, support/triage и optional-функции ещё не подтверждены владельцем.
- Day 0 owner smoke и пользовательские сценарии не начинались.
- Дата начала семидневного наблюдения не установлена: она появится только после baseline-записи и подключения первого согласованного участника.

## Pilot journal

```text
UTC date/time: 2026-08-24T19:50:16Z
Participant: SYSTEM
Area: monitor | backup | production | release-gate
Result: pass
Environment: production HTTP + public desktop/mobile browser; local clean DB
Evidence: ff4d699; Quality 32749131124; Security 32749131095; Monitor 32765389654; Backup 32685980177
Issue: none
Next action: obtain owner pilot decisions, then perform Day 0 owner-controlled smoke
```

Новые journal-записи добавляются только при фактической проверке, новом результате, сбое или изменении статуса.

## Матрица сценариев

Матрица будет заполнена после утверждения когорты. Пустые ячейки не считаются `pass` или `not in scope`.

| Сценарий | P01 | P02 | P03 | P04 | P05 |
| --- | --- | --- | --- | --- | --- |
| Registration/invitation, confirmation, Turnstile, login | — | — | — | — | — |
| Beta/privacy consent | — | — | — | — | — |
| Workspace create/join | — | — | — | — | — |
| Create/edit/delete operation | — | — | — | — | — |
| Transfer or split operation | — | — | — | — | — |
| Analytics and filters | — | — | — | — | — |
| Logout/relogin and isolation check | — | — | — | — | — |
| Mobile browser smoke | — | — | — | — | — |
| Separate Member/Viewer accounts | — | — | — | — | — |

## Решение на текущем шаге

**CONDITIONAL GO к подготовке Day 0 owner smoke**, потому что Git/CI/production/Supabase baseline зелёный и Critical/High findings не обнаружены.

Условия снятия pre-pilot conditional status:

1. владелец подтверждает 3–5 доверенных участников и beta-условия;
2. владелец выбирает admission policy;
3. владелец определяет optional scope, support channel и ответственного за triage;
4. безопасно фиксируются агрегаты security events либо документируется временная недоступность owner-controlled SQL;
5. owner-controlled аккаунт проходит Day 0 core smoke на синтетических данных.

Финальный Stage 4.2 GO невозможен до семи календарных дней наблюдения, минимум трёх участников и прохождения обязательной матрицы. Open self-service остаётся вне scope.
