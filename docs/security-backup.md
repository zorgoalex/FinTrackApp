# Бесплатный production backup

Workflow `.github/workflows/encrypted-backup.yml` ежедневно создаёт logical PostgreSQL dump, проверяет его через `pg_restore --list`, шифрует `age` и только затем загружает ciphertext в приватный Cloudflare R2 Standard bucket.

Для совместимости с production PostgreSQL 17 dump и его структурная проверка выполняются официальным `postgres:17.6-bookworm` client-контейнером на одноразовом GitHub runner.
AWS CLI для R2 устанавливается в одноразовое Python virtual environment runner, поскольку пакет `awscli` отсутствует в стандартном APT-репозитории актуального Ubuntu GitHub runner.
PostgreSQL client-контейнер запускается от UID/GID runner, чтобы plaintext dump оставался доступен для обязательного `shred` сразу после шифрования.

## GitHub Actions secrets

- `SUPABASE_DB_URL` — production connection string с обязательным SSL;
- `BACKUP_AGE_RECIPIENT` — только публичный `age1...` recipient;
- `R2_ENDPOINT_URL`, `R2_BUCKET`;
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — token только с Object Read/Write для одного backup bucket;
- `SUPABASE_NETWORK_GATE_TOKEN` — отдельная случайная строка для вызова только двух операций Cloudflare Worker;
- для алертов: `RESEND_API_KEY`, `BACKUP_ALERT_TO`, `NOTIFICATION_FROM_EMAIL`.

Repository variables:

- `SUPABASE_NETWORK_GATE_URL` — HTTPS origin выделенного Cloudflare Worker без завершающего пути;
- `SUPABASE_DB_NETWORK_RESTRICTIONS_ENABLED` — ровно `true` только после успешного dry run и закрытия публичных CIDR.

Приватный `AGE-SECRET-KEY-...` нельзя помещать в GitHub, Supabase, Vercel или приложение. Владелец хранит две offline-копии. Без него backup необратимо нерасшифровываем.

## Временное сетевое окно PostgreSQL

При включённом `SUPABASE_DB_NETWORK_RESTRICTIONS_ENABLED` workflow обращается к выделенному Cloudflare Worker по IPv4. Worker берёт IP из доверенного Cloudflare `CF-Connecting-IP`, заменяет прежний allowlist единственным текущим `/32`, а после dump применяет deny-all policy с пустыми IPv4/IPv6 allowlist. GitHub не может передать произвольный CIDR и не получает Supabase Management API token. Шифрование и R2 upload выполняются уже после закрытия PostgreSQL.

Шаг закрытия использует `if: always()` и поэтому запускается также после ошибки dump. Следующий backup сначала повторно применяет deny-all policy, удаляя CIDR, который мог остаться после принудительного завершения предыдущего runner. HTTPS API Supabase и `supabase-js` этим ограничением не блокируются.

Если шаг `Close the database network window` завершился с ошибкой, это security incident: открыть Actions run, вручную выбрать в Supabase Database Settings → Network Restrictions действие `Restrict all access`, затем проверить отсутствие разрешённых CIDR. Не перезапускать backup до подтверждения закрытого состояния.

### Cloudflare Worker configuration

Исходник находится в `cloudflare/supabase-network-gate`. В Worker secrets сохраняются `SUPABASE_MANAGEMENT_TOKEN` и `NETWORK_GATE_TOKEN`; обычный Supabase PAT никогда не добавляется в GitHub. Worker variable `SUPABASE_PROJECT_REF` содержит production project ref. `NETWORK_GATE_TOKEN` генерируется отдельно и сохраняется вторым экземпляром в GitHub secret `SUPABASE_NETWORK_GATE_TOKEN`.

Supabase PAT остаётся высокопривилегированным credential и поэтому изолируется в Worker secret, который нельзя прочитать обратно через dashboard. Worker предоставляет только `POST /v1/open` и `POST /v1/close`, проверяет bearer token, не принимает CIDR в request body и подтверждает фактически применённую политику через Management API.

Retention: 14 дней для daily и около 3 месяцев для monthly. Workflow останавливается до upload, если прогнозируемый объём превышает 8 GiB. Это сохраняет запас относительно R2 Standard free tier 10 GB-month, но владелец всё равно должен оставить bucket приватным и контролировать Cloudflare usage.
Пустой bucket учитывается как `0` байт, поэтому первый backup проходит тот же size gate без специальной ручной подготовки.

## Restore drill

Проверенный drill 2026-08-09 использовал ciphertext из `daily/` и официальный image `supabase/postgres:17.6.1.141`, совпадающий с production. `age` передал расшифрованный поток напрямую в `pg_restore`; plaintext-файл на диск не записывался. Чистая целевая БД была создана из `template0` внутри одноразового container с сохранением глобальных Supabase roles и extension packages. Результат: 37 public-таблиц, 11 non-system схем, 98 RLS policies и 78 public functions; container после проверки удалён.

1. Скачать один `.dump.age` из R2.
2. На доверенном компьютере выполнить `age --decrypt --identity <offline-key> --output restore.dump <backup.dump.age>`.
3. Восстановить в отдельный staging-проект: `pg_restore --clean --if-exists --no-owner --no-acl --dbname "$STAGING_DB_URL" restore.dump`.
4. Запустить SQL smoke/pgTAP и проверить Owner/Member/RLS потоки.
5. Физически удалить расшифрованный dump с доверенного компьютера.

Это не PITR: целевой RPO beta — до 24 часов, RTO — до 4 часов.
