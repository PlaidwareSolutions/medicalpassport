import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

/**
 * docs/25 Railway deployment architecture, first real bring-up. Deliberate
 * deviations from that doc, for this first pass only:
 *
 * - One combined dev/staging project (not the full dev/stg/prod split) —
 *   there are no real users yet, and running three paid environments before
 *   the deploy has even been proven once is premature.
 * - NODE_ENV="staging", not "production", on api/cron: the Dockerfiles bake
 *   `ENV NODE_ENV=production`, and the api refuses to boot with
 *   OTP_TRANSPORT=log under NODE_ENV=production (apps/api/src/common/env.ts)
 *   — real OTP delivery needs Telnyx, which this pass explicitly defers.
 *   "staging" is Railway's own runtime env var overriding the image default,
 *   and is a legitimate value for a non-production environment, not a hack.
 * - No Redis: the codebase has no Redis client anywhere — the queue and the
 *   rate limiter both already run on Postgres (documented substitutions,
 *   see apps/worker and apps/api/src/common/rate-limit.service.ts) — so
 *   provisioning an unused addon would be pure cost with no function.
 * - No Telnyx/VAPID secrets committed here: generated fresh for this
 *   environment and set via `railway variables` directly on each service,
 *   never written to source (docs/28: secrets only in Railway variables).
 * - Domain: medidocs.app (OD-1, purchased via Cloudflare). This environment
 *   uses `staging-*.medidocs.app` subdomains, reserving the bare hostnames
 *   (docs/26's `app.`/`api.`/`admin.` pattern) for real production later.
 *   These domains won't actually resolve until the matching CNAME records
 *   exist in Cloudflare (next phase, not yet wired) — declaring them here
 *   now just registers intent; `railway domain` generates a working
 *   `*.up.railway.app` fallback for this pass's verification in the
 *   meantime. The docs/25 non-negotiable ("users only ever reach services
 *   through Cloudflare-proxied hostnames, never *.railway.app directly") is
 *   a production rule — the temporary railway.app fallback is for our own
 *   verification, not end-user traffic.
 */
export default defineRailway(() => {
  // All real work lives on "foundation" — main is still the original scaffold commit.
  const repo = github("PlaidwareSolutions/medicalpassport", { branch: "foundation", checkSuites: false });
  const region = "asia-southeast1-eqsg3a"; // Singapore (docs/25 §Region, OD-5 assumption)

  const db = postgres("postgres", { region });

  const api = service("api", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/api/Dockerfile" },
    healthcheck: "/readyz",
    replicas: { [region]: 1 },
    deploy: { preDeployCommand: ["pnpm --filter @medpass/database exec prisma migrate deploy"] },
    env: {
      NODE_ENV: "staging",
      PORT: "4000",
      DATABASE_URL: db.env.DATABASE_URL,
      OTP_TRANSPORT: "log",
      OTP_DEV_FIXED_CODE: "000000",
      CORS_ORIGINS: "https://staging-app.medidocs.app,https://patient-web-production-6da0.up.railway.app",
      // Set out-of-band via `railway variable set --stdin` (docs/28: secrets
      // only in Railway variables) — preserve() tells apply not to touch them.
      OTP_HASH_PEPPER: preserve(),
      SESSION_TOKEN_PEPPER: preserve(),
      FIELD_ENCRYPTION_KEY: preserve(),
      VAPID_PUBLIC_KEY: preserve(),
      VAPID_PRIVATE_KEY: preserve(),
      VAPID_SUBJECT: preserve(),
    },
  });

  const worker = service("worker", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/worker/Dockerfile" },
    replicas: { [region]: 1 },
    env: {
      NODE_ENV: "staging",
      DATABASE_URL: db.env.DATABASE_URL,
    },
  });

  const patientWeb = service("patient-web", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/patient-web/Dockerfile" },
    healthcheck: "/",
    replicas: { [region]: 1 },
    env: {
      NODE_ENV: "production",
      // Build-time (Next.js inlines NEXT_PUBLIC_* at build) — managed
      // out-of-band for now since it flips between the temporary
      // *.up.railway.app verification domain and staging-api.medidocs.app
      // once Cloudflare DNS for the latter actually resolves.
      NEXT_PUBLIC_API_URL: preserve(),
    },
  });

  const adminWeb = service("admin-web", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/admin-web/Dockerfile" },
    healthcheck: "/",
    replicas: { [region]: 1 },
    env: { NODE_ENV: "production" },
  });

  // Cron jobs (docs/25 schedule table) — one service per job, all sharing
  // apps/cron/Dockerfile, distinguished only by `start`. FIELD_ENCRYPTION_KEY
  // must match api's value exactly; set via `railway variable set --stdin`.
  const cronEnv = { NODE_ENV: "staging", DATABASE_URL: db.env.DATABASE_URL, FIELD_ENCRYPTION_KEY: preserve() };
  const cronJob = (name: string, cronSchedule: string, jobFile: string, extraEnv: Record<string, unknown> = {}) =>
    service(name, {
      source: repo,
      build: { builder: "DOCKERFILE", dockerfilePath: "apps/cron/Dockerfile" },
      start: `node dist/jobs/${jobFile}.js`,
      replicas: { [region]: 1 },
      deploy: { cronSchedule, restartPolicyType: "NEVER" },
      env: { ...cronEnv, ...extraEnv },
    });

  const cleanupExpiredOtps = cronJob("cron-cleanup-expired-otps", "0 3 * * *", "cleanup-expired-otps");
  const cleanupExpiredSessions = cronJob("cron-cleanup-expired-sessions", "30 3 * * *", "cleanup-expired-sessions");
  const verifyAuditChain = cronJob("cron-verify-audit-chain", "0 2 * * *", "verify-audit-chain");
  const extendScheduledDoses = cronJob("cron-extend-scheduled-doses", "0 1 * * *", "extend-scheduled-doses");
  const reconcileMissedDoses = cronJob("cron-reconcile-missed-doses", "*/15 * * * *", "reconcile-missed-doses");
  const cleanupAbandonedUploads = cronJob("cron-cleanup-abandoned-uploads", "0 * * * *", "cleanup-abandoned-uploads");
  // Needs its own VAPID keypair (web push) matching api's — also preserve()'d.
  const detectDueReminders = cronJob("cron-detect-due-reminders", "* * * * *", "detect-due-reminders", {
    VAPID_PUBLIC_KEY: preserve(),
    VAPID_PRIVATE_KEY: preserve(),
    VAPID_SUBJECT: preserve(),
  });
  const generateRefillReminders = cronJob("cron-generate-refill-reminders", "0 6 * * *", "generate-refill-reminders");
  const cleanupRateLimitBuckets = cronJob("cron-cleanup-rate-limit-buckets", "0 4 * * *", "cleanup-rate-limit-buckets");

  return project("medpass-dev", {
    resources: [
      db,
      api,
      worker,
      patientWeb,
      adminWeb,
      cleanupExpiredOtps,
      cleanupExpiredSessions,
      verifyAuditChain,
      extendScheduledDoses,
      reconcileMissedDoses,
      cleanupAbandonedUploads,
      detectDueReminders,
      generateRefillReminders,
      cleanupRateLimitBuckets,
    ],
  });
});
