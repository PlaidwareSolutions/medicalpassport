import { defineConfig } from "@playwright/test";

/**
 * Marketing recording framework (docs/landing-page/media-recording-framework.md)
 * — completely separate from playwright.config.ts so the normal E2E suite and
 * CI never record marketing videos. Records the REAL product (the same
 * locally-launched api + built patient-web the e2e suite uses) with synthetic
 * demo data only. Staging was deliberately ruled out: Turnstile correctly
 * blocks headless automation there, and a shared environment is not a
 * deterministic recording studio.
 *
 * Capture: browser viewport 390×844 (mobile emulation, touch), raw video
 * explicitly sized 390×844 WebM (Playwright native; Session 9 owns
 * transcode/crop/poster). One worker, zero retries — a recording either
 * reproduces deterministically or fails loudly.
 */
export default defineConfig({
  testDir: "./e2e-marketing",
  globalSetup: "./e2e-marketing/global-setup.ts",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "../../artifacts/marketing-media/test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    storageState: "e2e-marketing/.auth/storage-state.json",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
    video: { mode: "on", size: { width: 390, height: 844 } },
    trace: "off",
  },
  webServer: [
    {
      command: "node --env-file-if-exists=apps/api/.env apps/api/dist/main.js",
      cwd: "../..",
      url: "http://localhost:4000/healthz",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @medpass/patient-web start",
      cwd: "../..",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
