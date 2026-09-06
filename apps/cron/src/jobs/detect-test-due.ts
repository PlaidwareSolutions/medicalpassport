/**
 * Queues `test_due` reminders for TestDueSchedule rows whose due date has
 * arrived on the patient's own calendar (docs_v2/05 §12, P17). Detection
 * only — see ../lib/test-due.ts; the every-minute detect-due-reminders
 * pass delivers what this leaves pending, honouring the per-kind
 * channel/frequency control, quiet hours and the daily cap. Idempotent
 * per (schedule, due date). Intended schedule: daily, early morning in
 * IST (`30 2 * * *` UTC — 08:00 IST), so the nudge lands at breakfast.
 */
import { detectTestDue } from "../lib/test-due";
import { runJob } from "../lib/run-job";

runJob("detect-test-due", async ({ prisma, log }) => {
  const summary = await detectTestDue(prisma);
  log.info({ ...summary }, "detect-test-due completed");
  return { ...summary };
});
