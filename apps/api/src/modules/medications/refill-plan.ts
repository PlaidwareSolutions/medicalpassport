import type { Prisma, PrismaClient } from "@medpass/database";
import { addDaysToDateString, dateStringInTz } from "@medpass/domain";
import { dailySlotQuantity, type SlotDose } from "@medpass/medication-terminology";

/**
 * Refill plan (docs_v2/04 §4.1 `MedicationRefillPlan`) — the successor of
 * the bare `PatientMedication.quantityOnHand` counter, which it keeps in
 * sync in both directions until that column is sunset:
 *
 * - The medication row stays the writer of record for the counter: the
 *   dose-taken decrement (TimelineService), "mark refilled", and a plain
 *   quantity edit all still update `PatientMedication.quantityOnHand`, then
 *   call `syncRefillPlan` so the plan mirrors it and its projection is
 *   recomputed.
 * - `PUT medications/:id/refill-plan` writes the plan first and pushes the
 *   same quantity back onto the medication row.
 *
 * `dailyConsumption` is *derived* from the confirmed instruction and the
 * active schedule (dose × slots per day, spread over the recurrence
 * period); `projectedRunOutOn` is arithmetic on top of it. Both are shown to
 * the patient as a projection of their own numbers, never as advice to buy
 * (docs/07 screen 27, docs/02 principle 3).
 */
type Tx = PrismaClient | Prisma.TransactionClient;

const RECURRENCE_DAYS: Record<string, number> = { daily: 1, weekly: 7, fortnightly: 14, monthly: 30 };

export function computeDailyConsumption(
  instruction: { doseQuantity: unknown } | null | undefined,
  schedule: { slots: unknown; recurrence: string; status: string } | null | undefined,
): number | null {
  if (!instruction || !schedule || schedule.status !== "active") return null;
  const slots = Array.isArray(schedule.slots) ? (schedule.slots as SlotDose[]) : [];
  const perOccurrence = Number(instruction.doseQuantity) * dailySlotQuantity(slots);
  const period = RECURRENCE_DAYS[schedule.recurrence] ?? 1;
  if (!Number.isFinite(perOccurrence) || perOccurrence <= 0) return null;
  return Math.round((perOccurrence / period) * 1000) / 1000;
}

/** The calendar day (in the profile's zone) the supply reaches zero at the derived rate; null when it can't be projected. */
export function projectRunOutOn(quantityOnHand: number | null, dailyConsumption: number | null, timezone: string): string | null {
  if (quantityOnHand == null || dailyConsumption == null || dailyConsumption <= 0) return null;
  const days = Math.floor(quantityOnHand / dailyConsumption);
  return addDaysToDateString(dateStringInTz(timezone), days);
}

export interface RefillPlanView {
  medicationId: string;
  /** False when the patient has never set up a plan — the numbers below are then the medication's own counter only. */
  exists: boolean;
  packSize: string | null;
  quantityOnHand: string | null;
  dailyConsumption: string | null;
  projectedRunOutOn: string | null;
  updatedAt: string | null;
}

function decimalString(v: unknown): string | null {
  return v == null ? null : String(v);
}

async function loadInputs(tx: Tx, medicationId: string) {
  return tx.patientMedication.findUniqueOrThrow({
    where: { id: medicationId },
    select: {
      id: true,
      patientProfileId: true,
      quantityOnHand: true,
      instructions: { where: { supersededAt: null }, take: 1, select: { doseQuantity: true } },
      schedule: { select: { slots: true, recurrence: true, status: true } },
      patientProfile: { select: { timezone: true } },
      refillPlan: true,
    },
  });
}

export async function readRefillPlan(tx: Tx, medicationId: string): Promise<RefillPlanView> {
  const m = await loadInputs(tx, medicationId);
  const quantity = m.quantityOnHand == null ? null : Number(m.quantityOnHand);
  const daily = computeDailyConsumption(m.instructions[0], m.schedule);
  return {
    medicationId: m.id,
    exists: m.refillPlan != null,
    packSize: decimalString(m.refillPlan?.packSize),
    quantityOnHand: decimalString(m.quantityOnHand),
    dailyConsumption: daily == null ? null : String(daily),
    projectedRunOutOn: projectRunOutOn(quantity, daily, m.patientProfile.timezone),
    updatedAt: m.refillPlan?.updatedAt.toISOString() ?? null,
  };
}

/**
 * Mirrors `PatientMedication.quantityOnHand` into the plan and recomputes
 * the projection. No-op when the patient never created a plan (the bare
 * counter is then the only record) unless `create` is set.
 */
export async function syncRefillPlan(
  tx: Tx,
  medicationId: string,
  options: { create?: boolean; packSize?: number | null; recordedByUserId?: string } = {},
): Promise<void> {
  const m = await loadInputs(tx, medicationId);
  if (!m.refillPlan && !options.create) return;
  const quantity = m.quantityOnHand == null ? null : Number(m.quantityOnHand);
  const daily = computeDailyConsumption(m.instructions[0], m.schedule);
  const runOut = projectRunOutOn(quantity, daily, m.patientProfile.timezone);
  const derived = {
    quantityOnHand: m.quantityOnHand,
    dailyConsumption: daily,
    projectedRunOutOn: runOut ? new Date(`${runOut}T00:00:00Z`) : null,
    ...(options.packSize !== undefined ? { packSize: options.packSize } : {}),
    ...(options.recordedByUserId ? { recordedByUserId: options.recordedByUserId } : {}),
  };
  await tx.medicationRefillPlan.upsert({
    where: { patientMedicationId: medicationId },
    create: { patientMedicationId: medicationId, patientProfileId: m.patientProfileId, ...derived },
    update: derived,
  });
}
