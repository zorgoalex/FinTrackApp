# Stage 3.1 — privacy and data lifecycle

Status: implemented locally; production migration and deploy are not part of this commit until separately authorized.

## Data map

| Store or transfer | Data | Purpose | Retention / deletion |
| --- | --- | --- | --- |
| Supabase Auth and public financial tables | email, profile, workspaces, accounts, operations and settings | authentication and core product | while the account or workspace exists; cascaded/self-service deletion applies |
| `private.security_events` | actor/target UUID, event type, bounded redacted metadata | investigation and abuse monitoring | 90 days |
| `ai_assistant_logs` | SHA-256 question fingerprint, model, status and token counts | reliability and quota diagnosis | 30 days; plaintext is rejected |
| invitations | recipient email, role and delivery status | workspace invitation flow | pending lifetime plus 30 days; completed invitations 30 days |
| one-time proofs, link tokens and rate buckets | opaque token hashes or bounded subjects | password, Telegram and abuse protection | removed after expiry; Telegram tokens get a one-day cleanup margin |
| Web Push subscriptions | provider endpoint, public key material and user agent | opted-in notification delivery | until unsubscribe, account/workspace deletion or provider reports 404/410 |
| browser storage | current email/user UUID and workspace preference UUIDs | session UI convenience | account/workspace identifiers removed on logout, idle logout and user switch; generic theme/view preferences remain |
| encrypted Cloudflare R2 backups | full PostgreSQL backup, age encrypted | disaster recovery | daily copies 14 days; monthly copies 100 days |
| Vercel / Supabase / Resend / Turnstile | request and delivery metadata | hosting, backend, email and form protection | provider-controlled technical logs |
| OpenRouter / Groq / Telegram / self-hosted GLM-OCR | only the payload needed for the user-invoked feature | optional AI, speech, bot and OCR features | FinTrackApp does not persist source audio/images/raw OCR; provider policy may additionally apply |

## Controls added

- Legacy AI questions are replaced by one-way SHA-256 fingerprints. Authenticated browser clients lose direct INSERT access; only the Edge Function service role writes the bounded record.
- A daily database cleanup deletes expired invitations, AI logs, one-time proofs, Telegram tokens/update receipts, rate buckets and idempotency receipts. The migration also runs the cleanup once immediately.
- Deleting an Auth user synchronously removes invitations addressed to that email and directly correlatable rate-limit subjects.
- Logout and account switching clear local account/workspace identifiers and workspace-keyed dashboard/account preferences.
- The public privacy page now states concrete retention periods, backup residue, shared-workspace behavior and external processors.

## Deliberate residuals

- A deleted row can remain inside an encrypted disaster-recovery backup until that whole backup expires (14/100 days). Selective deletion inside an encrypted PostgreSQL dump is not operationally safe.
- Security events retain pseudonymous UUIDs for up to 90 days without email, secrets, tokens or financial payloads. This supports incident investigation.
- HMAC-obscured rate-limit subjects cannot be linked back during account deletion; their maximum database lifetime is bounded by their short expiry and the daily cleanup.
- Infrastructure providers may keep their own security/transport logs under their published policies. FinTrackApp cannot erase those directly.

## Release and verification

Required release actions after approval:

1. Apply `20260823020000_privacy_lifecycle_hardening.sql` to production.
2. Redeploy `ai-assistant`.
3. Deploy the Vercel production build.
4. Run `npm run verify:release` and a non-load production smoke check of function privileges, retention job presence and the public privacy page.
