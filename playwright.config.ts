import { defineConfig, devices } from '@playwright/test';

const previewPort = Number(process.env.E2E_PREVIEW_PORT ?? 4173);
const previewHost = process.env.E2E_PREVIEW_HOST ?? '127.0.0.1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: {
    timeout: 45_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://${previewHost}:${previewPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader-webgl'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    url: `http://${previewHost}:${previewPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      VITE_E2E_TEST: '1',
      VITE_SPACETIME_URI: process.env.VITE_SPACETIME_URI ?? 'http://127.0.0.1:3000',
      VITE_SPACETIME_DB_NAME: process.env.VITE_SPACETIME_DB_NAME ?? 'city-builder',
    },
  },
});
