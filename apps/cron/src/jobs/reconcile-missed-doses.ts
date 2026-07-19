/**
 * Marks scheduled doses past their due window (+2h grace, or past a snooze)
 * as missed (docs/25 cron schedule; docs/16 missed-dose reconciliation), and
 * detects the caregiver-escalation case: for each dose that just became
 * missed, if the patient has at least one caregiver holding
 * `manage_reminders`/`full_management` scope, creates a `pending`
 * `caregiver_escalation` Notification (status/dispatch handled by
 * detect-due-reminders.ts's shared Pass 2, same as every other kind).
 * Idempotent: only touches rows still in "upcoming" status, and the
 * escalation Notification is deduped on `dedupeKey` so a restart or an
 * overlapping run can never double-create one for the same dose.
 *
 * No caregiver with the right scope means no one to escalate to — nothing is
 * created in that case, matching how `resolveRecipients` returning empty is
 * handled everywhere else in the reminder system.
 */
import { runJob } from "../lib/run-job";

const GRACE_HOURS = 2;

runJob("reconcile-missed-doses", async ({ prisma, log }) => {
  const cutoff = new Date(Date.now() - GRACE_HOURS * 60 * 60 * 1000);
  const toMiss = await prisma.scheduledDose.findMany({
    where: {
      status: "upcoming",
      dueAt: { lt: cutoff },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: cutoff } }],
    },
    include: {
      medicationSchedule: {
        include: { patientMedication: { include: { patientProfile: { include: { notificationPreference: true } } } } },
      },
    },
  });

  if (toMiss.length === 0) {
    log.info({ missed: 0, escalated: 0 }, "reconciled missed doses");
    return { missed: 0, escalated: 0 };
  }

  await prisma.scheduledDose.updateMany({
    where: { id: { in: toMiss.map((d) => d.id) } },
    data: { status: "missed" },
  });

  let escalated = 0;
  for (const dose of toMiss) {
    const patientMedication = dose.medicationSchedule.patientMedication;
    const profile = patientMedication.patientProfile;
    const dedupeKey = `${dose.id}:escalation`;
    const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) continue;

    const hasCaregiver = await prisma.caregiverRelationship.findFirst({
      where: {
        patientProfileId: profile.id,
        status: "active",
        caregiverUserId: { not: null },
        permissions: { some: { scope: { in: ["manage_reminders", "full_management"] }, revokedAt: null } },
      },
      select: { id: true },
    });
    if (!hasCaregiver) continue;

    await prisma.notification.create({
      data: {
        patientProfileId: profile.id,
        kind: "caregiver_escalation",
        scheduledDoseId: dose.id,
        patientMedicationId: patientMedication.id,
        privacyMode: profile.notificationPreference?.privacyMode ?? "generic",
        dedupeKey,
        status: "pending",
      },
    });
    escalated++;
  }

  log.info({ missed: toMiss.length, escalated }, "reconciled missed doses");
  return { missed: toMiss.length, escalated };
});
