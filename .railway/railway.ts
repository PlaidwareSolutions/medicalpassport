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
 * - No Telnyx/VAPID/R2 secrets committed here: generated fresh for this
 *   environment and set via `railway variable set --stdin` directly on
 *   each service, never written to source (docs/28: secrets only in
 *   Railway variables) — declared as `preserve()` below so `config apply`
 *   doesn't delete them.
 * - Domain: medidocs.app (OD-1, purchased via Cloudflare) — DNS, TLS/HSTS,
 *   a WAF rate-limit rule, and cache rules are live in Cloudflare (not
 *   tracked in this file; configured directly via the Cloudflare API).
 *   `staging-*.medidocs.app` subdomains are used here, reserving the bare
 *   hostnames (docs/26's `app.`/`api.`/`admin.` pattern) for real
 *   production later. Custom domains themselves aren't declarable in this
 *   file at all (Railway rejects it — add via `railway domain`, this file
 *   only manages what's added after).
 * - R2 (docs/26 §13): real, live — see r2Env below.
 */
export default defineRailway(() => {
  // All real work lives on "foundation" — main is still the original scaffold commit.
  const repo = github("PlaidwareSolutions/medicalpassport", { branch: "foundation", checkSuites: false });
  const region = "asia-southeast1-eqsg3a"; // Singapore (docs/25 §Region, OD-5 assumption)

  const db = postgres("postgres", { region });

  // Real R2 (docs/26 §13, Stage 11 follow-up) — 5 buckets provisioned
  // (medpass-dev-{patient-docs,derived,ocr-tmp,backups,public-assets}) in
  // the same shared Cloudflare account as the zone, hence the project-
  // specific prefix rather than docs/26's plain "dev-" (this account hosts
  // several unrelated projects' buckets too). R2_ACCESS_KEY_ID/
  // R2_SECRET_ACCESS_KEY are derived from a Cloudflare API token scoped to
  // *only* Workers R2 Storage — deliberately not the broader DNS/WAF/Zone
  // Settings token used to provision the zone itself, since this credential
  // lives in the running app (least privilege).
  const r2Env = {
    R2_ACCOUNT_ID: "db356ac44b40bc2b194b6838d03eb84b",
    R2_BUCKET_PREFIX: "medpass-dev-",
    R2_ACCESS_KEY_ID: preserve(),
    R2_SECRET_ACCESS_KEY: preserve(),
  };

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
      ...r2Env,
      // Telnyx (docs/16, OD-10) — wired in for the voice-OTP supplementary
      // channel (Stage 4 follow-up). OTP_TRANSPORT stays "log" by default
      // (see above); flip it to "voice" only for a deliberate live test,
      // never left on as this environment's default without a decision to
      // do so. TELNYX_API_KEY/TELNYX_PUBLIC_KEY are secrets (preserve()'d);
      // the number and connection ID aren't.
      TELNYX_API_KEY: preserve(),
      TELNYX_PUBLIC_KEY: preserve(),
      TELNYX_FROM_NUMBER: "+18443496782",
      TELNYX_VOICE_CONNECTION_ID: "3009076702736287119",
    },
  });

  const worker = service("worker", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/worker/Dockerfile" },
    replicas: { [region]: 1 },
    env: {
      NODE_ENV: "staging",
      DATABASE_URL: db.env.DATABASE_URL,
      ...r2Env,
    },
  });

  const patientWeb = service("patient-web", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/patient-web/Dockerfile" },
    healthcheck: "/",
    replicas: { [region]: 1 },
    env: {
      NODE_ENV: "production",
      // The app hardcodes `next start -p 3000` and never reads process.env.PORT
      // itself — this is purely for Railway's own healthcheck/port-routing
      // prober, which otherwise mis-detects the port (diagnosed by deploys
      // failing at the healthcheck stage until this was set).
      PORT: "3000",
      // Build-time (Next.js inlines NEXT_PUBLIC_* at build) — managed
      // out-of-band, currently https://staging-api.medidocs.app now that
      // Cloudflare DNS for it is live and verified (was the temporary
      // *.up.railway.app domain before that).
      NEXT_PUBLIC_API_URL: preserve(),
    },
  });

  const adminWeb = service("admin-web", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/admin-web/Dockerfile" },
    healthcheck: "/",
    replicas: { [region]: 1 },
    // See patient-web's PORT comment — same reason, different hardcoded port.
    env: { NODE_ENV: "production", PORT: "3001" },
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
  // Needs R2 access — deletes stale objects via the same ObjectStorage interface.
  const cleanupAbandonedUploads = cronJob("cron-cleanup-abandoned-uploads", "0 * * * *", "cleanup-abandoned-uploads", r2Env);
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
