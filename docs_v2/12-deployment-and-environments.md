# 12 — Deployment and Environments (V2)

Extends `docs/25`, `docs/26`, `docs/27`, `docs/28`, `docs/30`. Written against the real IaC (`.railway/railway.ts`, `.railway/railway.prod.ts`) and the real CI (`.github/workflows/ci.yml`), not the pre-bring-up plans in `infra/*/README.md` (which Phase 0 rewrites).

## 1. Where V1 actually is

- Two Railway projects: `medpass-dev` (dev + staging combined, Singapore) and `medpass-prod` (Postgres physically in `sfo`, declared as such). Both auto-deploy from GitHub `foundation` on push with `checkSuites: false`, so **CI never gates a deploy**.
- 21 resources per project: postgres, api (pre-deploy `prisma migrate deploy`), worker, patient-web, admin-web, 16 cron services.
- Cloudflare: `medidocs.app` zone fully configured (Free plan: one rate-limit rule); `medicinepassport.app` zone has no rate-limit/no-cache rules; `www` missing on both; phase-3 301 not done.
- R2: 11 buckets; dev and prod share one credential. Telnyx account shared.
- Backups: nightly encrypted dump to R2, verified, monthly restore test — real and green.
- No metrics backend, no alerting.

## 2. Target topology (V2)

| Project | Purpose | Services | Data |
|---|---|---|---|
| `medpass-dev` | shared dev, ephemeral | api, worker, patient-web, admin-web, provider-web, abdm-gateway (mock), crons (subset) | synthetic |
| `medpass-stg` (**new**, P0-12) | release candidates, ABDM sandbox, pen tests, pilot partner training | full set incl. abdm-gateway (sandbox) | synthetic + ABDM sandbox test identities |
| `medpass-prod` | production | full set, 2 replicas for api and patient-web, abdm-gateway (production after M8E) | real |
| PR previews | optional Railway PR environments for api + patient-web | — | synthetic seed |

Regions: keep Singapore for compute; **decision point at M8E** whether NHA certification or DPDP counsel requires India-region hosting (ADR-V2-010). The IaC already parameterizes region; a migration runbook (dump/restore + DNS cutover + R2 bucket copy) is written in P0 so the move is a rehearsed operation, not a project.

Redis: still not needed. Revisit trigger in ADR-V2-006.

## 3. Hostnames

| Host | Service | Zone |
|---|---|---|
| `app.medicinepassport.app` | patient-web | medicinepassport.app |
| `api.medicinepassport.app` | api | medicinepassport.app |
| `admin.medicinepassport.app` (**new**, moves off medidocs) | admin-web | medicinepassport.app |
| `clinic.medicinepassport.app` (**new**) | provider-web | medicinepassport.app |
| `abdm.medicinepassport.app` (**new**) | abdm-gateway callbacks | medicinepassport.app |
| `assets.medicinepassport.app` (**new**) | R2 public assets | medicinepassport.app |
| `staging-*.medicinepassport.app` | medpass-stg | medicinepassport.app, Cloudflare Access in front |
| `medidocs.app`, `*.medidocs.app` | 301 → medicinepassport.app (phase 3) | medidocs.app |

**provider-web service (P11-2, `clinic.medicinepassport.app`).** One Railway service per environment next to admin-web: `builder: DOCKERFILE`, `apps/provider-web/Dockerfile`, `PORT=3003`, healthcheck `/login`, one replica. Build args / env: `NEXT_PUBLIC_API_URL` (build-time; on `*.medicinepassport.app` the app talks to `api.medicinepassport.app` regardless, same-site cookie rule) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for its **own** Turnstile widget (provision a separate Cloudflare Turnstile site whose hostname allowlist is `clinic.medicinepassport.app` + `staging-clinic.medicinepassport.app`; the widget renders nothing while the key is unset). The api service's `CORS_ORIGINS` gains `https://clinic.medicinepassport.app`; the provider session cookie (`medpass_provider_session`, httpOnly, SameSite=Lax) is a different name and token type from the patient one. Declare it in `.railway/railway.ts` and `.railway/railway.prod.ts` alongside `admin-web` when the P11 environments are provisioned; CSP is emitted per request by the app's middleware (docs_v2/11 §9), so the edge adds only HSTS and the no-cache rule below.

