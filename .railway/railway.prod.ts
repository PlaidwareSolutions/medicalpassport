import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

/**
 * docs/25 Railway deployment architecture — real production bring-up
 * (Stage 11 follow-up). A genuinely separate Railway project from
 * `medpass-dev` (own Postgres, own services, own secrets), per docs/25 §
 * Environments: "separate members, tokens, variables, databases, buckets".
 *
 * Scope: this stands up production infrastructure for a controlled,
 * end-to-end PILOT — not a full public launch. Clinical validation,
 * security review, legal/DPDP review, and DPO designation remain open
 * (docs/29) and are not bypassed by this deploy.
 *
 * Deliberate decisions for this pass:
 * - NODE_ENV="production" everywhere (unlike medpass-dev's "staging"):
 *   apps/api/src/common/env.ts refuses to boot with OTP_TRANSPORT=log
 *   under NODE_ENV=production, which is exactly the guard rail wanted here.
 * - OTP_TRANSPORT="voice": real Telnyx SMS delivery to India remains
 *   platform-blocked (toll-free verification + destination whitelist + DLT
 *   registration, all still outstanding). Per the user's explicit decision,
 *   the already-built, live-verified Telnyx Call Control voice OTP channel
 *   is production's default for this pilot. Note honestly: voice OTP is
 *   NOT a confirmed regulatory bypass either — TRAI's TCCCPR framework
 *   covers automated voice/IVR, not just SMS — this is the pragmatic
 *   channel that actually works today, not a resolved compliance question.
 * - No Redis: same substitution as medpass-dev (Postgres-backed queue +
 *   rate limiter) — still no Redis client anywhere in the codebase.
 * - Domains: the bare `app.`/`api.`/`admin.medidocs.app` hostnames
 *   reserved during the medpass-dev bring-up specifically for this moment
 *   (docs/26 §12). DNS/TLS/WAF configured directly via the Cloudflare API,
 *   not tracked in this file (same pattern as medpass-dev).
 * - R2 (docs/26 §13): 5 new buckets (`medpass-prod-*`) genuinely separate
 *   from `medpass-dev-*` — real data isolation between environments.
 *   R2_ACCESS_KEY_ID/SECRET are, honestly, the SAME credential value as
 *   medpass-dev's: the Cloudflare API token available in this session can
 *   create buckets but lacks permission to mint a new scoped R2 API token
 *   (no dashboard access here to do it manually). Bucket-level isolation is
 *   real; credential-level isolation is not, for this pass — flagged in
 *   docs rather than glossed over.
 * - Telnyx (docs/16, OD-10): TELNYX_API_KEY/PUBLIC_KEY, the phone number,
 *   and the voice connection ID are the SAME vendor resource as
 *   medpass-dev — a single Telnyx account already shared across unrelated
 *   projects, not something meaningfully duplicated per environment.
 * - Turnstile (docs/26 §12.4): a FRESH widget, scoped only to
 *   `app.medidocs.app` — genuinely separate credential from staging's.
 * - FIELD_ENCRYPTION_KEY / OTP_HASH_PEPPER / SESSION_TOKEN_PEPPER /
 *   BACKUP_ENCRYPTION_KEY / VAPID keypair: all freshly generated for this
 *   environment, never shared with medpass-dev.
 */
