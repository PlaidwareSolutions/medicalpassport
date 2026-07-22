/**
 * Daily operational report (docs/21 "Operational reports (cron)": job
 * failures, DLQ contents, reminder pipeline summary, backup status). No new
 * observability vendor needed — this is exactly what's already achievable
 * with structured logs + the data this app already records: one daily,
 * clearly-labeled log line per section that Railway's own log viewer
 * already surfaces, standing in for OD-13's still-open real OTLP backend.
 */
import { runJob } from "../lib/run-job";

const WINDOW_HOURS = 24;

runJob("operational-report", async ({ prisma, log }) => {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  const [failedJobs, dlqAddedToday, dlqOutstanding, attemptsByStatus, latestBackup, latestRestoreTest] = await Promise.all([
    prisma.backgroundJob.count({ where: { status: "failed", completedAt: { gte: since } } }),
    prisma.deadLetterJob.count({ where: { failedAt: { gte: since } } }),
    prisma.deadLetterJob.count({ where: { replayedAt: null } }),
    prisma.notificationAttempt.groupBy({ by: ["channel", "status"], where: { attemptedAt: { gte: since } }, _count: true }),
    prisma.backupExecution.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.restoreTest.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  const reminderPipeline = attemptsByStatus.reduce<Record<string, number>>((acc, row) => {
    acc[`${row.channel}_${row.status}`] = row._count;
    return acc;
  }, {});

  const summary = {
    windowHours: WINDOW_HOURS,
    jobFailuresLast24h: failedJobs,
    dlqAddedLast24h: dlqAddedToday,
    dlqOutstanding,
    reminderPipeline,
    latestBackup: latestBackup ? { id: latestBackup.id, status: latestBackup.status, completedAt: latestBackup.completedAt } : null,
    latestRestoreTest: latestRestoreTest
      ? { id: latestRestoreTest.id, status: latestRestoreTest.status, completedAt: latestRestoreTest.completedAt }
      : null,
  };

  // One line, clearly labeled, easy to grep/alert on in Railway's log viewer
  // (docs/21's alert conditions — DLQ>0 sustained, backup/restore failure —
  // are exactly what this line's own fields let a human or a future real
  // OTLP backend check).
  log.info(summary, "daily operational report");

  if (dlqOutstanding > 0) log.warn({ dlqOutstanding }, "DLQ has outstanding unreplayed jobs");
  if (latestBackup?.status !== "succeeded") log.error({ latestBackup }, "latest backup did not succeed");
  if (latestRestoreTest && latestRestoreTest.status === "failed") log.error({ latestRestoreTest }, "latest restore test failed");

  return summary;
});
