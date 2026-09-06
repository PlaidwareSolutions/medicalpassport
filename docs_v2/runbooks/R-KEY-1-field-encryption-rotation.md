# R-KEY-1 — Field-encryption key rotation

Applies to: `FIELD_ENCRYPTION_KEY` / `FIELD_ENCRYPTION_KEYS` / `FIELD_ENCRYPTION_ACTIVE_KEY_VERSION` on the `api`, `worker`, `cron-*` services. Mechanism: `@medpass/field-crypto` (docs_v2/11 §4). Ciphertexts carry their key version (`k<n>:` prefix; unprefixed = version 1), so decryption keeps working throughout the rotation and no schema change is involved.

Cadence: annually, and immediately on suspected key exposure (docs_v2/12 §6).

## Preconditions

- A verified backup from the last 24 h (`backup_executions` status succeeded, `verify-backups` fresh).
- Every service that decrypts fields is on a build that includes `@medpass/field-crypto` (api, cron `detect-due-reminders`, cron `rotate-field-encryption`). A service still on the single-key helper would fail to read `k2:` ciphertexts — check the deployed commit before starting.
- The person running this has `railway variable set` rights on the target project.

## Procedure

1. Generate the new key material (≥ 32 chars, random):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. Add it to the keyring on **every** service that holds `FIELD_ENCRYPTION_KEY`, without changing the active version yet (dual-accept window):
   ```bash
   printf '2:<new-material>' | railway variable set --stdin --service api FIELD_ENCRYPTION_KEYS
   # repeat for worker and each cron-* service that has FIELD_ENCRYPTION_KEY
   ```
   Redeploy those services. Nothing is rewritten yet; both keys are readable.
3. Switch the active version on the same services:
   ```bash
   printf '2' | railway variable set --stdin --service api FIELD_ENCRYPTION_ACTIVE_KEY_VERSION
   ```
   Redeploy. New writes now use version 2; old rows still decrypt with version 1.
4. Re-encrypt existing rows (idempotent, resumable, logs counts only):
   ```bash
   railway run --service cron-rotate-field-encryption node dist/jobs/rotate-field-encryption.js
   ```
   Expected summary: `users`, `notificationChannels`, `adminUsers` counts and `stillStale: 0`. If `stillStale > 0`, run again; if it persists, a service is writing with a different active version — check step 3.
5. Verify: sign in with a test number (decrypt path), send one reminder to a test channel (cron decrypt path), and confirm `stillStale: 0` on a second run.
6. Retire the old key **only after** a full backup cycle has completed with the rotated data (so a restore never needs a key you no longer hold): remove version 1's material from `FIELD_ENCRYPTION_KEY`? — no: version 1 is always `FIELD_ENCRYPTION_KEY` and stays required by the config schema. Instead replace its value with the *new* material and set `FIELD_ENCRYPTION_KEYS` to include the new key under **both** versions until the next rotation… Simpler and recommended: keep `FIELD_ENCRYPTION_KEY` as the historical version-1 material indefinitely (it decrypts nothing once `stillStale` is 0 and backups have rolled over) and rotate forward with versions 3, 4, … . Record the retirement decision in this runbook's log.

## Rollback

- Before step 4: set `FIELD_ENCRYPTION_ACTIVE_KEY_VERSION` back to `1` and redeploy; nothing was rewritten.
- After step 4: set the active version back to `1` and run the rotation job again — it rewrites `k2:` rows back to version 1 because version 1 is still in the keyring. Never remove a key version that any row or backup may still use.

## Log

| Date | Environment | From → to | Operator | Notes |
|---|---|---|---|---|
| — | dev | 1 → 2 | — | pending: run against a scratch database (the shared local dev DB is also used by the developer's older dev API) |
