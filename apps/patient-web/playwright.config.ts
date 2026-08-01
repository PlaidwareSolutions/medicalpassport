import { defineConfig } from "@playwright/test";

/**
 * Accessibility suite (docs/33 engineering-enforcement table): reflow at
 * 320px × 200% text zoom across every screen and locale, plus axe-core
 * checks. Runs against the real stack — the Nest API on :4000 (postgres,
 * OTP_TRANSPORT=log with the fixed dev code) and the built Next app on
 * :3000 — not mocks, matching the repo's live-verification standard.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  // The API's OTP endpoints are rate-limited per phone; the global setup
  // logs in once and workers share the storage state, so parallelism is
  // safe — but keep it modest so two dev servers aren't overwhelmed.
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    storageState: "e2e/.auth/storage-state.json",
  },
  webServer: [
    {
      // --env-file-if-exists: picks up apps/api/.env locally; in CI the
      // workflow env is already populated and no .env file exists.
      command: "node --env-file-if-exists=apps/api/.env apps/api/dist/main.js",
      cwd: "../..",
      url: "http://localhost:4000/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @medpass/patient-web start",
      cwd: "../..",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