Cloudflare rules to replicate on the `medicinepassport.app` zone (P0): OTP rate limit, api/admin/clinic no-cache, `_next/static` cache, WAF managed rules, HSTS; plan upgrade to Pro is a cost decision recorded in [16](16-dependencies-and-risks.md) (Free plan = one rate-limit rule).

## 4. Release gates (roadmap §35)

```
DEV → INTEGRATION → SECURITY TEST → CLINICAL VALIDATION → STAGING → CONTROLLED BETA → PRODUCTION
```

| Gate | Enforced by |
|---|---|
| DEV | PR: lint, typecheck, unit, contract (OpenAPI diff), integration (Postgres), api e2e, worker tests, Playwright a11y/reflow; Windows api-suite job weekly |
| INTEGRATION | merge to `main` → deploy `medpass-dev`; nightly: full e2e incl. mock-ABDM flows, ZAP baseline, backup verify |
| SECURITY TEST | authz matrix, dependency audit, gitleaks (every PR); pen test findings closed (per release) |
| CLINICAL VALIDATION | gate evidence attached to the release PR ([10](10-clinical-safety-and-ai-governance.md) §4) |
| STAGING | tag `vX.Y.Z-rc.N` → `medpass-stg`; smoke suite; migration dry-run against a prod-shaped snapshot; restore-test of the pre-release backup |
| CONTROLLED BETA | feature flags at 0 % → pilot cohort allowlist; error budget watched for 7 days |
| PRODUCTION | tag `vX.Y.Z` → `medpass-prod`; flags widened by percentage; rollback rehearsed each release |

ABDM additional gate: `ABDM DEVELOPMENT → FHIR VALIDATION → ABDM SANDBOX → FUNCTIONAL TESTING → SECURITY ASSESSMENT → SANDBOX EXIT → PRODUCTION`, enforced by the M8 milestones.

Branching: `main` is the integration branch (CI on every PR, deploys dev); release tags deploy stg/prod. The `foundation` branch is merged into `main` in Phase 0 and retired. Railway projects switch to `checkSuites: true` and to tag/branch triggers per environment.

## 5. Deploy procedure

```bash
# plan/apply infra (always name the file; prod must never be applied from the dev file)
railway config plan  --file .railway/railway.ts        # dev
railway config plan  --file .railway/railway.stg.ts    # staging (new)
railway config plan  --file .railway/railway.prod.ts   # production
railway config apply --file <file> [--confirm-destructive] [--yes]

# secrets: never in source
railway variable set --stdin --service <svc> <NAME>
```

The V1 footguns stay documented: planning prod without `--file` proposes moving the prod DB region and overwriting secrets; `preserve()` on a new service resolves to unset.

Application deploys are GitHub-triggered per environment; the CI `deploy-staging` stub is replaced by a real job that waits for `build-test` and calls `railway redeploy --service <id> --environment <env>` with a scoped project token (no `RAILWAY_TOKEN` exists in this environment today; provisioning is a P0 platform-configuration item).

## 6. Secrets and rotation

| Secret | Scope | Rotation | Runbook |
|---|---|---|---|
| `DATABASE_URL` (+ new `MIGRATOR_DATABASE_URL`, `READONLY_DATABASE_URL`) | per project | 90 d | R8 |
| `OTP_HASH_PEPPER`, `SESSION_TOKEN_PEPPER`, `ADMIN_PASSWORD_PEPPER` | per project | 180 d with dual-accept window | R8 |
| `SHARE_TOKEN_PEPPER` (optional; V2 Phase 7 peppered share-link hashes — unpeppered legacy links still verify until they expire) | per project | 180 d; rotation invalidates live links, so rotate with a 30 d dual-accept window | R8 |
| `FIELD_ENCRYPTION_KEYS` (keyring) | per project | annual + on incident; re-encrypt job | R-KEY-1 (new) |
| `BACKUP_ENCRYPTION_KEY` (public key only on Railway; private held offline) | per project | annual | R-DR-3 (new) |
| R2 keys | per project (split dev/stg/prod) | 90 d | R8 |
| Telnyx keys | per project | 90 d | R8 |
| Turnstile secrets | per site | on incident | R8 |
| ABDM client secret, HIU/HIP keys | abdm-gateway only, per env | per NHA policy | R-ABDM-1 (new) |
| Railway/Cloudflare API tokens | CI | 90 d, least scope | R8 |

