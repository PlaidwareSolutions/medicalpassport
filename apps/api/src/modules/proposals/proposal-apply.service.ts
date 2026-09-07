import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { Prisma, PrismaClient, ProviderProposal } from "@medpass/database";
import { emitHealthEvent, localIso } from "@medpass/health-events";
import { dispensedQuantityForSupply } from "@medpass/medication-terminology";
import { initialVerificationFor, type RecordSource, type VerificationState } from "@medpass/provenance";
import {
  proposeDiagnosticReportSchema,
  proposeDischargeSchema,
  proposeDispenseSchema,
  proposeEncounterSchema,
  proposePrescriptionSchema,
  proposeReconciliationSchema,
  type CreateMedicationInput,
  type ProposeDischargeInput,
  type ProposeReconciliationInput,
  type ReconciliationLineInput,
} from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { emitMedicationChangeEvent, profileTimezone } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import type { ProvenanceActor } from "../../common/provenance-actor";
import { parseWith } from "../../common/zod";
import { DiagnosticsService } from "../diagnostics/diagnostics.service";
import { EncountersService } from "../encounters/encounters.service";
import { MedicationsService } from "../medications/medications.service";
import { syncRefillPlan } from "../medications/refill-plan";
import { PractitionersService } from "../practitioners/practitioners.service";
import { PrescriptionsService } from "../prescriptions/prescriptions.service";
import { SchedulingService } from "../scheduling/scheduling.service";

type Tx = PrismaClient | Prisma.TransactionClient;

export interface AcceptContext {
  userId: string;
  actorRole: "patient" | "caregiver";
  recordedVia?: string;
  correlationId?: string;
  organization: { id: string; displayName: string; kind: string };
  /** Indexes into `lines` the patient declined (H-43: per-line confirmation). */
  declinedLines: ReadonlySet<number>;
}

export interface AppliedResult {
  entityType: string;
  entityId: string;
  /** Anything the inbox wants to show ("3 medicines started, 1 stopped"). */
  summary: Record<string, unknown>;
}

/**
 * Provenance the accepted rows carry (ADR-V2-009, ADR-V2-002): the
 * organization's source at the verification its actor kind earns — a clinic
 * or pharmacy is `provider_verified`, a laboratory `source_authenticated`.
 * `RecordSource` has no hospital value; a hospital's rows are
 * `clinic_entered` with the organization id alongside.
 */
export function provenanceForOrganization(kind: string): { source: RecordSource; verification: VerificationState } {
  switch (kind) {
    case "pharmacy":
      return { source: "pharmacy_entered", verification: initialVerificationFor("pharmacy_entered", "provider_organization") };
    case "laboratory":
    case "diagnostic_centre":
      return { source: "lab_imported", verification: initialVerificationFor("lab_imported", "lab_system") };
    default:
      return { source: "clinic_entered", verification: initialVerificationFor("clinic_entered", "provider_organization") };
  }
}

const LINE_DECISION = { START: "add", CONTINUE: "continue", CHANGE: "change", STOP: "stop" } as const;

/**
 * Applies an accepted proposal to the clinical tables through the existing
 * services (medications, prescriptions, encounters, diagnostics), so every
 * audit row, HealthEvent, schedule regeneration, safety review and
 * caregiver notification those services already produce happens here too.
 * Nothing in this file runs before the patient's accept.
 */
