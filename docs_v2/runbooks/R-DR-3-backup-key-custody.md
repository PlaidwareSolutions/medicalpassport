# R-DR-3 — Backup encryption key custody outside Railway

Today the backup job encrypts `pg_dump` output with a symmetric `BACKUP_ENCRYPTION_KEY` that lives in Railway variables (`docs/27`), so a full Railway compromise exposes both the data and the key. Target (docs_v2/12 §8): the job encrypts to a **public key** held on Railway; the **private key** is held offline by two named custodians and is never present in any cloud environment.

## Design (implemented in `apps/cron/src/lib/backup-crypto.ts` when this runbook is executed)

- Hybrid encryption: a fresh random data key per backup (AES-256-GCM, as now) wrapped with the custodians' public key (age/X25519 or RSA-OAEP). `BACKUP_PUBLIC_KEY` replaces `BACKUP_ENCRYPTION_KEY` for the export path; `verify-backups` only needs the manifest checksums (no decryption); `restore-test` needs the private key → it runs from an operator machine, not a cron, or a scratch environment where the key is injected for the run and removed after.
- Key generation on an offline machine; private key split (Shamir 2-of-3) across custodians; public key committed to the IaC as a plain variable.

## Procedure (first execution)

1. Generate the key pair offline; store shares with custodians; record fingerprints in this runbook's log (never the key).
2. Set `BACKUP_PUBLIC_KEY` on `cron-backup-export`; deploy the updated job; run it once; confirm the manifest records `keyFingerprint`.
3. Restore-test from an operator machine with the private key assembled: decrypt, `pg_restore` into a scratch DB, compare row counts (same checks as the cron).
4. Keep the previous symmetric key until every backup encrypted with it has aged out (90-day lifecycle); then delete it from Railway.

## Verification

A restore-test row with `keyFingerprint` matching the public key and `row_counts_match: true`.

## Log

| Date | Environment | Fingerprint | Custodians | Result |
|---|---|---|---|---|
| — | — | — | — | not yet executed (needs production access and two custodians) |
