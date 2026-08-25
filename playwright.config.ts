import { defineConfig, devices } from '@playwright/test';

const previewPort = Number(process.env.E2E_PREVIEW_PORT ?? 4174);
const previewHost = process.env.E2E_PREVIEW_HOST ?? '127.0.0.1';
const reuseExistingServer = process.env.E2E_REUSE_SERVER === '1';

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
    // Keep capture opt-in so the smoke measures the game rather than GPU
    // readback; E2E_CAPTURE=1 restores failure artifacts.
    trace: process.env.E2E_CAPTURE === '1' ? 'retain-on-failure' : 'off',
    screenshot: process.env.E2E_CAPTURE === '1' ? 'only-on-failure' : 'off',
    video: process.env.E2E_CAPTURE === '1' ? 'retain-on-failure' : 'off',
    launchOptions: {
      args: ['--enable-unsafe-webgpu'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      `npm run build:e2e && npx vite preview --host ${previewHost} --port ${previewPort}`,
    url: `http://${previewHost}:${previewPort}`,
    reuseExistingServer,
    timeout: 180_000,
    env: {
      ...process.env,
      VITE_E2E_TEST: '1',
      VITE_SPACETIME_URI: process.env.VITE_SPACETIME_URI ?? 'http://127.0.0.1:3000',
      VITE_SPACETIME_DB_NAME: process.env.VITE_SPACETIME_DB_NAME ?? 'city-builder',
    },
  },
});
