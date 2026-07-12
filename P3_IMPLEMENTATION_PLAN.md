# P3: бизнес-контур FinTrackApp

Дата ревью: 12 июля 2026 года. Актуализировано: 13 июля 2026 года.

## 1. Результат ревью текущего проекта

FinTrackApp уже имеет хорошую основу для денежного контроля микробизнеса:

- business/personal workspaces и роли Owner, Admin, Member, Viewer;
- операции дохода, расхода, зарплаты и перевода;
- банковские/кассовые счета, валюты и курсы;
- бюджеты, долги, регулярные и плановые платежи;
- платёжный календарь и прогноз кассового разрыва;
- импорт документов и выписок, категории, теги и комментарии;
- REST API, Telegram, уведомления и read-only AI;
- RLS и часть финансовых инвариантов реализованы в PostgreSQL.

Текущая проверка проходит: lint, 40 unit-тестов, production build и 127 удалённых pgTAP-тестов в 9 suites. DB suite выполняется напрямую через `psql` против тестового Supabase без локального Docker.

## 1.1 Обязательный gate P1/P2 перед P3

Решение по текущему состоянию: **NO-GO для начала P3**. P3 можно переводить в разработку только после полной функциональной и технической приёмки P1 и P2.

Текущий честный статус readiness gate: **12/14 DONE**. Незавершённые пункты относятся к P2 platform:

- Push/email delivery — `PARTIAL`;
- PWA/offline-first — `NOT STARTED`.

Этап **P2 Product Completion — server-synced dashboard и bulk edit** завершён. Это не открывает P3 до завершения двух platform-пунктов.

### Зафиксированное изменение scope

`Net worth / активы / имущество` полностью исключены из стратегии FinTrackApp и из readiness gate. Продукт не является реестром имущества, модулем инвентаризации, учётом основных средств или системой расчёта амортизации. Денежные счета, долги, бюджеты и цели покрывают целевой контур управления деньгами без ручного каталога имущества и субъективных переоценок.

Наличие экрана или части сценария не считается завершением. Для статуса `DONE` нужны одновременно:

- полный пользовательский сценарий и обработка ошибок;
- серверные constraints/RPC для финансовых инвариантов;
- корректные RLS-политики по всем ролям;
- unit, DB integration и ключевые E2E-тесты;
- миграция/обратная совместимость существующих данных;
- документация и проверка production-like сборки.

### Текущая матрица P1

| Пункт | Статус | Подтверждённое состояние | Что закрыть до P3 |
|---|---|---|---|
| Импорт выписок с шаблонами колонок | DONE | Есть mapping preview, сохраняемые workspace-шаблоны и тесты CSV/PDF/image форматов | Подтверждено production build и unit/DB tests |
| Дедупликация и подтверждение импорта | DONE | Уникальные fingerprints, immutable session и идемпотентный атомарный `confirm_import` | Подтверждено DB integration tests |
| Статусы операций new/verified/reconciled | DONE | Серверная state machine, роли, аудит переходов, фильтры и UI сверки | Подтверждено DB integration tests и production build |
| Контрагенты и правила категоризации | DONE | Нормализованный справочник, tax ID, связи с операциями/долгами, merge и обучаемые правила | Подтверждено RLS/DB tests и UI |
| Split-транзакции | DONE | Atomic allocations, серверный контроль суммы, редактирование, budgets/analytics/export учитывают части | Подтверждено 13 DB tests и unit test аналитики |
| Чеки: privacy-first локальное распознавание (без хранения оригинала) | DONE для принятого P1 scope | PDF/фото распознаются в браузере; оригинал, имя файла и raw OCR не загружаются и не хранятся; сохраняются только подтверждённая операция, редактируемый маскированный комментарий и metadata/hash | ADR, критерии и release evidence зафиксированы в `DOCUMENT_IMPORT_PRIVACY.md`; серверное хранилище оригиналов явно вне P1 scope |
| Перенос бюджетов и накопительные цели | DONE | Rollover `none/unused/full`, carry cap, split-aware progress, цели, взносы и status workflow доступны в UI | Подтверждено 21 DB test и production build |
| Сравнение периодов и динамика остатков | DONE | Сравнение периодов дополнено opening balance/date и day/week/month историей счетов в базовой валюте | Подтверждено 17 DB tests, включая переводы, FX и RLS |

