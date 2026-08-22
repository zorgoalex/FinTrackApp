const apiKey = process.env.RESEND_API_KEY || '';
const to = process.env.BACKUP_ALERT_TO || '';
const from = process.env.NOTIFICATION_FROM_EMAIL || '';
const runUrl = process.env.GITHUB_RUN_URL || '';

if (!apiKey || !to || !from) {
  console.log('Security monitor alert skipped: optional Resend configuration is unavailable.');
  process.exit(0);
}

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from,
    to: [to],
    subject: 'FinTrackApp production security monitor failed',
    text: `A production security invariant failed. Inspect the GitHub Actions run immediately: ${runUrl}`,
  }),
});

if (!response.ok) throw new Error(`Security monitor alert delivery failed with status ${response.status}`);
console.log('Security monitor failure alert sent.');
