/**
 * Marks scheduled doses past their due window (+2h grace, or past a snooze)
 * as missed (docs/25 cron schedule; docs/16 missed-dose reconciliation).
 * Idempotent: only touches rows still in "upcoming" status.
 */
import { runJob } from "../lib/run-job";

const GRACE_HOURS = 2;

runJob("reconcile-missed-doses", async ({ prisma, log }) => {
  const cutoff = new Date(Date.now() - GRACE_HOURS * 60 * 60 * 1000);
  const result = await prisma.scheduledDose.updateMany({
    where: {
      status: "upcoming",
      dueAt: { lt: cutoff },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: cutoff } }],
    },
    data: { status: "missed" },
  });
  log.info({ missed: result.count }, "reconciled missed doses");
  return { missed: result.count };
});
