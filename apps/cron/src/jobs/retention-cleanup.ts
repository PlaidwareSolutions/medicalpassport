/**
 * Enforces docs/13 scheduled_doses retention (OD-7: dose history 24 months
 * online): deletes materialized scheduled_doses due more than 24 months
 * ago, any status — a row that old is always terminal (reconcile-missed-
 * doses flips stragglers within 15 minutes of the 2h grace). dose_events
 * (the append-only record of what actually happened) and notifications are
 * deliberately KEPT: both FKs are ON DELETE SET NULL, so the DB detaches
 * them automatically and the durable clinical history survives the purge
 * of its materialized scaffolding. docs/13's "then aggregated" is not
 * built here — dose_events already carry patientMedicationId/action/
 * effectiveAt, so aggregation stays possible later. Idempotent; batched so
 * the first backlog run can't hold long locks.
 */
import { runJob } from "../lib/run-job";

const RETENTION_MONTHS = 24;
const BATCH_SIZE = 5000;

runJob("retention-cleanup", async ({ prisma }) => {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);

  let deleted = 0;
  for (;;) {
    const batch = await prisma.scheduledDose.findMany({
      where: { dueAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;
    const result = await prisma.scheduledDose.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
    deleted += result.count;
    if (batch.length < BATCH_SIZE) break;
  }
  return { deleted, cutoff: cutoff.toISOString() };
});
