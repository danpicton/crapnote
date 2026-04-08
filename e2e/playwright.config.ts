import { defineConfig } from '@playwright/test';
import { startServer, stopServer } from './global-setup';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // Allow overriding the browser path for environments where Playwright's
        // own browser download is unavailable (e.g. the local dev container).
        // In CI, npx playwright install provides the correct binary automatically.
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          }),
        },
      },
    },
  ],
});
