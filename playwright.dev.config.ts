import { defineConfig, devices } from '@playwright/test';

// Same E2E tests against the Vite *dev* server, which runs React StrictMode
// double-mounting — catches bugs (like a blank map) that only appear in dev.
// Loopback only.
process.env.E2E_BASE = '/';
const PORT = 5174;
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /map\.spec\.ts/,
  timeout: 45_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: process.env.PW_CHANNEL ?? 'chrome' },
  projects: [{ name: 'iphone-dev', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    env: { VITE_SUPABASE_URL: 'https://e2e.supabase.test', VITE_SUPABASE_ANON_KEY: 'e2e-public-key', VITE_BASE_PATH: '/', E2E_BASE: '/' },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
  },
});
