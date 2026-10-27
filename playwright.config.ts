import { defineConfig } from '@playwright/test';

// Runs against dist/ (built with API_URL pointing at the local mock) and tests/servers.mjs.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1, // the mock API holds one shared in-memory sheet
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'node tests/servers.mjs',
    url: 'http://127.0.0.1:4173/check',
    reuseExistingServer: false,
    timeout: 20000,
  },
});
