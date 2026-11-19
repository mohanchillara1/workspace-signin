import { defineConfig } from '@playwright/test';

const chrome = process.env.CHROME ?? '/usr/bin/google-chrome';

// One worker, files in name order: the tests share one database and some
// depend on what earlier ones left behind (an empty pool, for one).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    viewport: { width: 1024, height: 1366 },
    launchOptions: { executablePath: chrome },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'main', testIgnore: /camera\.spec\.ts/ },
    {
      name: 'camera',
      testMatch: /camera\.spec\.ts/,
      use: {
        launchOptions: {
          executablePath: chrome,
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${process.cwd()}/.e2e/camera.y4m`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npx tsx scripts/e2e-server.ts',
    url: 'http://127.0.0.1:4321/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
