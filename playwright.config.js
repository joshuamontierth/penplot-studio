// Playwright E2E config. Runs against the Node dev server (scripts/serve.mjs) on its own port so a
// `npm run dev` session on 8791 is never reused. Browser: Playwright's Chromium by default
// (`npx playwright install chromium`); set PW_CHANNEL=chrome or msedge to use an installed browser.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PW_PORT) || 8792;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `node scripts/serve.mjs --no-open --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !CI,
    timeout: 20_000,
  },
});
