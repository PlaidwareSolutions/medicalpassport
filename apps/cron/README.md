# @medpass/cron

One-shot jobs (docs/25): every entry under `src/jobs/*.ts` is a finite
process — start, do the work idempotently, log a count summary, exit. Railway
runs the scheduled ones from `.railway/railway.ts` / `railway.prod.ts`, each
as its own cron service built from `apps/cron/Dockerfile` with the job file as
the `CMD`.

## Scheduled jobs

See the `cronJob(...)` rows in `.railway/railway.ts` for the live schedule.

## Manual one-shot backfills (V2 Phase 1)

Two jobs are deliberately **not** scheduled: Railway cron has no "never fires"
schedule, and a backfill must run once, by hand, after its migration has been
applied and verified — never on a timer.

| Job | Migration it completes | What it does |
|---|---|---|
| `backfill-provenance` | `v2_provenance_columns` (docs_v2/04 §14 row 5) | Fills `provenanceSource` / `verification` / `recordedVia` on every V1 row of the nine clinical tables plus `patient_allergies` / `patient_conditions` that still has `provenanceSource = null`. `ocr_extracted` for medicines confirmed off an extraction, the V1 `source` column mapped via `LEGACY_RECORD_SOURCE_MAP` where one exists, else `user_entered`; `verification = patient_confirmed`, `recordedVia = pwa`. |
| `backfill-health-events` | `v2_health_events` (docs_v2/04 §9.2, §14 row 4) | Projects `MedicationChange`, `Prescription`, `MedicalReport`, the three readings tables, `CheckupRecord`, `ShareLink`, `PatientAllergy`, `PatientCondition` onto `health_events` through the same projectors the API uses. |

Both are idempotent (re-running touches nothing new), resumable (batches of
500, each committed on its own), and log counts only — never row content.
Run provenance first so the projected events carry the backfilled
`provenanceSource` / `verification`.

Run them from a shell with the target environment's variables, using any of
the existing cron services as the host (they share the image and env):

```sh
# staging
railway run --service cron-verify-audit-chain --environment staging \
  node dist/jobs/backfill-provenance.js
railway run --service cron-verify-audit-chain --environment staging \
  node dist/jobs/backfill-health-events.js

# production — after the staging run's counts have been reviewed
railway run --service cron-verify-audit-chain --environment production \
  node dist/jobs/backfill-provenance.js
railway run --service cron-verify-audit-chain --environment production \
  node dist/jobs/backfill-health-events.js
```

Locally (against `DATABASE_URL`), after `pnpm --filter @medpass/cron build`:

```sh
node apps/cron/dist/jobs/backfill-provenance.js
node apps/cron/dist/jobs/backfill-health-events.js
```

Each run ends with a `job completed` log line carrying per-table counts; a
second run should report zeros for provenance and unchanged event totals.
Record the counts in the migration's rollout note before sunsetting the V1
columns (`v2_provenance_not_null`).

## Tests

`pnpm --filter @medpass/cron test` (vitest). `src/lib/backfills.test.ts` needs
`DATABASE_URL` and is skipped without it; it seeds V1-shaped rows, runs both
backfills twice and asserts they fill the rows and stay idempotent.
