/**
 * Detects medicines running low on supply or reaching the end of a fixed
 * course, and queues a `pending` Notification for each (docs/07 screen 27,
 * docs/16 — "refill/completion reminders come from the refill cron").
 * Detection-only, like `detect-due-reminders.ts`'s first pass: this job
 * never sends anything itself — the every-minute `detect-due-reminders`
 * cron already dispatches every still-`pending` Notification (any kind),
 * respecting quiet hours and retrying across ticks, so reusing that pass
 * rather than duplicating recipient-resolution/push-sending here means a
 * notification queued at this job's 6am run is delivered within a minute,
 * deferred correctly if 6am falls inside quiet hours, and never silently
 * dropped.
 *
 * Refill: estimated days of supply = quantityOnHand / (doseQuantity × daily
 * slot count from the medicine's own active schedule) — only computable for
 * auto-schedulable frequencies (the same ones SchedulingService can derive a
 * schedule for) and only for medicines the patient has opted into tracking
 * (quantityOnHand set at all). `REFILL_THRESHOLD_DAYS` is a documented
 * simplification, not a clinical recommendation. Completion: a fixed course
 * (`durationDays` set) whose expected end date has arrived. Both dedupe on
 * `dedupeKey` so a repeat run before the condition changes is a no-op —
 * refill re-fires only if quantityOnHand changes to a new low value (e.g. a
 * partial refill); completion fires exactly once per computed end date.
 */
import { dailySlotQuantity, type SlotDose } from "@medpass/medication-terminology";
import { runJob } from "../lib/run-job";

const REFILL_THRESHOLD_DAYS = 5;

function todayIso(): string {
  // Fixed Asia/Kolkata offset (matches the rest of Stage 4's simplification).
  return new Date(Date.now() + 5.5 * 60 * 60_000).toISOString().slice(0, 10);
}

runJob("generate-refill-reminders", async ({ prisma, log }) => {
  let refillsQueued = 0;
  let completionsQueued = 0;

  // --- Refill: active, non-PRN medicines the patient is tracking supply for. ---
  const trackedMedications = await prisma.patientMedication.findMany({
    where: { status: "current", isPrn: false, deletedAt: null, quantityOnHand: { not: null } },
    include: {
      instructions: { where: { supersededAt: null }, take: 1 },
      schedule: true,
    },
  });

  for (const medication of trackedMedications) {
    const instruction = medication.instructions[0];
    if (!instruction || !medication.schedule || medication.quantityOnHand == null) continue;

    const slots = medication.schedule.slots as unknown as SlotDose[];
    const dailyConsumption = Number(instruction.doseQuantity) * dailySlotQuantity(slots);
    if (dailyConsumption <= 0) continue;

    const daysRemaining = Number(medication.quantityOnHand) / dailyConsumption;
    if (daysRemaining > REFILL_THRESHOLD_DAYS) continue;

    const dedupeKey = `refill:${medication.id}:${medication.quantityOnHand}`;
    const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) continue;

    const pref = await prisma.notificationPreference.findUnique({ where: { patientProfileId: medication.patientProfileId } });
    await prisma.notification.create({
      data: {
        patientProfileId: medication.patientProfileId,
        kind: "refill",
        patientMedicationId: medication.id,
        privacyMode: pref?.privacyMode ?? "generic",
        dedupeKey,
        status: "pending",
      },
    });
    refillsQueued++;
  }

  // --- Completion: fixed-duration courses whose expected end date has arrived. ---
  const today = todayIso();
  const coursesInProgress = await prisma.patientMedication.findMany({
    where: { status: "current", deletedAt: null, startDate: { not: null } },
    include: { instructions: { where: { supersededAt: null }, take: 1 } },
  });

  for (const medication of coursesInProgress) {
    const instruction = medication.instructions[0];
    if (!instruction?.durationDays || !medication.startDate) continue;

    const expectedEnd = new Date(medication.startDate);
    expectedEnd.setUTCDate(expectedEnd.getUTCDate() + instruction.durationDays);
    const expectedEndIso = expectedEnd.toISOString().slice(0, 10);
    if (expectedEndIso > today) continue; // course isn't due to finish yet

    const dedupeKey = `completion:${medication.id}:${expectedEndIso}`;
    const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) continue;

    const pref = await prisma.notificationPreference.findUnique({ where: { patientProfileId: medication.patientProfileId } });
    await prisma.notification.create({
      data: {
        patientProfileId: medication.patientProfileId,
        kind: "completion",
        patientMedicationId: medication.id,
        privacyMode: pref?.privacyMode ?? "generic",
        dedupeKey,
        status: "pending",
      },
    });
    completionsQueued++;
  }

  log.info({ refillsQueued, completionsQueued }, "generate-refill-reminders completed");
  return { refillsQueued, completionsQueued };
});
