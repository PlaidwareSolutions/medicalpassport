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

See `packages/config/src/index.ts` for the validated shapes (api / worker / cron). V2 additions: `FIELD_ENCRYPTION_KEYS`, `FIELD_ENCRYPTION_ACTIVE_KEY_VERSION` (keyring, runbook R-KEY-1); `MIGRATOR_DATABASE_URL`, `READONLY_DATABASE_URL` (database roles, below). Planned: `OTLP_*`, ABDM gateway variables (docs_v2/12 §9).

## Database roles (docs_v2/19 ticket 0.22)

Railway's Postgres hands out one superuser-ish owner in `DATABASE_URL`, and until 0.22 the running api used it for everything. The IaC now declares two more variables on `api`, both `preserve()` (set out-of-band, never in source), and the pre-deploy command runs

```
sh -c 'DATABASE_URL="${MIGRATOR_DATABASE_URL:-$DATABASE_URL}" pnpm --filter @medpass/database exec prisma migrate deploy'
```

so migrations use the migrator role when one is set and fall back to `DATABASE_URL` until then — nothing breaks on the day the IaC is applied before the roles exist. The api process itself never reads `MIGRATOR_DATABASE_URL`; `READONLY_DATABASE_URL` is declared and validated but has no consumer in the api yet (admin explorer reads on a second Prisma client are a later ticket).

| Role | Holds | Used by | Variable |
|---|---|---|---|
| `medpass_migrator` | owns the schema: DDL on `public`, plus DML (Prisma's `_prisma_migrations` bookkeeping) | pre-deploy `prisma migrate deploy` only | `MIGRATOR_DATABASE_URL` |
| `medpass_app` | DML on every table and sequence, **no** CREATE/ALTER/DROP | api, worker, cron, abdm-gateway at runtime | `DATABASE_URL` |
| `medpass_readonly` | `SELECT` on every table, nothing else | admin reporting, ad-hoc operational queries | `READONLY_DATABASE_URL` |

### SQL to create them

Run once per project, connected as the Railway owner user (`railway connect postgres`, or `psql "$DATABASE_URL"` from a `railway run` shell). Replace every `'…'` password with a fresh 32+ byte random string generated locally (`openssl rand -base64 32`), then set the URLs with `printf '<url>' | railway variable set --stdin --service api <NAME>`. **Nothing here has been run against a live database yet** — the acceptance check for 0.22 ("api runtime role cannot `ALTER`") is the `\dp` / failing-`ALTER` verification at the end, on dev first.

```sql
-- 1. The migrator: owns the schema, so every table Prisma creates is owned
--    by it and later ALTERs need no ownership dance.
CREATE ROLE medpass_migrator LOGIN PASSWORD '…';
GRANT ALL ON SCHEMA public TO medpass_migrator;
ALTER SCHEMA public OWNER TO medpass_migrator;
-- Existing objects (the schema was created by the Railway owner user):
REASSIGN OWNED BY current_user TO medpass_migrator;  -- run as the owner that created them; skip on a fresh database

-- 2. The runtime role: data only.
CREATE ROLE medpass_app LOGIN PASSWORD '…';
GRANT USAGE ON SCHEMA public TO medpass_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medpass_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO medpass_app;
-- Tables the migrator creates from now on get the same grants automatically:
ALTER DEFAULT PRIVILEGES FOR ROLE medpass_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO medpass_app;
ALTER DEFAULT PRIVILEGES FOR ROLE medpass_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO medpass_app;

-- 3. The read-only role.
CREATE ROLE medpass_readonly LOGIN PASSWORD '…';
GRANT USAGE ON SCHEMA public TO medpass_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO medpass_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE medpass_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO medpass_readonly;
-- A reporting session can never hold a lock or a long transaction open by accident:
ALTER ROLE medpass_readonly SET default_transaction_read_only = on;
ALTER ROLE medpass_readonly SET statement_timeout = '30s';
```

Notes that matter when running it:

- `pg_advisory_xact_lock` (the audit chain lock) needs no grant — any role may take an advisory lock — so `medpass_app` keeps writing audit rows.
- `prisma migrate deploy` writes `_prisma_migrations`; the migrator owns it, so no extra grant is needed. If the table already exists and is owned by the Railway user, the `REASSIGN OWNED` above moves it.
- Cron one-shots that run DDL-free backfills stay on `DATABASE_URL` (`medpass_app`). The only thing that ever needs the migrator is the pre-deploy step.
- Rotation: these three URLs join `DATABASE_URL` in the 90-day row of docs_v2/12 §6 (runbook R8); rotating means `ALTER ROLE … PASSWORD`, then updating the variable, then a redeploy.

### Verify (dev first, then prod)

```sql
-- as medpass_app — must fail with "must be owner of table":
ALTER TABLE audit_events ADD COLUMN should_not_work text;
-- as medpass_readonly — must fail with "cannot execute INSERT in a read-only transaction":
INSERT INTO feature_flags (key) VALUES ('nope');
```

Then cut `DATABASE_URL` on api/worker/cron over to the `medpass_app` URL (a plain variable change plus redeploy) and confirm `/readyz` and one audited write. Record the completed run in docs_v2/20.
