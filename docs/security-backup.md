# Бесплатный production backup

Workflow `.github/workflows/encrypted-backup.yml` ежедневно создаёт logical PostgreSQL dump, проверяет его через `pg_restore --list`, шифрует `age` и только затем загружает ciphertext в приватный Cloudflare R2 Standard bucket.

## GitHub Actions secrets

- `SUPABASE_DB_URL` — production connection string с обязательным SSL;
- `BACKUP_AGE_RECIPIENT` — только публичный `age1...` recipient;
- `R2_ENDPOINT_URL`, `R2_BUCKET`;
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — token только с Object Read/Write для одного backup bucket;
- для алертов: `RESEND_API_KEY`, `BACKUP_ALERT_TO`, `NOTIFICATION_FROM_EMAIL`.

Приватный `AGE-SECRET-KEY-...` нельзя помещать в GitHub, Supabase, Vercel или приложение. Владелец хранит две offline-копии. Без него backup необратимо нерасшифровываем.

Retention: 14 дней для daily и около 3 месяцев для monthly. Workflow останавливается до upload, если прогнозируемый объём превышает 8 GiB. Это сохраняет запас относительно R2 Standard free tier 10 GB-month, но владелец всё равно должен оставить bucket приватным и контролировать Cloudflare usage.

## Restore drill

1. Скачать один `.dump.age` из R2.
2. На доверенном компьютере выполнить `age --decrypt --identity <offline-key> --output restore.dump <backup.dump.age>`.
3. Восстановить в отдельный staging-проект: `pg_restore --clean --if-exists --no-owner --no-acl --dbname "$STAGING_DB_URL" restore.dump`.
4. Запустить SQL smoke/pgTAP и проверить Owner/Member/RLS потоки.
5. Физически удалить расшифрованный dump с доверенного компьютера.

Это не PITR: целевой RPO beta — до 24 часов, RTO — до 4 часов.
