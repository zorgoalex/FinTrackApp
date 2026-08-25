# Playwright security acceptance for Stage 4.2

Этот набор подготавливает два локальных этапа эксплуатационной проверки закрытой beta:

1. **Последовательная смена аккаунтов (`@sequential`)** — Owner, Outsider, Member и Viewer по очереди используют один BrowserContext. Проверяются logout, очистка приватного browser state, отсутствие доступа к чужому workspace/canary, права Member и запрет записи Viewer.
2. **Одновременные сессии (`@concurrent`)** — четыре независимых BrowserContext входят параллельно. Owner и Member одновременно создают операции, Viewer и Outsider одновременно получают серверный отказ в записи, роли делают перекрёстные чтения чужих canary, затем активная Member-сессия понижается до Viewer и немедленно теряет запись.

## Safety envelope

- Раннер принимает только loopback `http://127.0.0.1`/`http://localhost`; удалённый Supabase и production отклоняются до старта.
- Используются только уникальные адреса `@example.invalid`, случайный пароль в памяти и синтетические суммы/описания.
- Service-role key локального Supabase остаётся только в процессе Node и не попадает в браузер, отчёт или консоль.
- Фикстура удаляет созданные workspaces, операции и Auth users и проверяет отсутствие остаточных workspace.
- Network trace и video отключены, чтобы JWT не попадали в артефакты. При падении сохраняется только screenshot с синтетическими маркерами; артефакты игнорируются Git.
- В каждом прогоне выполняется небольшое число записей. Это функциональная проверка изоляции, **не load/stress test** и не генерация 1000 UI-записей на пользователя. Массовый синтетический объём при необходимости должен быть отдельным локальным DB/API-тестом с установленным лимитом.

## Запуск

Однократно установить бесплатный Chromium Playwright:

    npx playwright install chromium

Проверить обнаружение сценариев без запуска инфраструктуры:

    npm run security:test:browser:list

Запустить этапы отдельно:

    npm run security:test:browser:sequential
    npm run security:test:browser:concurrent

Запустить оба этапа:

    npm run security:test:browser

Раннер самостоятельно поднимает локальный Supabase, если тот не работал, применяет локальные migrations и после прогона останавливает только запущенный им экземпляр. Артефакты падений находятся в `artifacts/playwright-security/`.

## Что считается готовностью

- Оба spec проходят в Chromium без retries.
- Запрещённые чтения возвращают `200` с пустым массивом, а запрещённые записи — контролируемый `4xx`.
- Owner/Member operations видны всем участникам shared workspace.
- Owner-private и Outsider-private canary не видны посторонним и остаются неизменными после всех проб.
- После logout в общем BrowserContext нет auth token, приватных `fintrack-*` localStorage/cache и `fintrack-offline` IndexedDB.
- Понижение Member до Viewer действует на уже открытую сессию: сервер запрещает новую запись, UI отключает кнопку расхода.
- Teardown подтверждает отсутствие синтетических workspaces и users.

Эти тесты дают воспроизводимое доказательство технической изоляции, но не заменяют наблюдение реальных beta-участников за usability, consent, support и эксплуатационными сигналами первой недели.
