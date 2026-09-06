/**
 * One-shot Phase 1 backfill (docs_v2/04 §14 row 5): fills the provenance
 * block on every V1 clinical row that still has `provenanceSource = null`.
 * Not on a Railway schedule — run manually (see apps/cron/README.md). Safe
 * to re-run: only null rows are touched.
 */
import { runJob } from "../lib/run-job";
import { backfillProvenance } from "../lib/backfill-provenance";

runJob("backfill-provenance", async ({ prisma, log }) => backfillProvenance(prisma, log));
