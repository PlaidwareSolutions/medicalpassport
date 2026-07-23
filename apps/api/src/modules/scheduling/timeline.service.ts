import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { Prisma } from "@medpass/database";
import { ERROR_CODES, type AuditActorType } from "@medpass/domain";
import type { RecordDoseEventInput, RecordPrnDoseEventInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

const SCHEDULE_TIMEZONE_OFFSET = "+05:30"; // matches SchedulingService (docs/16 simplification)

export interface TimelineItem {
  scheduledDoseId: string;
  dueAt: string;
  slotLabel: string;
  quantity: string;
  status: string;
  snoozedUntil: string | null;
  isDueNow: boolean;
  medication: {
    id: string;
    name: string;
    doseUnit: string;
    foodInstruction: string;
  };
}

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-decrements the patient-entered supply snapshot when a dose is
   * actually taken (docs/07 screen 27) — a no-op when the patient hasn't
   * opted into refill tracking (quantityOnHand null) or has no confirmed
   * instruction. Never goes below zero.
   */
  private async decrementQuantityOnHand(
    tx: Prisma.TransactionClient,
    patientMedicationId: string,
    action: string,
  ): Promise<void> {
    if (action !== "taken" && action !== "taken_other_time") return;
    const medication = await tx.patientMedication.findUnique({
      where: { id: patientMedicationId },
      select: {
        quantityOnHand: true,
        instructions: { where: { supersededAt: null }, take: 1, select: { doseQuantity: true } },
      },
    });
    if (medication?.quantityOnHand == null) return;
    const doseQuantity = medication.instructions[0]?.doseQuantity;
    if (doseQuantity == null) return;
    const next = Math.max(0, Number(medication.quantityOnHand) - Number(doseQuantity));
    await tx.patientMedication.update({ where: { id: patientMedicationId }, data: { quantityOnHand: next } });
  }

  async getDay(profileId: string, dateStr: string): Promise<{ date: string; items: TimelineItem[] }> {
    const dayStart = new Date(`${dateStr}T00:00:00${SCHEDULE_TIMEZONE_OFFSET}`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();

    const doses = await this.prisma.scheduledDose.findMany({
      where: {
        dueAt: { gte: dayStart, lt: dayEnd },
        medicationSchedule: {
          status: "active",
          patientMedication: { patientProfileId: profileId, deletedAt: null },
        },
      },
      include: {
        medicationSchedule: {
          include: {
            patientMedication: {
              include: {
                product: { include: { brand: true } },
                instructions: { where: { supersededAt: null }, take: 1 },
              },
            },
          },
        },
      },
      orderBy: { dueAt: "asc" },
    });

    const items: TimelineItem[] = doses.map((d) => {
      const med = d.medicationSchedule.patientMedication;
      const instruction = med.instructions[0];
      const dueNow =
        (d.status === "upcoming" && d.dueAt <= now) ||
        (d.status === "snoozed" && !!d.snoozedUntil && d.snoozedUntil <= now);
      return {
        scheduledDoseId: d.id,
        dueAt: d.dueAt.toISOString(),
        slotLabel: d.slotLabel,
        quantity: String(d.quantity),
        status: d.status,
        snoozedUntil: d.snoozedUntil?.toISOString() ?? null,
        isDueNow: dueNow,
        medication: {
          id: med.id,
          name: med.product?.brand?.name ?? med.enteredName,
          doseUnit: instruction?.doseUnit ?? "",
          foodInstruction: instruction?.foodInstruction ?? "any",
        },
      };
    });

    return { date: dateStr, items };
  }

  async recordDoseEvent(
    profileId: string,
    scheduledDoseId: string,
    input: RecordDoseEventInput,
    actor: { userId: string; actorRole: AuditActorType; correlationId?: string },
  ): Promise<{ id: string; status: string }> {
    const scheduledDose = await this.prisma.scheduledDose.findFirst({
      where: {
        id: scheduledDoseId,
        medicationSchedule: { patientMedication: { patientProfileId: profileId, deletedAt: null } },
      },
      include: {
        medicationSchedule: {
          include: { patientMedication: { include: { patientProfile: { include: { notificationPreference: true } } } } },
        },
      },
    });
    if (!scheduledDose) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Scheduled dose not found", 404);

    if (input.clientMutationId) {
      const existing = await this.prisma.doseEvent.findUnique({ where: { clientMutationId: input.clientMutationId } });
      if (existing) return { id: existing.id, status: scheduledDose.status };
    }

    const effectiveAt = input.effectiveAt ?? new Date();
    const nextStatus = input.action === "snoozed" ? "snoozed" : input.action;

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.doseEvent.create({
        data: {
          scheduledDoseId,
          patientMedicationId: scheduledDose.medicationSchedule.patientMedicationId,
          action: input.action,
          recordedByUserId: actor.userId,
          effectiveAt,
          clientMutationId: input.clientMutationId,
        },
      });
      await tx.scheduledDose.update({
        where: { id: scheduledDoseId },
        data: {
          status: nextStatus,
          snoozedUntil:
            input.action === "snoozed" ? new Date(Date.now() + (input.snoozeMinutes ?? 10) * 60_000) : null,
          rowVersion: { increment: 1 },
        },
      });
      await writeAudit(tx, {
        action: "dose.recorded",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "scheduled_dose",
        entityId: scheduledDoseId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { doseAction: input.action },
      });
      // Dose acknowledgement from any surface resolves every notification
      // tied to this dose (docs/16) — a plain dose_reminder and a
      // caregiver_escalation can both exist for the same scheduledDoseId, so
      // this must resolve all of them, not just the first found.
      const notifications = await tx.notification.findMany({ where: { scheduledDoseId }, include: { attempts: true } });
      let escalationAlreadySent = false;
      for (const notification of notifications) {
        if (notification.kind === "caregiver_escalation" && notification.attempts.some((a) => a.status !== "queued" && a.status !== "failed")) {
          escalationAlreadySent = true;
        }
        await tx.notificationAttempt.updateMany({
          where: { notificationId: notification.id, status: "sent" },
          data: { status: "acknowledged", statusAt: new Date() },
        });
        await tx.notification.update({ where: { id: notification.id }, data: { status: "done" } });
      }

      // A patient correcting a dose that had already been reported missed —
      // and for which a caregiver escalation had genuinely gone out — means
      // that escalation was a false alarm. Tell the same caregivers so they
      // don't keep worrying about a dose that was, in fact, taken (docs/16).
      // Scoped tightly to taken_other_time on a previously-missed dose: a
      // plain "taken" on a still-upcoming dose is the normal happy path and
      // never had an escalation to correct in the first place.
      if (scheduledDose.status === "missed" && input.action === "taken_other_time" && escalationAlreadySent) {
        const dedupeKey = `${scheduledDoseId}:correction`;
        const existingCorrection = await tx.notification.findUnique({ where: { dedupeKey } });
        if (!existingCorrection) {
          const patientMedication = scheduledDose.medicationSchedule.patientMedication;
          await tx.notification.create({
            data: {
              patientProfileId: profileId,
              kind: "dose_correction",
              scheduledDoseId,
              patientMedicationId: patientMedication.id,
              privacyMode: patientMedication.patientProfile.notificationPreference?.privacyMode ?? "generic",
              dedupeKey,
              status: "pending",
            },
          });
          await writeAudit(tx, {
            action: "dose.correction_notice_created",
            actorUserId: actor.userId,
            actorType: actor.actorRole,
            entityType: "scheduled_dose",
            entityId: scheduledDoseId,
            patientProfileId: profileId,
            correlationId: actor.correlationId,
          });
        }
      }

      await this.decrementQuantityOnHand(tx, scheduledDose.medicationSchedule.patientMedicationId, input.action);
      return created;
    });

    return { id: event.id, status: nextStatus };
  }

  async recordPrnDoseEvent(
    profileId: string,
    input: RecordPrnDoseEventInput,
    actor: { userId: string; actorRole: AuditActorType; correlationId?: string },
  ): Promise<{ id: string }> {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id: input.patientMedicationId, patientProfileId: profileId, deletedAt: null },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);
    if (!medication.isPrn) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This medicine is not marked as as-needed (PRN)", 400);
    }

    if (input.clientMutationId) {
      const existing = await this.prisma.doseEvent.findUnique({ where: { clientMutationId: input.clientMutationId } });
      if (existing) return { id: existing.id };
    }

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.doseEvent.create({
        data: {
          patientMedicationId: medication.id,
          action: input.action,
          recordedByUserId: actor.userId,
          effectiveAt: input.effectiveAt ?? new Date(),
          clientMutationId: input.clientMutationId,
        },
      });
      await writeAudit(tx, {
        action: "dose.recorded",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "patient_medication",
        entityId: medication.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { doseAction: input.action, prn: true },
      });
      await this.decrementQuantityOnHand(tx, medication.id, input.action);
      return created;
    });

    return { id: event.id };
  }
}
