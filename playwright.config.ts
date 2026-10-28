import { defineConfig, devices } from '@playwright/test';

// E2E runs the production build behind a GitHub-Pages-like static server.
// Supabase calls are intercepted in the tests (no real backend needed).
const PORT = 4321;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', channel: process.env.PW_CHANNEL ?? 'chrome' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node scripts/pages-server.mjs`,
    env: { PORT: String(PORT), BASE_PATH: '/pub-crawl/' },
    url: `http://127.0.0.1:${PORT}/pub-crawl/`,
    reuseExistingServer: false,
  },
});
