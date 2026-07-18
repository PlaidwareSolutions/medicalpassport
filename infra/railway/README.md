# Railway configuration (docs/25)

Three isolated projects: `medpass-dev`, `medpass-stg`, `medpass-prod`.
Everything below is **Requires platform configuration** until the projects exist.

## Services per project

| Service | Source | Public | Start command | Health |
|---|---|---|---|---|
| api | `apps/api/Dockerfile` | ✅ via Cloudflare only | `node dist/main.js` | `/readyz` |
| patient-web | `apps/patient-web/Dockerfile` | ✅ via Cloudflare only | `pnpm start` | `/` |
| admin-web | `apps/admin-web/Dockerfile` | ✅ via Cloudflare (+ optional CF Access) | `pnpm start` | `/` |
| worker | `apps/worker/Dockerfile` | ❌ private | `node dist/main.js` | heartbeat |
| PostgreSQL | Railway addon | ❌ private networking only | — | Railway |
| Redis | Railway addon | ❌ private networking only | — | Railway |

## Cron jobs (image: `apps/cron/Dockerfile`, one-shot commands)

| Schedule | Command |
|---|---|
| `0 3 * * *` | `node dist/jobs/cleanup-expired-otps.js` |
| `30 3 * * *` | `node dist/jobs/cleanup-expired-sessions.js` |
| `0 2 * * *` | `node dist/jobs/verify-audit-chain.js` |
| `0 1 * * *` | `node dist/jobs/extend-scheduled-doses.js` |
| `*/15 * * * *` | `node dist/jobs/reconcile-missed-doses.js` |
| `0 * * * *` | `node dist/jobs/cleanup-abandoned-uploads.js` |
| `* * * * *` | `node dist/jobs/detect-due-reminders.js` |
| `0 6 * * *` | `node dist/jobs/generate-refill-reminders.js` |

Later stages add: expire-share-links, backup-export/verify,
retention-cleanup, reconcile-stuck-jobs, operational-report (docs/25 table).

## Environment variables

See each app's `.env.example`. Rules (docs/28): secrets only in Railway
variables; `DATABASE_URL`/`REDIS_URL` use **private networking** hostnames;
migrations run as a pre-deploy step with `MIGRATOR_DATABASE_URL`
(`pnpm --filter @medpass/database exec prisma migrate deploy`).

## Region

Southeast Asia (Singapore) initially — co-locate api, worker, PostgreSQL,
Redis. Latency from Indian metros must be measured and documented before
launch (docs/25 §region, OD-5). Cross-border processing disclosure: OD-2.

## Non-negotiables

- PostgreSQL and Redis are never publicly exposed and never proxied through Cloudflare.
- Containers keep no permanent local files.
- Only api / patient-web / admin-web get public domains, and users reach them
  only through the Cloudflare-proxied hostnames (never `*.railway.app` directly).
