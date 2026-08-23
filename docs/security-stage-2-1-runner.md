# Этап 2.1 — автономный defensive runner RLS/IDOR/BOLA

Runner предназначен только для контролируемой проверки FinTrackApp. Он не является нагрузочным сканером и не перебирает произвольные URL, идентификаторы или payload.

## Автономный локальный запуск

```powershell
npm run security:test:stage-2-1
```

Команда:

1. Проверяет локальный Supabase и при необходимости запускает его.
2. Применяет только недостающие локальные миграции без `db reset`.
3. Выполняет 23 транзакционных SQL-проверки и всегда завершает fixture через `ROLLBACK`.
4. Создаёт локальные синтетические Owner, Member, Viewer и Outsider.
5. Проверяет PostgREST RLS, IDOR-фильтры, прямые записи, self-promotion, `SECURITY DEFINER` RPC и Edge `api`.
6. Удаляет локальные HTTP-fixture и отдельно подтверждает отсутствие synthetic users и принадлежащих им рабочих пространств.
7. Сохраняет обезличенный отчёт в `artifacts/security-stage-2-1/<timestamp>/report.json`.

В отчёт не попадают email, UUID fixture, JWT, anon key, service-role key или database URL. HTTP-потолок — 48 последовательных запросов. Параллельные и нагрузочные запросы отсутствуют.

## Production SQL rollback-проверка

Файл `scripts/security-stage-2-1-rls.sql` можно вручную выполнить целиком в production Supabase SQL Editor. Он использует только синтетические идентификаторы внутри одной транзакции и заканчивается `ROLLBACK`.

Успех определяется только при наличии плана `1..23`, всех строк `ok` и отсутствии `not ok`/`# Failed test`. Сам по себе успешный HTTP-статус SQL Editor не считается доказательством.

## Production HTTP read-only режим

Прямой HTTP CLI заблокирован, пока одновременно не выполнены все условия:

- origin строго `https://trpfmcggvixnfmcgvxsq.supabase.co`;
- `STAGE21_PRODUCTION_CONFIRM=trpfmcggvixnfmcgvxsq:Security E2E:READ_ONLY`;
- label строго `Security E2E`;
- заданы разные target и owner-only workspace UUID;
- заданы UUID известной синтетической операции в каждом workspace;
- предоставлены три разные короткоживущие сессии Owner, Member и Outsider.

Production-режим выполняет только чтение и отрицательные auth-проверки. Он не создаёт и не удаляет данные. Токены задаются только в локальном окружении и никогда не должны отправляться в чат или сохраняться в репозитории.

```powershell
npm run security:test:stage-2-1:http -- --target production
```

Если любой guard не совпал, runner завершается до первого сетевого запроса.

## Покрытие и границы

Проверяются:

- видимость workspace и financial objects для Owner/Member/Viewer/Outsider;
- невозможность чтения известного owner-only объекта через подмену ID;
- невозможность записи Viewer/Outsider и Member в чужой workspace;
- невозможность self-promotion Member → Owner;
- защита `SECURITY DEFINER` RPC от чужого workspace;
- отсутствие доступа `authenticated` к схеме `private`;
- отсутствие `5xx` на отрицательных Edge BOLA-проверках;
- совпадение quota-counter с физическими строками после отклонённых записей.

Runner не заменяет ручной анализ бизнес-логики и не выполняет fuzzing, DoS, password spraying, массовый перебор UUID или эксплуатацию сторонней инфраструктуры.
