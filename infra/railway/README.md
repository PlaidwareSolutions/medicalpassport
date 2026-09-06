# Railway — what is actually deployed

Rewritten 2026-09-06 (docs_v2 ticket 0.31) from the IaC that is the source of truth: [`.railway/railway.ts`](../../.railway/railway.ts) (project **`medpass-dev`**, a combined dev + staging project) and [`.railway/railway.prod.ts`](../../.railway/railway.prod.ts) (project **`medpass-prod`**). The older three-project / Redis plan this file used to describe was never built; see `docs_v2/12-deployment-and-environments.md` for the V2 target (adds `medpass-stg`, `provider-web`, `abdm-gateway`).

## Projects and services

| Project | Region | Services |
|---|---|---|
| `medpass-dev` | Singapore (`asia-southeast1-eqsg3a`) | postgres, api, worker, patient-web, admin-web, 16 cron services |
| `medpass-prod` | Singapore for compute; **the production Postgres lives in `sfo`** (declared as such in the IaC rather than moved) | same set |

| Service | Dockerfile | Health | Start |
|---|---|---|---|
| api | `apps/api/Dockerfile` | `/readyz` | `node dist/main.js`; pre-deploy `pnpm --filter @medpass/database exec prisma migrate deploy` |
| worker | `apps/worker/Dockerfile` | — | `node dist/main.js` (Postgres job queue; no Redis anywhere — ADR-V2-006) |
| patient-web | `apps/patient-web/Dockerfile` | `/` | `next start -p 3000` |
| admin-web | `apps/admin-web/Dockerfile` | `/` | `next start -p 3001` |
| cron-* | `apps/cron/Dockerfile` | — | `node dist/jobs/<job>.js`, `restartPolicyType: NEVER` |

Cron schedules (both projects): detect-due-reminders `* * * * *` · reconcile-missed-doses `*/15 * * * *` · cleanup-abandoned-uploads `0 * * * *` · extend-scheduled-doses `0 1 * * *` · backup-export `0 1 * * *` · ensure-backup-lifecycle `30 1 * * *` · verify-audit-chain `0 2 * * *` · cleanup-expired-otps `0 3 * * *` · verify-backups `0 3 * * *` · cleanup-expired-sessions `30 3 * * *` · cleanup-rate-limit-buckets `0 4 * * *` · restore-test `0 4 1 * *` · retention-cleanup `30 4 * * *` · cleanup-professional-leads `0 5 * * *` · generate-refill-reminders `0 6 * * *` · operational-report `0 7 * * *`. Manual one-shots (run with `railway run`): `rotate-field-encryption`, `backfill-provenance`, `backfill-health-events`.

## How deploys happen

Both projects deploy from GitHub `PlaidwareSolutions/medicalpassport`, branch **`foundation`**, on push, with `checkSuites: false` — CI does **not** gate a deploy today (docs_v2 ticket 0.2 changes this). V2 work lives on branch `v2` for that reason.

## Commands

```bash
railway config plan  --file .railway/railway.ts        # dev — always name the file
railway config plan  --file .railway/railway.prod.ts   # prod
railway config apply --file <file> [--confirm-destructive] [--yes]
printf '<value>' | railway variable set --stdin --service <svc> <NAME>   # secrets never in source
railway run --service <cron-svc> node dist/jobs/<job>.js                  # one-shot jobs
```

Known footguns (documented in `docs/landing-page/production-soft-launch-report.md`): planning prod without `--file` proposes moving the prod DB region and overwriting prod secrets with dev values; `preserve()` on a brand-new service resolves to unset until the secret is copied.

## Tokens

An account token (`RAILWAY_API_TOKEN`) is needed for `whoami`/`list`/cross-project work. A **project token** (`RAILWAY_TOKEN`) reaches one project only and needs `-e <environment>` for every command; `status`, `variables`, `run`, `redeploy` work with it.

## Environment variables

See `packages/config/src/index.ts` for the validated shapes (api / worker / cron). V2 additions: `FIELD_ENCRYPTION_KEYS`, `FIELD_ENCRYPTION_ACTIVE_KEY_VERSION` (keyring, runbook R-KEY-1). Planned: `MIGRATOR_DATABASE_URL`, `READONLY_DATABASE_URL`, `OTLP_*`, ABDM gateway variables (docs_v2/12 §9).
