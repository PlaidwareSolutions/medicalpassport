import { defineConfig } from "@playwright/test";

/**
 * Clinic workflow e2e (docs_v2/06 P11-4 exit gate): the real Nest API and
 * the built provider portal, on ports of their own (:4102 / :3102) so a
 * developer's :4000/:3000 and the other apps' :3100/:3101/:4100/:4101 are
 * never touched. The API starts with the CI peppers; the spec seeds the
 * organization owner straight into the database with the same values
 * (there is no self-serve organization creation), so everything below must
 * agree between the API process and the spec process.
 */
const API_PORT = process.env.E2E_API_PORT ?? "4102";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "3102";
export const API_URL = process.env.E2E_API_URL ?? `http://localhost:${API_PORT}`;
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;

const apiEnv: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://medpass:medpass@localhost:5432/medpass",
  OTP_HASH_PEPPER: process.env.OTP_HASH_PEPPER ?? "ci-otp-pepper-not-secret",
  SESSION_TOKEN_PEPPER: process.env.SESSION_TOKEN_PEPPER ?? "ci-session-pepper-not-secret",
  ADMIN_PASSWORD_PEPPER: process.env.ADMIN_PASSWORD_PEPPER ?? "ci-admin-pepper-not-secret",
  FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY ?? "ci-field-key-not-secret-32bytes!",
  OTP_TRANSPORT: "log",
  OTP_DEV_FIXED_CODE: process.env.OTP_DEV_FIXED_CODE ?? "000000",
  CORS_ORIGINS: BASE_URL,
  PORT: API_PORT,
};
// The spec (seeding through Prisma) must hash and encrypt with the API's values.
// NODE_ENV is deliberately NOT set process-wide: the Next build below refuses
// a non-standard value, and the API must not run as "production" (its session
// cookie would be Secure-only and dropped over http://localhost).
for (const [key, value] of Object.entries(apiEnv)) process.env[key] = value;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: [
    {
      // --env-file-if-exists picks up apps/api/.env locally for anything not
      // set above; explicit values (PORT, peppers, CORS) always win.
      command: "node --env-file-if-exists=apps/api/.env apps/api/dist/main.js",
      cwd: "../..",
      url: `${API_URL}/healthz`,
      env: { ...apiEnv, NODE_ENV: "development" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Own build output (.next-e2e) with the API origin baked in, so a
      // developer's .next on :3002 is left alone.
      command: `pnpm exec next build && pnpm exec next start -p ${WEB_PORT}`,
      env: { NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_API_URL: API_URL, NODE_ENV: "production" },
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
