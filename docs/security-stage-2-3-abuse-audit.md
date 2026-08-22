# Этап 2.3 — защита от злоупотреблений и перегрузки

Дата локального аудита: 2026-08-22. Production не нагружался и не изменялся.

## Результат

Подтверждённые проблемы высокой и средней важности исправлены локально. Изменения готовы к отдельному production-релизу после явного разрешения владельца.

| Проблема | Риск | Исправление |
|---|---|---|
| API не имел общего rate limit, а export поддерживал неограниченную выдачу | перегрузка БД и памяти, массовая выгрузка | отдельные read/write/export buckets, export не более 5000 строк |
| JSON и multipart читались без прикладного лимита | расход памяти до входа в бизнес-валидацию | общий потоковый reader с ранним 413 для declared и streamed overflow |
| Внешние ответы и запросы не везде имели deadline/size cap | зависшие workers и oversized upstream response | явные timeout 8–15 секунд и лимиты ответов 32–512 KiB |
| Первый элемент `X-Forwarded-For` позволял менять IP bucket | обход IP rate limit и разрастание таблицы buckets | принимается только валидный адрес; используется proxy-nearest элемент цепочки |
| AI, STT и приглашения имели только локальные пользовательские квоты | множество аккаунтов могло исчерпать общую бесплатную квоту | добавлены атомарные beta-wide buckets |
| Обновление курсов вызывало service-role RPC пользовательским клиентом | rate limit не мог корректно исполниться | RPC переведён на service-role client после проверки пользователя и роли |
| Cron-функции можно было запускать параллельно и повторно | дубли, гонки и расход внешних квот | один запуск за 300 секунд, атомарный DB bucket |
| Notification dispatch не имел суточного бюджета | повторные cron-запуски могли исчерпать бесплатные квоты | per-run budget плюс суточные Telegram/Web Push/Resend buckets |
| Один пользователь мог зарегистрировать неограниченное число Web Push endpoint | контролируемый fan-out и расход worker time | максимум 5 устройств; advisory transaction lock закрывает concurrent race |
| Test Push загружал все подписки пользователя | лишний fan-out | максимум 5 подписок, timeout 10 секунд |

## Действующие beta-лимиты

| Канал/операция | Лимит |
|---|---:|
| API read | 240 запросов / пользователь / минута |
| API write | 60 запросов / пользователь / минута |
| API export | 10 запросов / пользователь / час; 5000 строк за запрос |
| AI assistant | 30 / пользователь / час; 300 / beta / час |
| STT | 10 / пользователь / час; 100 / beta / час; тело до configured file limit + 1 MiB multipart overhead |
| Invite | 10 / пользователь / сутки; 20 / workspace / сутки; 3 / адрес / сутки; 80 / beta / сутки |
| Все Edge-письма Resend | 50 / beta / сутки; остаток бесплатного плана резервируется для Supabase Auth |
| Currency refresh | 12 / workspace+user / час |
| Telegram link token | 5 / пользователь / час |
| Notification cron | 1 запуск / 5 минут; максимум 200 внешних доставок за запуск |
| Notification Telegram | 500 внешних попыток / beta / сутки |
| Notification Web Push | 1000 внешних попыток / beta / сутки |
| Web Push devices | 5 / пользователь / workspace |
| Security-event client endpoint | 30 / пользователь / час |

Все buckets хранят только UUID или HMAC/opaque subject, а не email, пароль или финансовые данные. Инкремент выполняется атомарно в PostgreSQL.

## Проверки

Выполнено локально:

- `deno check` изменённых Edge Functions; для npm Web Push использован `--node-modules-dir=auto`;
- ESLint без предупреждений;
- 121/121 Node-тест;
- production Vite build;
- полный reset чистой локальной Supabase БД со всеми миграциями;
- полный pgTAP-набор, включая успешную регистрацию пяти Web Push устройств и отказ шестому;
- `npm audit` production и полного dependency tree: 0 известных уязвимостей;
- `git diff --check`.

Production load/stress test намеренно не выполнялся.

## Остаточные риски

1. Fixed-window rate limit допускает ограниченный всплеск около границы окна — максимум примерно два настроенных лимита. Для beta это принято; sliding window потребует больше записей и вычислений.
2. Обычные API POST-запросы пока не поддерживают idempotency key. Повторный запрос может создать дубль в пределах write rate limit. Для финансовой точности нужен отдельный этап client request ID + atomic receipt table.
3. Прямые authenticated-записи через Supabase PostgREST защищены Auth/RLS, но не имеют продуктовых квот на число операций, счетов и справочников. Злоумышленник может заполнять только доступные ему пространства, однако способен расходовать общий бесплатный объём БД. До открытой публичной beta следует согласовать per-workspace row/storage quotas и политику архивации.
4. Реальное распределённое поведение нескольких production Edge regions не проверялось нагрузкой. Атомарный PostgreSQL RPC закрывает гонки логически, но latency и provider 429 нужно наблюдать по security log после выпуска.

## Production-релиз

После разрешения владельца:

1. Push проверенного коммита в `main`.
2. Применить `20260822020000_abuse_quota_hardening.sql`.
3. Redeploy Edge Functions: `api`, `ai-assistant`, `check-openrouter-balance`, `dispatch-notifications`, `fetch-rates`, `invite-user`, `login-user`, `password-auth`, `security-event`, `send-test-push`, `stt-transcribe`, `telegram-link`.
4. Выполнить только ненагрузочный smoke: авторизация, один refresh курсов, один test push, один AI/STT запрос только если beta flags включены, проверка 413 на oversized synthetic request.
5. Проверить security log и отсутствие 5xx/аномального роста `security_rate_limits`.
