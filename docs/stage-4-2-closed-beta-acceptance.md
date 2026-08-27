# Stage 4.2 — закрытый beta-пилот и эксплуатационная приёмка

Статус на **27 августа 2026 года, 13:26 Asia/Qyzylorda**: owner, Member и Viewer core smoke выполнены, первый post-deploy backup успешен. Наблюдаемая неделя ещё не началась, реальные участники не подключены.

Текущий промежуточный вердикт: **CONDITIONAL GO к завершению owner-only gates перед T0**. Ролевой smoke и post-deploy backup закрыты; остаётся подтверждение фактического времени следующего scheduled backup. Это не финальный GO этапа 4.2 и не разрешение на open self-service.

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

## Локальная готовность browser security acceptance

Дополнение от **25 августа 2026 года, 17:59 UTC**:

- Подготовлены два local-only Playwright-этапа: последовательная смена Owner/Outsider/Member/Viewer в одном BrowserContext и одновременная работа четырёх изолированных BrowserContext.
- Финальный совместный прогон Chromium: **2/2 PASS за 21.6 секунды, retries 0**.
- Подтверждены RLS/BOLA-отказы перекрёстного чтения и записи, очистка приватного browser state при logout, параллельные записи Owner/Member и немедленное применение понижения Member → Viewer к уже открытой сессии.
- Синтетические `@example.invalid` users, workspaces и operations удалены teardown; canary-записи до удаления оставались неизменными.
- Общий application gate после изменений: lint PASS, **148/148 Node tests**, production build PASS.
- Строгий локальный SQL/TAP gate: **20 файлов, 328 planned assertions, PASS**.
- Раннер отклоняет remote/production URL до старта. Production, реальные данные, сообщения участникам, push, deploy, migration и production configuration не затрагивались.
- Network trace и video отключены; failed traces предыдущих отладочных прогонов удалены. Секреты в evidence не сохраняются.

Вердикт этого подэтапа: **READY к воспроизводимому локальному запуску двух browser-security тестов**. Результат усиливает техническую приёмку, но не заменяет 3–5 реальных beta-участников и семидневное эксплуатационное наблюдение.

## Pilot journal

### Day 0 preparation — 26 августа 2026 года

Baseline window: **26 августа 2026 года, 18:23–18:38 UTC**.

| Контур | Фактически проверенное состояние |
| --- | --- |
| Git/release | `HEAD = origin/main = 29cbb5c70b55c1140acf727927f2810d8c2ee82c`, divergence `0/0`; production bundle показывает `29cbb5c · production`. |
| GitHub CI | Quality `32998994686` и Security `32998994709` для `29cbb5c` завершились `success`. |
| Production/Vercel | Deployment `6109323114` имеет Production status `success`; `https://fintrackapp.vip` отвечает HTTP 200. |
| Production monitor | Ручной post-deploy run `32999403254` для `29cbb5c` завершился `success` в `2026-08-26T18:23:37Z`; отдельный ненагрузочный smoke проверил 12 Edge Functions. |
| Encrypted backup | Первый backup после deployment `29cbb5c` ещё не наступил. Новый schedule: `22:00 UTC` / `03:00 Asia/Qyzylorda`; контрольный срок — `2026-08-26T22:45:00Z` / `27 августа 03:45` local. Текущий baseline: `CONDITIONAL_BACKUP_PENDING`. |
| Supabase network restrictions | Read-only CLI подтвердил `status: applied`, IPv4 `[]`, IPv6 `[]`. Настройки не изменялись. |
| Public browser smoke | Desktop login и mobile `390×844` login/signup доступны; build SHA совпадает, горизонтального overflow и console errors нет, beta-consent и автоматический security-check контур присутствуют. Формы, CAPTCHA и login не отправлялись. |
| Owner-authenticated Day 0 smoke | Завершён в `2026-08-26T18:45Z`–`19:28Z` только в отдельном синтетическом workspace; подробности ниже. Пароли, OTP, cookies и токены не запрашивались. |
| Security-event aggregates | `blocked`: owner-controlled SQL session unavailable. Это зафиксированное допустимое pre-T0 ограничение; файл `scripts/stage-4-2-security-event-aggregates.sql` проверен и содержит только агрегаты без identifiers, metadata и финансовых строк. |

Решения владельца для пилота:

- cohort: **3 участника**;
- admission: **текущая регистрация с confirmation**, ссылка распространяется только среди согласованной когорты;
- scope первой недели: **core finance only**;
- optional-функции: **not-in-scope**;
- support channel: **прямые сообщения владельцу в существующем мессенджере**;
- triage owner: **владелец**;
- beta warning и independent-copy warning: **explicitly acknowledged**;
- security-event aggregates: **documented owner-SQL blocked**, без ослабления DB allowlist.

`T0` не установлен: реальные участники не подключались и сообщения им не отправлялись.

### Day 0 owner-controlled core smoke — 27 августа 2026 года

Smoke window: **26 августа 2026 года, 18:45–19:28 UTC**.

