/**
 * Queues one `measurement_reminder` per live (profile, concept, day, time)
 * slot of the patient's reminder plan (docs_v2/06 P17). Detection only —
 * see ../lib/measurement-reminders.ts; delivery is detect-due-reminders'
 * dispatch pass. Idempotent per slot. Intended schedule: every 5 minutes
 * (`*​/5 * * * *`), inside the 15-minute slot window.
 */
import { detectMeasurementReminders } from "../lib/measurement-reminders";
import { runJob } from "../lib/run-job";

runJob("detect-measurement-reminders", async ({ prisma, log }) => {
  const summary = await detectMeasurementReminders(prisma);
  log.info({ ...summary }, "detect-measurement-reminders completed");
  return { ...summary };
});
