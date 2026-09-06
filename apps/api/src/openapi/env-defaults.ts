/**
 * The API validates its environment at import time (`app.module.ts` reads
 * `env()` while building the provider list), so anything that boots the app
 * to *describe* it — the OpenAPI generator, its check script, the coverage
 * spec — needs a valid environment even though it never serves a request or
 * touches the database.
 *
 * These are the CI values from docs_v2/README.md and .github/workflows/ci.yml
 * — explicitly not secrets. Only variables that are unset are filled in, so
 * a developer's exported env (or CI's) always wins; `.env` is deliberately
 * NOT read, matching the e2e specs. The generated document never embeds any
 * of these values.
 */
export const CI_ENV_DEFAULTS: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgresql://medpass:medpass@localhost:5432/medpass",
  OTP_HASH_PEPPER: "ci-otp-pepper-not-secret",
  SESSION_TOKEN_PEPPER: "ci-session-pepper-not-secret",
  ADMIN_PASSWORD_PEPPER: "ci-admin-pepper-not-secret",
  FIELD_ENCRYPTION_KEY: "ci-field-key-not-secret-32bytes!",
  OTP_TRANSPORT: "log",
  OTP_DEV_FIXED_CODE: "000000",
};

export function applyCiEnvDefaults(target: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(CI_ENV_DEFAULTS)) {
    if (!target[key]) target[key] = value;
  }
}
