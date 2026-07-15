# 28 — Environment and Secrets Strategy

## Environments

| | development | staging | production |
|---|---|---|---|
| Railway project | `medpass-dev` | `medpass-stg` | `medpass-prod` |
| Data | synthetic seed only | synthetic + anonymized load fixtures | real patient data |
| R2 buckets | `dev-*` | `stg-*` | `prod-*` |
| Domains | `dev.app.example.com` (Cloudflare Access-gated) | `stg.app.example.com` (Access-gated) | public |
| Providers | log/fake adapters (**Mocked**) | sandbox provider accounts | production accounts |
| Access | all engineers | all engineers | release operators only |

Hard rules: **production strongly isolated** — separate projects, tokens, variables, databases, buckets, provider accounts; **no real production patient data in dev/staging or automated tests**; local development runs docker-compose (PG + Redis + MinIO) with the same env-var names.

## Configuration model

- `packages/config` defines a **Zod-validated env schema per app**; boot fails fast on missing/invalid vars (no silent defaults for secrets).
- `.env.example` per app documents every variable (name, purpose, example placeholder) — committed; real `.env*` files are git-ignored; **gitleaks** in CI blocks accidental commits and scans history.
- Feature flags via `packages/config` (env-seeded in MVP; flag service later) — flags are configuration, never secrets.

## Secrets inventory (per environment)

| Secret | Consumers | Rotation |
|---|---|---|
| `DATABASE_URL` (app_rw) / `MIGRATOR_DATABASE_URL` | api, worker, cron / CI migrate step | 90 d or on incident |
| `REDIS_URL` (auth) | api, worker, cron | 90 d |
| `SESSION_TOKEN_PEPPER`, `OTP_HASH_PEPPER` | api | 180 d (dual-accept window) |
| `FIELD_ENCRYPTION_KEYS` (versioned keyring) | api, worker | add-new/re-encrypt rotation |
| `R2_ACCESS_KEY_ID/SECRET` (scoped per bucket+operation) | api, worker, cron | 90 d |
| `TURNSTILE_SECRET` | api | on incident |
| SMS/WhatsApp/OCR/AI provider keys + webhook signing secrets | worker, api (webhooks) | provider policy / 90 d |
| `BACKUP_ENCRYPTION_KEY` (public-key encrypt; private key held offline) | cron (encrypt only) | yearly; break-glass documented |
| Railway/Cloudflare API tokens (CI deploys, infra scripts) | CI | 90 d, least-scope |

## Handling rules

1. Secrets live in Railway environment variables (per-project) and GitHub Actions encrypted secrets (CI) — never in code, images, logs, client bundles, or `NEXT_PUBLIC_*`.
2. Client-exposed config is allowlisted explicitly; build asserts no secret-pattern strings in browser bundles (secret-leak tests, [20](20-testing-strategy.md)).
3. Least privilege: each service gets only its own secrets; cron backup job holds encrypt-only key material; migrator credentials exist only in the CI migration step.
4. Rotation is a documented runbook ([30](30-operational-runbooks.md)) with dual-accept windows (peppers, keyrings) so rotation never requires downtime or mass logout unless intended.
5. Incident response: any suspected leak → immediate rotation + audit review + gitleaks history scan ([30](30-operational-runbooks.md) secret-leak runbook).
6. Offline clients never receive secrets ([15](15-offline-sync-strategy.md)): no R2 credentials, DB credentials, provider secrets, or long-lived unrestricted tokens in the browser.