@Injectable()
export class ProposalApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly medications: MedicationsService,
    private readonly prescriptions: PrescriptionsService,
    private readonly encounters: EncountersService,
    private readonly diagnostics: DiagnosticsService,
    private readonly practitioners: PractitionersService,
    private readonly scheduling: SchedulingService,
  ) {}

  async apply(proposal: ProviderProposal, ctx: AcceptContext): Promise<AppliedResult> {
    const profileId = proposal.patientProfileId;
    switch (proposal.kind) {
      case "prescription":
        return this.applyPrescription(profileId, proposal, ctx);
      case "encounter":
        return this.applyEncounter(profileId, proposal, ctx);
      case "reconciliation":
        return this.applyReconciliation(profileId, proposal, ctx);
      case "dispense":
        return this.applyDispense(profileId, proposal, ctx);
      case "diagnostic_report":
        return this.applyDiagnosticReport(profileId, proposal, ctx);
      case "discharge_transition":
        return this.applyDischarge(profileId, proposal, ctx);
      default:
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown proposal kind", 400);
    }
  }

  private actor(ctx: AcceptContext): ProvenanceActor & { correlationId?: string } {
    return {
      userId: ctx.userId,
      actorRole: ctx.actorRole,
      recordedVia: ctx.recordedVia,
      correlationId: ctx.correlationId,
      provenance: provenanceForOrganization(ctx.organization.kind),
    };
  }

  // ───────────────────────── prescription ─────────────────────────

  private async applyPrescription(profileId: string, proposal: ProviderProposal, ctx: AcceptContext): Promise<AppliedResult> {
    const payload = parseWith(proposePrescriptionSchema, proposal.payload);
    const created = await this.prescriptions.create(profileId, { ...payload, encounterId: null }, this.actor(ctx));
    await this.prisma.$transaction(async (tx) => {
      await tx.prescription.update({ where: { id: created.id }, data: { sourceOrganizationId: ctx.organization.id } });
      await tx.prescriptionItem.updateMany({ where: { prescriptionId: created.id }, data: { sourceOrganizationId: ctx.organization.id } });
      if (payload.followUpOn) await this.scheduleFollowUp(tx, profileId, payload.followUpOn, ctx, created.id);
    });
    return { entityType: "prescription", entityId: created.id, summary: { items: payload.items.length } };
  }

  // ───────────────────────── encounter ─────────────────────────

  private async applyEncounter(profileId: string, proposal: ProviderProposal, ctx: AcceptContext): Promise<AppliedResult> {
    const payload = parseWith(proposeEncounterSchema, proposal.payload);
    const practitionerId = await this.prisma.$transaction((tx) => this.practitioners.resolve(tx, profileId, payload.practitionerName));
    const created = await this.encounters.create(
      profileId,
      {
        kind: payload.kind,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt ?? null,
        organizationId: ctx.organization.id,
        practitionerId,
        reasonText: payload.reasonText ?? null,
        diagnosisText: payload.diagnosisText ?? null,
        notes: payload.notes ?? null,
      },
      this.actor(ctx),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.encounter.update({ where: { id: created.id }, data: { sourceOrganizationId: ctx.organization.id } });
      if (payload.followUpOn) await this.scheduleFollowUp(tx, profileId, payload.followUpOn, ctx);
    });
    return { entityType: "encounter", entityId: created.id, summary: { kind: payload.kind, followUpOn: payload.followUpOn ?? null } };
  }

  // ───────────────────────── reconciliation ─────────────────────────

  private async applyReconciliation(profileId: string, proposal: ProviderProposal, ctx: AcceptContext): Promise<AppliedResult> {
    const payload = parseWith(proposeReconciliationSchema, proposal.payload);
    const { reconciliationId, counts } = await this.applyLines(profileId, proposal, payload, ctx, null);
    return { entityType: "medication_reconciliation", entityId: reconciliationId, summary: counts };
  }

  /**
   * Creates the `MedicationReconciliation` (+ lines with their per-line
   * decision) and applies each accepted line. Hazard H-34: a STOP line only
   * ever stops; a medicine becomes or stays current *only* through an
   * explicit START / CONTINUE / CHANGE — there is no other path from a
   * transition record into the current medicines list.
   */
  private async applyLines(
    profileId: string,
    proposal: ProviderProposal,
    payload: ProposeReconciliationInput | ProposeDischargeInput,
    ctx: AcceptContext,
    encounterId: string | null,
  ): Promise<{ reconciliationId: string; counts: Record<string, number> }> {
    const now = new Date();
    const reconciliation = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.medicationReconciliation.create({
        data: {
          patientProfileId: profileId,
          encounterId,
          organizationId: ctx.organization.id,
          performedByUserId: proposal.proposedByUserId,
          performedAt: proposal.createdAt,
          status: "patient_accepted",
          decidedByUserId: ctx.userId,
          decidedAt: now,
          notes: (payload as { notes?: string | null }).notes ?? (payload as { summaryText?: string | null }).summaryText ?? null,
        },
      });
      const lines = [];
      for (const [index, line] of payload.lines.entries()) {
        lines.push(
          await tx.medicationReconciliationLine.create({
            data: {
              reconciliationId: rec.id,
              patientMedicationId: line.patientMedicationId ?? null,
              decision: LINE_DECISION[line.decision],
              proposedInstruction: line.proposedInstruction ? (line.proposedInstruction as object) : undefined,
              proposedName: line.proposedName ?? null,
              reasonText: line.reasonText ?? null,
              accepted: !ctx.declinedLines.has(index),
            },
          }),
        );
      }
      return { ...rec, lines };
    });

    const counts = { started: 0, continued: 0, changed: 0, stopped: 0, declined: 0 };
    const actor = this.actor(ctx);
    for (const [index, line] of payload.lines.entries()) {
      const row = reconciliation.lines[index]!;
      if (ctx.declinedLines.has(index)) {
        counts.declined += 1;
        continue;
      }
      switch (line.decision) {
        case "START": {
          const medicationId = await this.startMedication(profileId, line, payload.practitionerName, ctx);
          await this.prisma.medicationReconciliationLine.update({ where: { id: row.id }, data: { patientMedicationId: medicationId } });
          counts.started += 1;
          break;
        }
        case "CONTINUE": {
          const medication = await this.requireMedication(profileId, line.patientMedicationId!);
          await this.prisma.$transaction(async (tx) => {
            const change = await tx.medicationChange.create({
              data: {
                patientMedicationId: medication.id,
                change: "reconciled_continue",
                detail: { reconciliationId: reconciliation.id, lineId: row.id, organizationId: ctx.organization.id },
                actorUserId: ctx.userId,
              },
            });
            await emitMedicationChangeEvent(tx, { profileId, actorType: ctx.actorRole, medication, change });
          });
          counts.continued += 1;
          break;
        }
        case "CHANGE": {
          const medication = await this.requireMedication(profileId, line.patientMedicationId!);
          await this.medications.update(profileId, medication.id, { rowVersion: medication.rowVersion, instruction: line.proposedInstruction! }, actor);
          counts.changed += 1;
          break;
        }
        case "STOP": {
          await this.stopMedication(profileId, line, reconciliation.id, row.id, ctx);
          counts.stopped += 1;
          break;
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.medicationReconciliation.update({ where: { id: reconciliation.id }, data: { status: "applied", appliedAt: new Date() } });
      const timezone = await profileTimezone(tx, profileId);
      await emitHealthEvent(tx, {
        patientProfileId: profileId,
        kind: "reconciliation",
        entityType: "medication_reconciliation",
        entityId: reconciliation.id,
        occurredAt: now,
        occurredAtLocal: localIso(now, timezone),
        summary: { organizationName: ctx.organization.displayName, ...counts },
        encounterId,
        actorUserId: ctx.userId,
        actorType: ctx.actorRole,
        provenanceSource: actor.provenance!.source,
        verification: actor.provenance!.verification,
      });
    });
    return { reconciliationId: reconciliation.id, counts };
  }

  private async startMedication(
    profileId: string,
    line: ReconciliationLineInput,
    prescriberName: string | undefined,
    ctx: AcceptContext,
  ): Promise<string> {
    const input: CreateMedicationInput = {
      enteredName: line.proposedName!,
      productId: line.productId ?? undefined,
      source: line.productId ? "search" : "manual",
      patientReason: line.reasonText ?? undefined,
      prescriberName,
      isPrn: false,
      criticalEscalation: false,
      instruction: line.proposedInstruction!,
    };
    const created = await this.medications.create(profileId, input, this.actor(ctx));
    await this.prisma.patientMedication.update({ where: { id: created.id }, data: { sourceOrganizationId: ctx.organization.id } });
    return created.id;
  }

  /**
   * STOP: the medicine leaves "current" the same way the patient's own
   * status change does (status row, `reconciled_stop` change, timeline
   * event, reminders cancelled, future doses withdrawn) — and never any
   * other way. A medicine already stopped or completed is left as it is.
   */
  private async stopMedication(profileId: string, line: ReconciliationLineInput, reconciliationId: string, lineId: string, ctx: AcceptContext) {
    const medication = await this.requireMedication(profileId, line.patientMedicationId!);
    if (medication.status === "stopped" || medication.status === "completed") return;
    await this.prisma.$transaction(async (tx) => {
      await tx.patientMedication.update({
        where: { id: medication.id },
        data: {
          status: "stopped",
          statusChangedAt: new Date(),
          statusReason: line.reasonText ?? `Stopped at ${ctx.organization.displayName}`,
          rowVersion: { increment: 1 },
        },
      });
      const change = await tx.medicationChange.create({
        data: {
          patientMedicationId: medication.id,
          change: "reconciled_stop",
          detail: { from: medication.status, to: "stopped", reason: line.reasonText ?? null, reconciliationId, lineId, organizationId: ctx.organization.id },
          actorUserId: ctx.userId,
        },
      });
      await emitMedicationChangeEvent(tx, { profileId, actorType: ctx.actorRole, medication, change });
      await writeAudit(tx, {
        action: "medication.status_changed",
        actorUserId: ctx.userId,
        actorType: ctx.actorRole,
        entityType: "patient_medication",
        entityId: medication.id,
        patientProfileId: profileId,
        correlationId: ctx.correlationId,
        context: { from: medication.status, to: "stopped", via: "reconciliation", organizationId: ctx.organization.id },
      });
      await tx.notification.updateMany({
        where: { patientMedicationId: medication.id, kind: { in: ["refill", "completion"] }, status: { in: ["pending", "done"] } },
        data: { status: "cancelled" },
      });
    });
    await this.scheduling.cancelFutureUpcomingDoses(medication.id);
    await this.scheduling.setScheduleStatus(medication.id, "ended");
  }

  private async requireMedication(profileId: string, id: string) {
    const medication = await this.prisma.patientMedication.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    if (!medication) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "A medicine this proposal refers to no longer exists", 400, [
        { path: "lines.patientMedicationId", message: "Medicine not found" },
      ]);
    }
    return medication;
  }

  // ───────────────────────── dispense ─────────────────────────

  private async applyDispense(profileId: string, proposal: ProviderProposal, ctx: AcceptContext): Promise<AppliedResult> {
    const payload = parseWith(proposeDispenseSchema, proposal.payload);
    const actor = this.actor(ctx);
    const medication = payload.patientMedicationId ? await this.requireMedication(profileId, payload.patientMedicationId) : null;
    // `ProposalsService.create` already refused a unit the patient does not
    // count in, but a medicine's instruction can be edited between the
    // proposal and the accept. Re-check here and, on a mismatch, record the
    // dispense as the fact it is while leaving the supply counter alone —
    // never mix "30 strip" into a counter denominated in tablets (H-…,
    // docs_v2/10: the refill projection is patient-facing).
    const supply = medication
      ? dispensedQuantityForSupply({
          quantity: payload.quantity,
          dispenseUnit: payload.unit,
          trackedUnit: (
            await this.prisma.medicationInstruction.findFirst({
              where: { patientMedicationId: medication.id, supersededAt: null },
              select: { doseUnit: true },
            })
          )?.doseUnit,
        })
      : null;
    const dispense = await this.prisma.$transaction(async (tx) => {
      const row = await tx.medicationDispense.create({
        data: {
          patientProfileId: profileId,
          patientMedicationId: medication?.id ?? null,
          organizationId: ctx.organization.id,
          dispensedAt: payload.dispensedAt,
          quantity: payload.quantity,
          unit: payload.unit,
          daysSupply: payload.daysSupply ?? null,
          lotNumber: payload.lotNumber ?? null,
          expiryDate: payload.expiryDate ?? null,
          notes: payload.notes ?? null,
          provenanceSource: actor.provenance!.source,
          verification: actor.provenance!.verification,
          recordedVia: actor.recordedVia ?? "pwa",
          recordedByUserId: ctx.userId,
          sourceOrganizationId: ctx.organization.id,
        },
      });
      if (medication && supply?.ok) {
        // A dispense is a refill: the supply counter grows by what was
        // handed over, and the refill plan (docs_v2/06 P12 "refill
        // prediction from dispenses") is created or re-projected from it.
        const quantityOnHand = Number(medication.quantityOnHand ?? 0) + supply.quantity;
        await tx.patientMedication.update({
          where: { id: medication.id },
          data: { quantityOnHand, rowVersion: { increment: 1 }, sourceOrganizationId: medication.sourceOrganizationId ?? ctx.organization.id },
        });
        await syncRefillPlan(tx, medication.id, { create: true, recordedByUserId: ctx.userId });
        const change = await tx.medicationChange.create({
          data: {
            patientMedicationId: medication.id,
            change: "refilled",
            detail: { quantityOnHand, dispenseId: row.id, organizationId: ctx.organization.id },
            actorUserId: ctx.userId,
          },
        });
        await emitMedicationChangeEvent(tx, { profileId, actorType: ctx.actorRole, medication, change });
        await tx.notification.updateMany({
          where: { patientMedicationId: medication.id, kind: "refill", status: { in: ["pending", "done"] } },
          data: { status: "cancelled" },
        });
      }
      const timezone = await profileTimezone(tx, profileId);
      await emitHealthEvent(tx, {
        patientProfileId: profileId,
        kind: "dispense",
        entityType: "medication_dispense",
        entityId: row.id,
        occurredAt: payload.dispensedAt,
        occurredAtLocal: localIso(payload.dispensedAt, timezone),
        summary: {
          organizationName: ctx.organization.displayName,
          medicineName: medication?.enteredName ?? payload.medicineName,
          medicationId: medication?.id ?? null,
          quantity: payload.quantity,
          unit: payload.unit,
          daysSupply: payload.daysSupply ?? null,
        },
        actorUserId: ctx.userId,
        actorType: ctx.actorRole,
        provenanceSource: actor.provenance!.source,
        verification: actor.provenance!.verification,
      });
      return row;
    });
    return {
      entityType: "medication_dispense",
      entityId: dispense.id,
      summary: {
        medicationId: medication?.id ?? null,
        quantity: payload.quantity,
        unit: payload.unit,
        /** False when the unit no longer matches what the patient counts in — the dispense is kept, the supply is not touched. */
        supplyUpdated: Boolean(medication && supply?.ok),
      },
    };
  }

  // ───────────────────────── diagnostic report ─────────────────────────

  private async applyDiagnosticReport(profileId: string, proposal: ProviderProposal, ctx: AcceptContext): Promise<AppliedResult> {
    const payload = parseWith(proposeDiagnosticReportSchema, proposal.payload);
    const actor = this.actor(ctx);
    const { results, ...report } = payload;
    // A laboratory proposal carries "Reported on" and "Sample collected on";
    // `testedAt` is the V1 display date and is the one the patient's list
    // and every date filter read, so leaving it unset showed "Date not
    // recorded" on a report that plainly had dates on it. The collection
    // date is preferred: it is when the value in the row was true of the
    // patient, which is what a clinician reads the date for. The report
    // date is the fallback — a report is never issued before its sample.
    const testedAt = report.testedAt ?? report.specimenCollectedAt ?? report.reportedAt;
    const created = await this.diagnostics.create(
      profileId,
      { ...report, testedAt, organizationId: ctx.organization.id, facilityNameText: report.facilityNameText ?? ctx.organization.displayName },
      actor,
    );
    for (const result of results) await this.diagnostics.addResult(profileId, created.id, result, actor);
    await this.prisma.$transaction(async (tx) => {
      await tx.diagnosticReport.update({ where: { id: created.id }, data: { sourceOrganizationId: ctx.organization.id } });
      await tx.diagnosticResult.updateMany({ where: { diagnosticReportId: created.id }, data: { sourceOrganizationId: ctx.organization.id } });
    });
    return { entityType: "diagnostic_report", entityId: created.id, summary: { results: results.length, title: report.title } };
  }

  // ───────────────────────── discharge ─────────────────────────

  private async applyDischarge(profileId: string, proposal: ProviderProposal, ctx: AcceptContext): Promise<AppliedResult> {
    const payload = parseWith(proposeDischargeSchema, proposal.payload);
    const actor = this.actor(ctx);
    const practitionerId = await this.prisma.$transaction((tx) => this.practitioners.resolve(tx, profileId, payload.practitionerName));
    const encounter = await this.encounters.create(
      profileId,
      {
        kind: "inpatient",
        startedAt: payload.admittedAt,
        endedAt: payload.dischargedAt,
        organizationId: ctx.organization.id,
        practitionerId,
        reasonText: null,
        diagnosisText: payload.diagnosisText ?? null,
        notes: payload.summaryText ?? null,
      },
      actor,
    );
    await this.prisma.encounter.update({ where: { id: encounter.id }, data: { sourceOrganizationId: ctx.organization.id } });

    const { reconciliationId, counts } = await this.applyLines(profileId, proposal, payload, ctx, encounter.id);

    await this.prisma.$transaction(async (tx) => {
      if (payload.followUpOn) await this.scheduleFollowUp(tx, profileId, payload.followUpOn, ctx);
      const timezone = await profileTimezone(tx, profileId);
      await emitHealthEvent(tx, {
        patientProfileId: profileId,
        kind: "discharge",
        entityType: "encounter",
        entityId: encounter.id,
        occurredAt: payload.dischargedAt,
        occurredAtLocal: localIso(payload.dischargedAt, timezone),
        summary: {
          organizationName: ctx.organization.displayName,
          diagnosisText: payload.diagnosisText ?? null,
          reconciliationId,
          followUpOn: payload.followUpOn ? payload.followUpOn.toISOString().slice(0, 10) : null,
          ...counts,
        },
        encounterId: encounter.id,
        actorUserId: ctx.userId,
        actorType: ctx.actorRole,
        provenanceSource: actor.provenance!.source,
        verification: actor.provenance!.verification,
      });
    });
    return { entityType: "encounter", entityId: encounter.id, summary: { reconciliationId, ...counts } };
  }

  // ───────────────────────── follow-up reminders ─────────────────────────

  /**
   * "Come back on the 20th" becomes a `TestDueSchedule` row with
   * `diagnosticKind = follow_up` (docs_v2/06 P11-4 follow-up reminders).
   * `Notification` has a `follow_up` kind but no due date and is dispatched
   * by the every-minute cron as soon as it exists, so a date-driven record
   * is the honest carrier; the P17 test-due cron turns it into a
   * notification when the day comes.
   */
  private async scheduleFollowUp(tx: Tx, profileId: string, dueOn: Date, ctx: AcceptContext, sourcePrescriptionId?: string): Promise<void> {
    await tx.testDueSchedule.create({
      data: {
        patientProfileId: profileId,
        diagnosticKind: "follow_up",
        label: `Follow-up visit — ${ctx.organization.displayName}`,
        dueOn,
        sourcePrescriptionId: sourcePrescriptionId ?? null,
        recordedByUserId: ctx.userId,
        status: "pending",
      },
    });
  }
}