### Текущая матрица P2

| Пункт | Статус | Подтверждённое состояние | Что закрыть до P3 |
|---|---|---|---|
| Календарь платежей и подписок | DONE для текущего scope | Планы, регулярные операции, долги, 30/60/90 дней и cash-gap forecast | Зафиксировать scope подписок и добавить E2E/DB tests |
| Push/email/in-app уведомления | PARTIAL | In-app, Telegram и browser notification при открытом приложении | Настоящий Web Push/service worker и email delivery; email сейчас disabled |
| Настраиваемый dashboard | DONE | Per-user server preferences, видимость/порядок/size presets, перенос legacy localStorage и настройки счетов синхронизируются с сервером | Подтверждено DB/RLS tests и E2E с reload/persistence |
| PWA и offline-first добавление расходов | NOT STARTED | Manifest/service worker/offline queue отсутствуют | Installable PWA, offline storage, sync queue, conflict/idempotency policy |
| Восстановление JSON-бэкапа | DONE | Backup v2 покрывает финансовые сущности; локальная и серверная validation, dry-run preview и атомарный upsert RPC | Подтверждено unit suite и 11 DB/RLS tests с rollback |
| Массовое редактирование | DONE | Selection UI для desktop/mobile, category/tag/status actions и лимит 500 записей работают через атомарный RPC | Подтверждено 13 DB/RLS tests и production build |

### Обязательный этап P1/P2 Completion

До Этапа 0 P3 выполнить отдельную программу завершения:

1. ~~Закрыть финансовую целостность P1: серверная дедупликация, operation statuses, splits и counterparties.~~ DONE.
2. ~~Закрыть бюджетирование P1: rollover и savings goals.~~ DONE.
3. ~~Закрыть release evidence privacy-first распознавания чеков и balance history.~~ DONE.
4. Закрыть P2 platform: Web Push/email и PWA/offline; transactional restore DONE.
5. ~~Закрыть P2 product: полноценный dashboard и bulk edit.~~ DONE.
6. Добавить E2E suite и провести повторную приёмку всех 14 пунктов; DB integration/RLS suite для P1 уже добавлена.

Только итог `14/14 DONE` открывает P3. Net worth/assets удалены из знаменателя письменным продуктовым решением, а не перенесены в backlog.

### Подтверждённые пробелы перед P3

1. Нормализованные контрагенты, правила категоризации и split allocations уже реализованы в P1; их нужно использовать как основу P3, а не проектировать повторно.
2. Существующие `accounts` — денежные счета, а не invoices/bills.
3. Нет финансового документа, строк документа, нумерации, срока оплаты и распределения платежей.
4. Проекты и центры затрат пока нельзя назначить операции или части операции.
5. Текущая аналитика агрегирует кассовые операции на клиенте. Она не является P&L.
6. Текущий cash-flow — прогнозный календарь, а не отчёт о движении денежных средств.
7. Четыре общие роли недостаточны для разделения requester/approver/accountant.
8. `ai_assistant_logs` журналирует только AI-запросы. Общего audit trail нет.
9. Перед P3 требуется отдельная повторная проверка соответствия клиентского `usePermissions` актуальным RLS/RPC после всех P1/P2 миграций; старое утверждение о конкретном расхождении прав удаления не считается подтверждённым без нового DB-теста.
10. DB integration/RLS suite для P1 существует. Для будущих P3-сущностей всё ещё нужны migration, concurrency, audit immutability и сквозные E2E-тесты.

## 2. Важное продуктовое ограничение

