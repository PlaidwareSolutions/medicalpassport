/**
 * `refill_low` (docs_v2/06 P6-4): the caregiver twin of the patient's own
 * `refill` reminder, driven by the V2 refill plan rather than the bare
 * quantity counter. A plan whose `projectedRunOutOn` falls within
 * `REFILL_LOW_DAYS` of today queues one pending notification per projected
 * date — a changed projection (a refill, a dose change) mints a new key and
 * supersedes the old row, exactly like the patient-facing refill rule in
 * generate-refill-reminders.ts. Recipients (caregivers holding a scope that
 * grants `view_medications`) are resolved at dispatch time.
 */
import { addDaysToDateString, dateStringInTz } from "@medpass/domain";
import type { PrismaClient } from "@medpass/database";

export const REFILL_LOW_DAYS = 5;

export async function queueRefillLowReminders(prisma: PrismaClient, options: { now?: Date } = {}): Promise<{ queued: number }> {
  const now = options.now ?? new Date();
  let queued = 0;

  const plans = await prisma.medicationRefillPlan.findMany({
    where: {
      projectedRunOutOn: { not: null },
      patientMedication: { status: "current", isPrn: false, deletedAt: null },
    },
    include: { patientMedication: { include: { patientProfile: { include: { notificationPreference: true } } } } },
  });

  for (const plan of plans) {
    const profile = plan.patientMedication.patientProfile;
    // "Within 5 days" is judged on the patient's own calendar, the same
    // zone the projection itself was computed in (refill-plan.ts).
    const horizon = addDaysToDateString(dateStringInTz(profile.timezone, now), REFILL_LOW_DAYS);
    const runOut = plan.projectedRunOutOn!.toISOString().slice(0, 10);
    if (runOut > horizon) continue;

    const dedupeKey = `refill_low:${plan.patientMedicationId}:${runOut}`;
    const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) continue;

    await prisma.$transaction([
      prisma.notification.updateMany({
        where: { patientMedicationId: plan.patientMedicationId, kind: "refill_low", status: { in: ["pending", "done"] } },
        data: { status: "cancelled" },
      }),
      prisma.notification.create({
        data: {
          patientProfileId: profile.id,
          kind: "refill_low",
          patientMedicationId: plan.patientMedicationId,
          privacyMode: profile.notificationPreference?.privacyMode ?? "generic",
          dedupeKey,
          status: "pending",
        },
      }),
    ]);
    queued++;
  }

  return { queued };
}