Rotation is executed on dev in P0 (never done in V1), staging before V2.0, prod on schedule.

## 7. Migrations in production

1. Every migration is additive until the sunset migration (ADR-V2-007).
2. `prisma migrate deploy` runs as the api pre-deploy command with `MIGRATOR_DATABASE_URL` (least privilege, ADR-4 finally implemented).
3. Backfills run as idempotent cron one-shots (`apps/cron/src/jobs/backfill-*.ts`) after the deploy, resumable, reporting counts to the operational report.
4. Parity check job compares V1 and V2 tables and writes a `MigrationParityReport` row; the sunset migration refuses to run unless the latest report matches and a restore-test passed on the pre-sunset backup.
5. Rollback: application roll-forward or `railway redeploy` of the previous deployment (rehearsed in P0-12 with a named deployment id); schema rollback is not attempted for additive migrations; the sunset migration is preceded by a verified full backup and is irreversible by design.

## 8. Backups and DR (extends `docs/27`)

Exists: nightly encrypted `pg_dump` → R2, verify, monthly restore-test with row-count match, lifecycle rule self-healing. Adds: key custody offline (P0), R2 versioning + cross-bucket replication for `patient-docs`/`derived`/`abdm-inbox`, Railway PITR verified once and recorded, quarterly region-loss game day (restore into a fresh project from R2 only; target RTO ≤ 24 h, measured), audit archive export ≥ 7 y, quarterly settings export of Railway/Cloudflare config (IaC covers Railway; Cloudflare rules exported via API to `infra/cloudflare/exports/`).

## 9. Environment variables added in V2

| Var | Service | Purpose |
|---|---|---|
| `FIELD_ENCRYPTION_KEYS` | api, worker, cron, abdm-gateway | keyring (replaces `FIELD_ENCRYPTION_KEY` after migration) |
| `MIGRATOR_DATABASE_URL`, `READONLY_DATABASE_URL` | api (pre-deploy), admin reads | least privilege |
| `OTLP_ENDPOINT`, `OTLP_HEADERS` | all | observability backend (OD-13) |
| `ABDM_GATEWAY_INTERNAL_URL`, `ABDM_INTERNAL_TOKEN` | api | private call to the gateway |
| `ABDM_ENV`, `ABDM_CLIENT_ID`, `ABDM_CLIENT_SECRET`, `ABDM_HIU_ID`, `ABDM_HIP_ID`, `ABDM_KEY_PAIR_*` | abdm-gateway | ABDM credentials |
| `OCR_PROVIDER`, `OCR_VENDOR_*`, `AI_PROVIDER`, `AI_*`, `AV_SCANNER` | worker | document intelligence adapters |
| `CATALOG_VENDOR_*`, `INTERACTION_PROVIDER_*` | api, cron | licensed data adapters |
| `PROVIDER_WEB_ORIGIN` | api | CORS/CSRF for the provider portal |

All validated in `packages/config` with production refusals for dev-only values, following the existing `env.ts` pattern.

## 10. Verification of a deploy (smoke suite, every environment)

`readyz` on api and gateway · login with a synthetic account (voice/SMS transport skipped via allowlisted test number on staging only) · create medicine → schedule → timeline · upload one page → classification → candidate → confirm · create share → public snapshot · admin login · cron `detect-due-reminders` one-shot exit 0 · backup verify status fresh · OTLP heartbeat received. Runs from CI against the target hostname after every deploy and is the go/no-go for widening flags.
