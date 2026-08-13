/**
 * Professional-lead retention cleanup (Session 17, docs/landing-page
 * retention-and-erasure.md). Deletes ProfessionalLead rows whose last recorded
 * meaningful interaction (`lastInteractionAt`) is older than 24 calendar
 * months. Deletion is bounded into batches so a large backlog never becomes a
 * single unbounded statement, and is idempotent — a second run simply finds
 * nothing new.
 *
 * Dry run: pass `--dry-run` or set LEAD_RETENTION_DRY_RUN=1 to report the
 * eligible count without deleting anything. Logs are counts only — never
 * email/phone/message/organization contact content (§63).
 */
import { runJob } from "../lib/run-job";
import { LEAD_RETENTION_MONTHS, leadRetentionCutoff } from "../lib/lead-retention";

const BATCH_SIZE = 500;

runJob("cleanup-professional-leads", async ({ prisma, log }) => {
  const dryRun = process.argv.includes("--dry-run") || process.env.LEAD_RETENTION_DRY_RUN === "1";
  const now = new Date();
  const cutoff = leadRetentionCutoff(now);

  // NULL lastInteractionAt is excluded by SQL `< cutoff` semantics (fail-safe),
  // and the column is NOT NULL anyway.
  const eligible = await prisma.professionalLead.count({ where: { lastInteractionAt: { lt: cutoff } } });

  if (dryRun) {
    log.info(
      { dryRun: true, retentionMonths: LEAD_RETENTION_MONTHS, cutoff: cutoff.toISOString(), eligible },
      "lead-retention dry run — no deletions performed",
    );
    return { dryRun: true, eligible, deleted: 0 };
  }

  let deleted = 0;
  for (;;) {
    const batch = await prisma.professionalLead.findMany({
      where: { lastInteractionAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;
    const res = await prisma.professionalLead.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
    deleted += res.count;
    if (batch.length < BATCH_SIZE) break;
  }

  log.info(
    { retentionMonths: LEAD_RETENTION_MONTHS, cutoff: cutoff.toISOString(), eligible, deleted },
    "lead-retention cleanup complete",
  );
  return { eligible, deleted };
});
