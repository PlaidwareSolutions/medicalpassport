import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

/**
 * medpass-stg (docs_v2/19 ticket 0.4, docs_v2/12 §3 and §4): the staging
 * environment that sits between medpass-dev and production. A copy of
 * railway.ts with these deliberate differences, and nothing else:
 *
 * - Project "medpass-stg" on its own Postgres and its own R2 bucket prefix
 *   (medpass-stg-*), so a staging backfill or restore test can never touch
 *   dev or production data.
 * - Deploys from the `v2` branch: V2 lands on staging first; foundation
 *   stays production's branch (both Railway projects that exist today
 *   track foundation, which is why nothing V2 has been deployed yet).
 * - Hostnames `staging-*.medicinepassport.app` (docs_v2/12 §3), behind
 *   Cloudflare Access; custom domains are added with `railway domain`, not
 *   here (Railway rejects them in this file).
 * - Real transports stay off: OTP_TRANSPORT=log with the fixed code, no
 *   WhatsApp/SMS, ABDM gateway in mock mode until NHA sandbox credentials
 *   exist (ticket 0.8) — then ABDM_GATEWAY_ENV/CLIENT_* are set out-of-band.
 * - Every secret is preserve(): generated per environment and set with
 *   `railway variable set --stdin`, never copied from dev or production.
 *
 * This file does not create the project. Creating medpass-stg is a spend
 * decision recorded in docs_v2/16; once taken:
 *   1. create the project (dashboard or `railway init`), note its project id
 *      and the production environment id;
 *   2. plan:  node node_modules/railway/dist/iac/bin.cjs config plan  *               --file .railway/railway.stg.ts --token "$RAILWAY_API_TOKEN"  *               --project-id <id> --environment-id <id>
 *   3. apply, add domains, set secrets, then `node .railway/set-check-suites.mjs <id> --apply`.
 */
