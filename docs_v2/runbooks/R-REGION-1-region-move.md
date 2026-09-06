# R-REGION-1 — Move compute and data to another region or provider

Why this exists: ADR-V2-010. NHA certification or DPDP counsel may require India-region hosting; the roadmap forbids treating the current provider as a permanent constraint. This makes a move a rehearsed operation with a measured duration.

## Scope

Railway project (api, worker, patient-web, admin-web, provider-web, abdm-gateway, cron-*), Postgres, R2 buckets (`patient-docs`, `derived`, `ocr-tmp`, `backups`, `public-assets`, later `abdm-inbox`), Cloudflare DNS, secrets.

## Preconditions

- Target region/provider chosen and recorded in `docs_v2/20`; new project created from the IaC with `region` changed (both `.railway/*.ts` take a region per service).
- A fresh verified backup (`backup-export` + `verify-backups` green) and a passed `restore-test` in the last 30 days.
- All secrets inventoried (docs_v2/12 §6) and re-provisioned in the target; the field-encryption keyring copied exactly (R-KEY-1 explains versions).
- Maintenance window agreed (patients see the offline PWA shell; reminders queue up — the `detect-due-reminders` cron catches up within its 1-minute cadence after cutover, and missed-dose reconciliation runs at 15 minutes).

## Procedure

1. **Freeze writes**: scale the source `api`, `worker` and every `cron-*` to zero replicas (Railway) — patient-web keeps serving the offline shell; queued offline mutations replay after cutover through `POST /v1/sync` (idempotent).
2. **Final dump**: run `backup-export` once more on the source; note the `backup_executions` row id and checksum.
3. **Restore into the target Postgres**: follow the `restore-test` job's steps against the target `DATABASE_URL` (decrypt with the backup key, `pg_restore`, compare per-table row counts to the manifest; `row_counts_match` must be true).
4. **Copy objects**: R2 bucket-to-bucket copy for `patient-docs`, `derived`, `public-assets` (and `abdm-inbox`); `ocr-tmp` may be skipped (48 h transient); `backups` copied for continuity. Verify object counts and a sample of checksums per bucket.
5. **Deploy the target**: `railway config apply --file .railway/railway.<target>.ts`; run `prisma migrate status` (must be "up to date"); start api/worker/crons.
6. **Smoke**: docs_v2/12 §10 smoke suite against the target hostnames (temporary `*-cutover.` hostnames), including a real OTP login on the configured transport.
7. **Cutover DNS**: point the production hostnames at the target services in Cloudflare (proxied); TTLs are Cloudflare-managed so propagation is immediate at the edge.
8. **Unfreeze**: confirm reminder dispatch resumes (`operational-report` and the `NotificationAttempt` stream), audit chain verification runs green on the target, and offline sync replays succeed.
9. **Decommission the source** after 7 days of green operation; keep its final backup for the retention period.

## Verification (record in the log)

Measured durations for steps 2–7 (RTO), data delta between freeze and cutover (RPO — should be zero with writes frozen), smoke results, first `verify-audit-chain` result on the target.

## Rollback

Until step 7 the source is intact: unfreeze it and delete the target. After step 7, reverse the DNS change; writes made on the target after cutover must be re-dumped and restored into the source (same procedure, reversed) — so keep the window short and the freeze real.

## Log

| Date | From → to | RTO measured | Operator | Notes |
|---|---|---|---|---|
| — | — | — | — | desk-check pending |
