import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 1,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    // software WebGL so MapLibre renders in headless CI
    launchOptions: { args: ['--use-angle=swiftshader', '--in-process-gpu', '--disable-gpu-watchdog'] },
  },
});