export default defineRailway(() => {
  // Staging tracks v2 (see the header); production tracks foundation.
  //
  // `checkSuites: true` (docs_v2/19 ticket 0.2) makes Railway wait for the
  // GitHub Actions run on the pushed commit before deploying. Until this was
  // turned on, a red build shipped anyway: CI gated nothing at all. The CI
  // workflow triggers on pushes to `v2`, so a check suite always
  // exists for Railway to wait on.
  //
  // The trade-off, worth knowing before an incident: while CI is failing,
  // pushes stop deploying. To ship a genuine emergency fix, either redeploy
  // an earlier deployment from the Railway dashboard, or flip this to false,
  // apply, deploy, and put it back.
  const repo = github("PlaidwareSolutions/medicalpassport", { branch: "v2", checkSuites: true });
  const region = "asia-southeast1-eqsg3a"; // Singapore (docs/25 §Region, OD-5 assumption)

  const db = postgres("postgres", { region });

  // R2 (docs/26 §13): five buckets to provision for staging
  // (medpass-stg-{patient-docs,derived,ocr-tmp,backups,public-assets}) in
  // the same Cloudflare account as the zone; a separate access key from
  // dev's and production's (docs_v2/12 §6: credentials separated per
  // environment). R2_ACCESS_KEY_ID/
  // R2_SECRET_ACCESS_KEY are derived from a Cloudflare API token scoped to
  // *only* Workers R2 Storage — deliberately not the broader DNS/WAF/Zone
  // Settings token used to provision the zone itself, since this credential
  // lives in the running app (least privilege).
  const r2Env = {
    R2_ACCOUNT_ID: "db356ac44b40bc2b194b6838d03eb84b",
    R2_BUCKET_PREFIX: "medpass-stg-",
    R2_ACCESS_KEY_ID: preserve(),
    R2_SECRET_ACCESS_KEY: preserve(),
  };

  const api = service("api", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/api/Dockerfile" },
    healthcheck: "/readyz",
    replicas: { [region]: 1 },
    // Migrations run as the migrator role when one is configured (docs_v2/19
    // ticket 0.22, docs_v2/12 §7): MIGRATOR_DATABASE_URL owns the schema
    // (DDL); DATABASE_URL — the api's runtime role — only has DML. The shell
    // form is what Railway executes for a pre-deploy command, and the
    // `${VAR:-default}` fallback keeps the deploy working until the roles are
    // created (infra/railway/README.md has the SQL) and the variable is set
    // out-of-band. The api process itself never reads MIGRATOR_DATABASE_URL.
    deploy: {
      preDeployCommand: [
        `sh -c 'DATABASE_URL="\${MIGRATOR_DATABASE_URL:-$DATABASE_URL}" pnpm --filter @medpass/database exec prisma migrate deploy'`,
      ],
    },
    env: {
      NODE_ENV: "staging",
      PORT: "4000",
      DATABASE_URL: db.env.DATABASE_URL,
      // Ticket 0.22 database roles — set out-of-band once the roles exist
      // (README SQL); preserve() so a plan never proposes deleting them.
      MIGRATOR_DATABASE_URL: preserve(),
      READONLY_DATABASE_URL: preserve(),
      OTP_TRANSPORT: "log",
      OTP_DEV_FIXED_CODE: "000000",
      // The marketing site has its own staging on medidocs.app and posts
      // leads to the dev api, so it is not an origin here.
      CORS_ORIGINS: "https://staging-app.medicinepassport.app,https://staging-admin.medicinepassport.app,https://staging-clinic.medicinepassport.app",
      // Set out-of-band via `railway variable set --stdin` (docs/28: secrets
      // only in Railway variables) — preserve() tells apply not to touch them.
      OTP_HASH_PEPPER: preserve(),
      SESSION_TOKEN_PEPPER: preserve(),
      // V2 Phase 7: peppered share-link hashes (legacy unpeppered links still verify).
      SHARE_TOKEN_PEPPER: preserve(),
      // Admin auth (docs/18, admin-portal follow-up) — its own dedicated pepper.
      ADMIN_PASSWORD_PEPPER: preserve(),
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
      // Turnstile (docs/26 §12.4, Stage 11 follow-up) — the secret key is
      // set via `railway variable set --stdin`; the widget's site key
      // (public, safe client-side) lives on patient-web below instead.
      TURNSTILE_SECRET_KEY: preserve(),
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
      // Build-time (Next.js inlines NEXT_PUBLIC_* at build).
      NEXT_PUBLIC_API_URL: "https://staging-api.medicinepassport.app",
      // Turnstile site key (docs/26 §12.4): a NEW widget whose hostname
      // allowlist is staging-app/staging-admin.medicinepassport.app; the
      // dev widget's key would render but never verify here. Public value,
      // set out-of-band once the widget exists.
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: preserve(),
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
      NEXT_PUBLIC_API_URL: "https://staging-api.medicinepassport.app",
      // Same widget as patient-web's above (allowlist covers both hosts).
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: preserve(),
    },
  });


  // V2 Phase 11 (docs_v2/06 P11-2, docs_v2/12 §3): the clinic / pharmacy /
  // lab / hospital portal. Own hostname, own Turnstile site (its key is set
  // out-of-band and preserved), own session cookie name; talks to the same
  // api, which lists its origin in CORS_ORIGINS above.
  const providerWeb = service("provider-web", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/provider-web/Dockerfile" },
    healthcheck: "/login",
    replicas: { [region]: 1 },
    env: {
      NODE_ENV: "production",
      PORT: "3003",
      NEXT_PUBLIC_API_URL: "https://staging-api.medicinepassport.app",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: preserve(),
    },
  });

  // V2 Phase 8 (docs_v2/08 §4): the ABDM callback gateway. Declared here in
  // mock mode so the container is built and exercised; the api keeps its
  // in-process mock (ABDM_GATEWAY_URL unset) until NHA sandbox credentials
  // exist (ticket 0.8), at which point ABDM_GATEWAY_ENV/CLIENT_* are set
  // out-of-band and the api is pointed at http://abdm-gateway.railway.internal:4100.
  const abdmGateway = service("abdm-gateway", {
    source: repo,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/abdm-gateway/Dockerfile" },
    replicas: { [region]: 1 },
    env: {
      NODE_ENV: "staging",
      PORT: "4100",
      DATABASE_URL: db.env.DATABASE_URL,
      ABDM_GATEWAY_ENV: "mock",
      MOCK: "true",
      ABDM_INTERNAL_TOKEN: preserve(),
    },
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
  // docs/25 planned retention-cleanup at 0 4, but that minute is taken
  // above (and monthly by restore-test) — 30 4 keeps the same quiet window.
  const retentionCleanup = cronJob("cron-retention-cleanup", "30 4 * * *", "retention-cleanup");
  // Professional-lead 24-month retention (Session 17): deletes leads whose
  // lastInteractionAt is older than 24 calendar months. DB only.
  const cleanupProfessionalLeads = cronJob("cron-cleanup-professional-leads", "0 5 * * *", "cleanup-professional-leads");

  // Backups (docs/27, Stage 11 follow-up) — real pg_dump + R2 + a monthly
  // restore test into a genuine scratch database. BACKUP_ENCRYPTION_KEY is a
  // dedicated secret (not FIELD_ENCRYPTION_KEY) since backup exports are a
  // different trust boundary — one key compromise shouldn't unlock the other.
  const backupEnv = { ...r2Env, BACKUP_ENCRYPTION_KEY: preserve() };
  const backupExport = cronJob("cron-backup-export", "0 1 * * *", "backup-export", backupEnv);
  const verifyBackups = cronJob("cron-verify-backups", "0 3 * * *", "verify-backups", backupEnv);
  const restoreTest = cronJob("cron-restore-test", "0 4 1 * *", "restore-test", backupEnv);
  // Backup retention enforcement (Session 17): idempotently ensures the R2
  // 90-day lifecycle rule on the backups bucket. Needs R2 creds only.
  const ensureBackupLifecycle = cronJob("cron-ensure-backup-lifecycle", "30 1 * * *", "ensure-backup-lifecycle", r2Env);

  // Monitoring (docs/21 "Operational reports") — no new observability vendor
  // (OD-13 stays open); a daily structured-log summary of DLQ/job-failure/
  // reminder-pipeline/backup health, standing in until a real OTLP backend
  // is chosen.
  const operationalReport = cronJob("cron-operational-report", "0 7 * * *", "operational-report");

  // V2 Phase 17 (docs_v2/06 P17): test-due schedules once a night; measurement
  // reminder slots every five minutes inside their 15-minute window. Both only
  // queue notification rows — delivery stays with detect-due-reminders' pass.
  const detectTestDue = cronJob("cron-detect-test-due", "30 2 * * *", "detect-test-due");
  const detectMeasurementReminders = cronJob("cron-detect-measurement-reminders", "*/5 * * * *", "detect-measurement-reminders");

  return project("medpass-stg", {
    resources: [
      db,
      api,
      worker,
      patientWeb,
      adminWeb,
      providerWeb,
      abdmGateway,
      cleanupExpiredOtps,
      cleanupExpiredSessions,
      verifyAuditChain,
      extendScheduledDoses,
      reconcileMissedDoses,
      cleanupAbandonedUploads,
      detectDueReminders,
      generateRefillReminders,
      detectTestDue,
      detectMeasurementReminders,
      cleanupRateLimitBuckets,
      retentionCleanup,
      cleanupProfessionalLeads,
      backupExport,
      verifyBackups,
      restoreTest,
      ensureBackupLifecycle,
      operationalReport,
    ],
  });
});