До появления двойной записи и закрытия периода отчёты следует называть:

- **управленческий P&L**;
- **управленческий cash-flow statement (прямой метод)**.

Нельзя называть их официальной бухгалтерской отчётностью. Для P&L нужно заранее выбрать метод признания:

- cash basis — по дате фактической оплаты;
- accrual basis — доход по дате реализации/оказания услуги, расход по дате документа.

Рекомендуемый MVP P3: поддержать оба представления, но явно маркировать метод. Accrual P&L строить по утверждённым invoices/bills, cash basis — по проведённым операциям.

## 3. Целевая архитектура

Порядок зависимостей:

```text
permissions + audit
        ↓
counterparties + projects + cost centers
        ↓
invoices/bills + lines + payment allocation
        ↓
expense approvals
        ↓
P&L + cash-flow statement
```

Audit trail должен появиться первым, чтобы история новых сущностей не потерялась с первого дня. Отчёты идут последними, потому что их качество зависит от контрагентов, документов, статусов и аналитических измерений.

### Принципы реализации

- Финансовые переходы и проверки выполняются RPC-функциями в одной транзакции.
- UI не записывает финансовые статусы напрямую.
- RLS остаётся последним рубежом доступа; фронтенд только отражает права.
- Суммы хранятся в валюте документа и базовой валюте вместе с зафиксированным курсом.
- Все бизнес-таблицы содержат `workspace_id`, `created_by`, `created_at`, `updated_at`.
- Архивирование применяется к справочникам. Выданные/оплаченные документы не удаляются, а аннулируются.
- Отчёты считаются серверными SQL views/RPC, не браузерной агрегацией массивов.
- Новые функции видны только для `workspace_type = 'business'` и включаются feature flag по workspace.

## 4. Модель данных

### 4.1 Клиенты и поставщики

`counterparties`:

- `id`, `workspace_id`;
- `kind`: `customer`, `supplier`, `both`;
- `display_name`, `legal_name`;
- `tax_id`/БИН/ИИН, регистрационный номер;
- email, телефон, адрес и контактное лицо;
- валюта и стандартный срок оплаты;
- банковские реквизиты в отдельной защищённой структуре;
- `is_archived`, `created_by`, timestamps.

Ограничения: уникальность нормализованного имени и tax ID внутри workspace; запрет физического удаления используемого контрагента.

### 4.2 Проекты и центры затрат

`projects`:

- код, название, клиент, владелец;
- даты, статус `planned/active/on_hold/completed/archived`;
- бюджет доходов/расходов и валюта.

`cost_centers`:

- код, название, `parent_id` для иерархии;
- ответственный пользователь;
- статус активности.

`operation_allocations`:

- ссылка на операцию;
- project и cost center;
- сумма и base amount;
- необязательная категория;
- сумма allocations обязана совпадать с суммой операции.

Allocation лучше отдельной таблицей, а не двумя колонками в `operations`: это позволит разбить один платёж между проектами и центрами затрат.

### 4.3 Счета клиентам и счета поставщиков

Использовать одну таблицу `financial_documents` с направлением:

- `receivable` — счёт клиенту;
- `payable` — счёт поставщика.

Основные поля:

- внутренний номер и номер поставщика;
- контрагент, issue/due/service dates;
- валюта, exchange rate, subtotal, tax, total, base total;
- `lifecycle_status`: `draft`, `issued`, `approved`, `void`;
- memo, project, attachment metadata;
- timestamps и авторы.

`financial_document_lines`:

- описание, quantity, unit price, tax rate;
- category, project, cost center;
- line total и base total.

`payment_allocations`:

- документ + фактическая операция;
- allocated amount в валюте документа и операции;
- зафиксированный курс;
- дата и автор allocation.

`payment_status` не редактируется вручную. Он вычисляется из суммы allocations:

- `unpaid`;
- `partially_paid`;
- `paid`;
- `overdue` — производный признак для открытого документа после due date;
- `overpaid` — только если продукт сознательно разрешит переплату/аванс.

