/**
 * One-shot Phase 5 backfill (docs_v2/04 §5.3, ADR-V2-011): mirrors the V1
 * glucose / blood-pressure / weight diaries and the metrics embedded in
 * check-up records into the generic `Observation` table. Not on a Railway
 * schedule — run manually (see apps/cron/README.md). Safe to re-run and safe
 * to run while the API is live: the unique `(legacyEntityType, legacyId)`
 * pair makes it idempotent against itself and against the dual-write in the
 * glucose / vitals controllers.
 */
import { runJob } from "../lib/run-job";
import { backfillObservations } from "../lib/backfill-observations";

runJob("backfill-observations", async ({ prisma, log }) => backfillObservations(prisma, log));
