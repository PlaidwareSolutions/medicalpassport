/**
 * One-shot Phase 1 backfill (docs_v2/04 §9.2, §14 row 4): projects every V1
 * clinical row onto the `health_events` timeline through the same projectors
 * the API uses. Not on a Railway schedule — run manually after
 * backfill-provenance (see apps/cron/README.md). Safe to re-run: events are
 * upserted on their unique key.
 */
import { runJob } from "../lib/run-job";
import { backfillHealthEvents } from "../lib/backfill-health-events";

runJob("backfill-health-events", async ({ prisma, log }) => backfillHealthEvents(prisma, log));