Обязательные инварианты: allocation не превышает доступный остаток платежа и документа; документ и операция принадлежат одному workspace; direction платежа соответствует документу; валюта и курс фиксируются; конкурентное распределение защищено row lock.

### 4.4 Согласование расходов

`approval_policies`:

- область действия: workspace/category/project/cost center;
- пороги суммы и валюта;
- последовательные уровни;
- пользователи или роли согласующих;
- признак запрета self-approval.

`expense_requests`:

- requester, сумма, валюта, дата, поставщик;
- category/project/cost center;
- документ/вложение и комментарий;
- `draft`, `submitted`, `in_review`, `approved`, `rejected`, `cancelled`, `paid`.

`approval_steps` и `approval_actions` хранят снимок маршрута и каждое решение. После submit критические поля заявки блокируются. Изменение суммы возвращает заявку в draft или создаёт новую revision.

Утверждение заявки разрешает создание payable/планового платежа, но не считается фактической оплатой. Оплата появляется только после связи с `operations`.

### 4.5 Полный audit trail

`audit_events` как append-only таблица:

- `workspace_id`, timestamp, actor user/service;
- request/correlation ID, source (`web`, `api`, `telegram`, `cron`, `migration`);
- entity type/id и действие;
- before/after JSON или field-level diff;
- reason/comment;
- transaction ID;
- optional IP/user-agent для запросов через Edge Function;
- `previous_hash` и `event_hash` для обнаружения вмешательства.

Триггеры БД фиксируют INSERT/UPDATE/DELETE для операций, документов, allocations, контрагентов, проектов, cost centers, approval policy/request/action, ролей и настроек workspace. Отдельные события фиксируют вход, экспорт, выпуск/аннулирование документа и отчётный запуск.

У authenticated и service API не должно быть UPDATE/DELETE прав на audit events. Запись выполняет только security-definer функция/триггер. Для реальной защиты от владельца БД нужен внешний WORM-экспорт или регулярная выгрузка подписанных хэшей в отдельное хранилище.

## 5. Этапы реализации

Предусловие: P1/P2 readiness gate имеет статус `15/15 DONE`. Все оценки ниже начинаются после прохождения этого gate.

### Этап 0. Product/architecture decisions — 1 неделя

- Утвердить cash/accrual semantics и терминологию отчётов.
- Утвердить invoice numbering, timezone, базовую валюту и FX policy.
- Согласовать матрицу capabilities: manage counterparties, issue invoice, submit expense, approve expense, pay bill, view reports, view audit, export audit.
- Определить обязательные реквизиты Казахстана и необходимость НДС в P3.
- Зафиксировать UX-сценарии и feature flags.

Готово, когда решения оформлены ADR и нет неоднозначности между «денежным счётом» и «счётом на оплату».

### Этап 1. Permissions и audit foundation — 2 недели

- Перейти от разбросанных role checks к capability-функциям БД.
- Синхронизировать `usePermissions` с серверной матрицей.
- Создать append-only audit events, триггеры и просмотр журнала.
- Добавить correlation ID в Edge Functions/RPC.
- Покрыть RLS и неизменяемость integration tests.

Готово, когда каждое изменение пилотных сущностей видно в журнале, а пользователь не может изменить или удалить событие.

### Этап 2. Контрагенты, проекты, центры затрат — 2–3 недели

- Миграции, RLS, CRUD/RPC и архивирование.
- Страницы справочников, поиск, фильтры, merge дублей.
- Связь с операциями, долгами, планами и импортом.
- Allocation расходов/доходов между измерениями.
- API и CSV export/import.

Готово, когда операция может быть полностью или частично отнесена на контрагента, проект и cost center, а агрегаты allocations сходятся с операцией.

### Этап 3. Invoices/bills и платежные статусы — 3–4 недели