export default defineRailway(() => {
  const repo = github("PlaidwareSolutions/medicalpassport", { branch: "foundation", checkSuites: false });
  const region = "asia-southeast1-eqsg3a"; // Singapore (docs/25 §Region, OD-5 assumption) — same as medpass-dev

  // The actual deployed instance lives in "sfo" — a pre-existing drift from
  // this file's declared region, discovered while deploying the admin
  // portal (via the real service manifest, not assumed). Declared to match
  // reality rather than moving a live production database, which
  // `railway config apply` correctly flags as destructive.
  const db = postgres("postgres", { region: "sfo" });

  // Real R2 (docs/26 §13) — 5 buckets provisioned
  // (medpass-prod-{patient-docs,derived,ocr-tmp,backups,public-assets}), a
  // genuinely separate bucket set from medpass-dev's. See header note on
  // why the access-key credential itself is currently shared with dev.
  const r2Env = {
    R2_ACCOUNT_ID: "db356ac44b40bc2b194b6838d03eb84b",
    R2_BUCKET_PREFIX: "medpass-prod-",
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
      NODE_ENV: "production",
      PORT: "4000",
      DATABASE_URL: db.env.DATABASE_URL,
      OTP_TRANSPORT: "voice",
      CORS_ORIGINS: "https://app.medidocs.app,https://admin.medidocs.app",
      // Set out-of-band via `railway variable set --stdin` (docs/28: secrets
      // only in Railway variables) — preserve() tells apply not to touch them.
      OTP_HASH_PEPPER: preserve(),
      SESSION_TOKEN_PEPPER: preserve(),
      // Admin auth (docs/18, admin-portal follow-up) — its own dedicated pepper.
      ADMIN_PASSWORD_PEPPER: preserve(),
      FIELD_ENCRYPTION_KEY: preserve(),
      VAPID_PUBLIC_KEY: preserve(),
      VAPID_PRIVATE_KEY: preserve(),
      VAPID_SUBJECT: preserve(),
      ...r2Env,
      // Telnyx (docs/16, OD-10) — voice OTP is this environment's OTP
      // transport (see header). Same vendor account/number/connection as
      // medpass-dev.
      TELNYX_API_KEY: preserve(),
      TELNYX_PUBLIC_KEY: preserve(),
      TELNYX_FROM_NUMBER: "+18443496782",
      TELNYX_VOICE_CONNECTION_ID: "3009076702736287119",
      // Turnstile (docs/26 §12.4) — fresh widget scoped to app.medidocs.app only.
      TURNSTILE_SECRET_KEY: preserve(),
    },
  });

  const worker = service("worker", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/worker/Dockerfile" },
    replicas: { [region]: 1 },
    env: {
      NODE_ENV: "production",
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
      // prober (see medpass-dev's identical comment).
      PORT: "3000",
      // Build-time (Next.js inlines NEXT_PUBLIC_* at build) — known upfront
      // this time since the production hostname is decided before first apply.
      NEXT_PUBLIC_API_URL: "https://api.medidocs.app",
      // Fresh Turnstile site key (public by design, safe as a literal),
      // widget scoped only to app.medidocs.app.
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAD7CYz9zDT2RqibR",
    },
  });

  const adminWeb = service("admin-web", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/admin-web/Dockerfile" },
    healthcheck: "/",
    replicas: { [region]: 1 },
    // See patient-web's PORT comment — same reason, different hardcoded port.
    env: {
      NODE_ENV: "production",
      PORT: "3001",
      NEXT_PUBLIC_API_URL: "https://api.medidocs.app",
      // Same physical widget as patient-web's — its Cloudflare-side hostname
      // allowlist was extended to include admin.medidocs.app (admin-portal
      // follow-up) rather than provisioning a second widget.
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAD7CYz9zDT2RqibR",
    },
  });

  // Cron jobs (docs/25 schedule table) — one service per job, all sharing
  // apps/cron/Dockerfile, distinguished only by `start`. FIELD_ENCRYPTION_KEY
  // must match api's value exactly; set via `railway variable set --stdin`.
  const cronEnv = { NODE_ENV: "production", DATABASE_URL: db.env.DATABASE_URL, FIELD_ENCRYPTION_KEY: preserve() };
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
  // docs/25 planned retention-cleanup at 0 4, but that minute is taken
  // above (and monthly by restore-test) — 30 4 keeps the same quiet window.
  const retentionCleanup = cronJob("cron-retention-cleanup", "30 4 * * *", "retention-cleanup");

  // Backups (docs/27) — real pg_dump + R2 + a monthly restore test into a
  // genuine scratch database. BACKUP_ENCRYPTION_KEY is a dedicated secret
  // (not FIELD_ENCRYPTION_KEY, and not shared with medpass-dev) since backup
  // exports are a different trust boundary.
  const backupEnv = { ...r2Env, BACKUP_ENCRYPTION_KEY: preserve() };
  const backupExport = cronJob("cron-backup-export", "0 1 * * *", "backup-export", backupEnv);
  const verifyBackups = cronJob("cron-verify-backups", "0 3 * * *", "verify-backups", backupEnv);
  const restoreTest = cronJob("cron-restore-test", "0 4 1 * *", "restore-test", backupEnv);

  // Monitoring (docs/21 "Operational reports") — no new observability vendor
  // (OD-13 stays open); a daily structured-log summary of DLQ/job-failure/
  // reminder-pipeline/backup health, standing in until a real OTLP backend
  // is chosen.
  const operationalReport = cronJob("cron-operational-report", "0 7 * * *", "operational-report");

  return project("medpass-prod", {
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
      retentionCleanup,
      backupExport,
      verifyBackups,
      restoreTest,
      operationalReport,
    ],
  });
});
