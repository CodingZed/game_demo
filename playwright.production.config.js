import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Run after `npm run build`. Each test serves an isolated copy of dist; neither
// the development server nor the released build is modified during the suite.
export default defineConfig({
  testDir: './e2e/production',
  testMatch: 'offline.spec.js',
  timeout: 180000,
  expect: { timeout: 20000 },
  workers: 1,
  fullyParallel: false,
  use: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'allow',
    launchOptions: {
      executablePath: existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined,
      args: ['--enable-unsafe-swiftshader'],
    },
    trace: 'retain-on-failure',
  },
});