| Проверка | Результат без PII |
| --- | --- |
| Отдельный workspace | `PILOT TEST 2026-08-26`, personal, owner role — PASS. Существующие пространства не изменялись. |
| Счета | Автоматический основной KZT-счёт и второй синтетический KZT-счёт с нулевым opening balance — PASS. |
| Income create/edit | `1111 KZT` создан, затем изменён на `1222 KZT` и описание с префиксом `PILOT TEST` — PASS. |
| Expense create/split | `444 KZT` создан и физически разделён на две части по `222 KZT` в том же synthetic workspace — PASS. |
| Transfer | `333 KZT` между двумя synthetic KZT-счетами — PASS; общий income/expense balance не изменился. |
| Analytics | До удаления одной части: 4 операции, income `1222`, expense `444`, balance `778 KZT`; после удаления: 3 операции, income `1222`, expense `222`, balance `1000 KZT` — PASS. |
| Search и filters | Поиск по synthetic description возвращает одну строку; income-filter скрывает expense и transfer — PASS. |
| Mobile viewport | `390×844`, operations и split state доступны, horizontal overflow отсутствует — PASS. |
| Delete operation | После явного owner approval удалена ровно одна synthetic expense-part `222 KZT`; вторая часть осталась — PASS. |
| Logout/isolation | После logout `/login`; прямой private route перенаправляет на `/login`, synthetic workspace text не раскрывается — PASS. |
| Relogin/continuity | После самостоятельного owner relogin оставшиеся income, expense-part и transfer сохранились; итоговая analytics согласована — PASS. |
| Member/Viewer | Member account: registration, mandatory email confirmation, invitation acceptance и role assignment выполнены; create/read/delete synthetic expense `101 KZT` с маркером `PILOT MEMBER TEST` — PASS. Viewer invitation принято: роль `Наблюдатель`, owner-created synthetic data читаются, кнопки `Доход`, `Расход` и `Перевод` disabled — PASS. Email не фиксировались. |
| Optional-функции | `not-in-scope`; OCR/AI/STT, Push, email, Telegram и exports не запускались. |

Operational observations:

- повторяется console error загрузки Tesseract OCR worker с `cdn.jsdelivr.net`; OCR не запускался и остаётся `not-in-scope`, core smoke не затронут. Классификация: **Low / optional observation**;
- один раз после relogin появился `useCategories: load error`, но категории были полностью доступны до и после reload, операции и фильтры работали. Классификация: **Low / transient observation**.
- первая signup-попытка вернула `Регистрация временно недоступна`; один контролируемый retry прошёл, а вход до email confirmation был отклонён. Классификация: **Medium / transient admission observation**;
- production signup-форма не содержит повторного ввода пароля, а явная post-signup инструкция проверить email не была показана до перехода на login; само confirmation enforcement сработало. Повторный ввод пароля и проверка совпадения подготовлены локально, но ещё не опубликованы. Классификация: **Medium / registration UX**;
- invitation фактически было принято и membership создано, но повторный запрос одноразового token показал ложное `already accepted`. Классификация: **Medium / invitation idempotency UX**.

### Первый post-deploy encrypted backup

Run `33034898929` на SHA `29cbb5c` — **PASS**: configuration validation, temporary network window open/close, dump creation/verification, encryption, retention gate, private R2 upload и local cleanup успешны.
Workflow настроен на `0 22 * * *` (`03:00 Asia/Qyzylorda`), но первый запуск был создан в `2026-08-27T02:57:50Z`, то есть в `07:57` local. Backup gate закрыт по результату, а соблюдение нового времени остаётся неподтверждённым до следующего scheduled run; начало часа является известной зоной задержек GitHub Actions.

Оставшиеся pre-T0 gates:

- подтвердить следующий scheduled backup около `03:00` local либо после отдельного разрешения перенести cron с начала часа на минуту внутри 03:00–03:59.

Вердикт Day 0 core smoke: **PASS**, Critical/High findings не обнаружены. До закрытия оставшихся gates и отдельного разрешения участников не подключать, `T0` не начинать.

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

**CONDITIONAL GO к завершению pre-T0 gates**: Git/CI/production/Supabase baseline зелёный, Day 0 owner, Member и Viewer core smoke пройдены, post-deploy backup успешен, Critical/High findings не обнаружены.

Подтверждено владельцем и проверено:

- когорта — 3 доверенных участника; beta-условия и предупреждение о самостоятельной копии данных подтверждены;
- admission policy — текущая регистрация с confirmation и ограниченное распространение ссылки;
- первая неделя — `core finance only`, optional-функции — `not-in-scope`;
- support channel — личные сообщения владельцу в существующем мессенджере; triage owner — владелец;
- недоступность owner-controlled SQL для агрегатов security events принята как документированное ограничение до T0;
- Day 0 owner core smoke на синтетических данных пройден, включая сохранность после logout/relogin.
- Member create/read/delete smoke на синтетических данных пройден;
- Viewer acceptance/read/write-deny smoke пройден: общие данные читаются, финансовые write-actions отключены;
- первый post-deploy encrypted backup на актуальном production SHA прошёл все обязательные шаги, включая закрытие временного network window.

До снятия pre-T0 conditional status остаётся подтверждение фактического запуска backup в пределах согласованного часа `03:00–03:59 Asia/Qyzylorda`.

Participant T0 не начат. Приглашение участников требует отдельного разрешения владельца после закрытия оставшегося пункта. Финальный Stage 4.2 GO невозможен до семи календарных дней наблюдения, минимум трёх участников и прохождения обязательной матрицы. Open self-service остаётся вне scope.
