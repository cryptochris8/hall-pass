// Playwright e2e: real Chrome + software WebGL against the PRODUCTION build (vite preview).
//   npx playwright test                 (builds, serves on :4351, runs the projects)
//   npx playwright test --project=desktop e2e/championship.spec.ts
// Port 4351 by default (HP_E2E_PORT overrides) — deliberately not vite's 4173, which is often another
// project's `vite preview` on this machine (reuseExistingServer would then test the wrong site).
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/** Real Chrome when installed; otherwise a bundled Chromium (cloud containers) or HP_CHROMIUM. */
const CHROMIUM = process.env.HP_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');

const PORT = Number(process.env.HP_E2E_PORT ?? 4351);

/** Real Chrome with software WebGL (no GPU needed). */
const GL_ARGS = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const PHONE = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: 'e2e',
  // Software GL on a busy machine renders ~10–20 fps: be generous.
  timeout: 300_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  // One worker: two software-GL Chromes in parallel starve each other on a busy laptop and time out.
  // (Pass --workers=2 on a quiet/fast machine to halve the run time.)
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...(CHROMIUM ? {} : { channel: 'chrome' }),
    launchOptions: { ...(CHROMIUM ? { executablePath: CHROMIUM } : {}), args: [...GL_ARGS, '--autoplay-policy=no-user-gesture-required'] },
    // Traces are opt-in (`npx playwright test --trace on`): recording DOM snapshots + a screencast of a
    // software-rendered WebGL page slows every action enough to push tests past their timeouts on a
    // busy machine.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 } },
      testIgnore: /mobile[-\w]*\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: PHONE,
      testMatch: /(mobile[-\w]*|boot)\.spec\.ts/,
    },
  ],
});
