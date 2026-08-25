import { defineConfig, devices } from '@playwright/test';

function localUrl(name, fallback) {
  const value = process.env[name] || fallback;
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`${name} must be a loopback http URL`);
  }
  return url.origin;
}

const appUrl = localUrl('E2E_APP_URL', 'http://127.0.0.1:4173');

export default defineConfig({
  testDir: './e2e/security',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'artifacts/playwright-security/test-results',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'artifacts/playwright-security/report', open: 'never' }],
  ],
  use: {
    baseURL: appUrl,
    headless: true,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium-security', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 4173 --strictPort',
    url: `${appUrl}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: process.env.E2E_ANON_KEY || 'local-list-only',
      VITE_TURNSTILE_SITE_KEY: '',
      VITE_EXTERNAL_STT_ENABLED: 'false',
      VITE_RECEIPT_OCR_URL: '',
      VITE_WEB_PUSH_PUBLIC_KEY: '',
      VITE_WORKOS_AUTH_ENABLED: 'false',
      VITE_WORKOS_CONNECTION_ID: '',
    },
  },
});