- Documents, lines, sequences, attachments и RLS.
- Draft → issue/approve → void через атомарные RPC.
- Payment allocation, partial payment, credit/advance policy.
- AR/AP списки и aging buckets: current, 1–30, 31–60, 61–90, 90+.
- Карточка документа, печатная/PDF-форма и напоминания.
- Связь с импортированными банковскими операциями.

Готово, когда частичные оплаты, просрочка, аннулирование и конкурентное распределение платежа проходят интеграционные тесты, а AR/AP сверяется до суммы документов.

### Этап 4. Expense approval — 2–3 недели

- Policies, snapshot steps, actions и state machine.
- Inbox «Требует моего решения» и история заявки.
- Делегирование/замещение как отдельный scope либо явное исключение из MVP.
- Уведомления submit/approve/reject/overdue.
- Создание payable/плана из утверждённой заявки.

Готово, когда requester не может обойти маршрут, self-approval блокируется политикой, а повторный/конкурентный approve идемпотентен.

### Этап 5. P&L и cash-flow statement — 2–3 недели

- Серверные reporting views/RPC и единые фильтры периода, проекта, cost center, контрагента.
- Management P&L: revenue, COGS, gross profit, operating expenses, operating profit, other income/expense, net profit.
- Cash-flow statement direct method: operating, investing, financing; opening cash, net change, FX effect, closing cash.
- Настройка mapping категорий в строки P&L и классы cash flow.
- Drill-down каждой строки до документа/операции.
- CSV/XLSX/PDF export и сохранённые параметры отчёта.

Готово, когда closing cash сходится с остатками денежных счетов, строки имеют drill-down, а тестовые fixtures подтверждают cash и accrual варианты.

### Этап 6. Hardening и rollout — 2 недели

- Backfill существующих операций и optional counterparty suggestions.
- Нагрузочные тесты отчётов и индексов.
- Security review всех SECURITY DEFINER функций и RLS.
- E2E happy paths и негативные сценарии.
- Пилот на нескольких business workspaces, telemetry и rollback plan.
- Обновление README, API и пользовательской справки.

## 6. Тестовая стратегия

Минимальный обязательный набор:

- unit tests расчётов налогов, totals, aging и отчётов;
- migration tests на чистой и существующей базе;
- pgTAP/SQL integration tests для constraints, RPC и RLS по каждой роли;
- concurrency tests для payment allocation и approval transitions;
- E2E: customer → invoice → partial payments → paid;
- E2E: supplier → expense request → approval → bill → payment;
- reconciliation fixtures для P&L и cash-flow;
- audit tests: полнота, порядок, hash chain, запрет update/delete;
- API contract tests и backward compatibility текущих endpoints.

Quality gate для каждого этапа: `lint + unit + DB integration + build`; для этапов 3–6 дополнительно E2E.

## 7. Оценка сроков

При команде 1 backend/Supabase + 1 frontend + part-time QA/аналитик: **14–18 календарных недель** с частичным параллелизмом.

Для одного full-stack разработчика: ориентир **22–28 недель**.

Оценка не включает полноценную двойную запись, НДС/налоговый учёт, электронные счета-фактуры, банковскую сверку, balance sheet и закрытие периода.

Также оценка **не включает завершение P1/P2**. До декомпозиции оставшихся функций и согласования push/offline scope нельзя честно объединять remediation P1/P2 и P3 в одну календарную оценку. Scope чеков P1 уже зафиксирован отдельным ADR: локальное распознавание без загрузки и хранения оригиналов.

## 8. Приоритет релиза

Рекомендуемый разрез поставки:

1. **P3A:** audit foundation + counterparties + projects/cost centers.
2. **P3B:** invoices/bills + AR/AP + partial payments.
3. **P3C:** expense approvals.
4. **P3D:** management P&L + cash-flow statement + hardening.

Не следует начинать P&L до появления стабильной классификации операций и документов: иначе отчёт будет визуально убедительным, но финансово несверяемым.
