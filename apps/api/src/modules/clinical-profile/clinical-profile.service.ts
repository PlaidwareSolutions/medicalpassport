import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, type AuditAction } from "@medpass/domain";
import {
  emitHealthEvent,
  projectAllergy,
  projectCondition,
  projectImmunization,
  projectProcedure,
  supersedeHealthEvents,
  type HealthEventInput,
} from "@medpass/health-events";
import type {
  AllergyInput,
  ConditionInput,
  CreateEmergencyContactInput,
  CreateFamilyHistoryInput,
  CreateImmunizationInput,
  CreateProcedureInput,
  UpdateAllergyInput,
  UpdateConditionInput,
  UpdateEmergencyContactInput,
  UpdateFamilyHistoryInput,
  UpdateImmunizationInput,
  UpdateProcedureInput,
} from "@medpass/validation";
import { decryptField, encryptField } from "../../common/crypto";
import { ApiProblem } from "../../common/errors";
import { eventCtx } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import { restampProvenance, type ProvenanceStamp } from "../../common/provenance";
import { SafetyEvaluationService } from "../safety/safety-evaluation.service";

/** Who is writing, on whose behalf, with which server-stamped provenance. */
export interface ClinicalWriteContext {
  profileId: string;
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
  provenance: ProvenanceStamp;
}

type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/** `YYYY-MM-DD` → UTC-midnight `Date` (the `@db.Date` storage form); `undefined` leaves the column untouched. */
function dateField(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(`${value}T00:00:00Z`);
}

/** `@db.Date` columns back to `YYYY-MM-DD` for the wire. */
function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * The V2 Phase 1 clinical profile (docs_v2/04 §10, docs_v2/05 §2): allergies,
 * conditions, immunizations, procedures, family history, emergency contacts.
 *
 * Every write runs in one transaction with its audit row and — for the four
 * kinds that appear on the timeline — its HealthEvent (ADR-V2-008). Every row
 * carries server-stamped provenance (ADR-V2-002); an edit re-stamps the
 * editor as source/channel/recorder but never lowers `verification`.
 * Soft-deletes supersede the row's events; edits supersede then re-emit.
 */
@Injectable()
export class ClinicalProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyEvaluationService,
  ) {}

  // ───────────────────────── Allergies ─────────────────────────

  async listAllergies(profileId: string) {
    const rows = await this.prisma.patientAllergy.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(presentAllergy);
  }

  async createAllergy(ctx: ClinicalWriteContext, input: AllergyInput) {
    // Exact/synonym name match against the controlled ingredient vocabulary
    // only — never a fuzzy guess (docs/09 §6 "never silently interpret").
    // No match just means no drug-allergy check is possible for this entry;
    // it is never fabricated.
    const matchedIngredient = await this.matchIngredient(input.label);
    const { onsetDate, ...rest } = input;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.patientAllergy.create({
        data: {
          ...rest,
          onsetDate: dateField(onsetDate),
          allergenIngredientId: matchedIngredient?.id,
          patientProfileId: ctx.profileId,
          ...ctx.provenance,
        },
      });
      const events = await eventCtx(tx, ctx.profileId, ctx);
      await emitHealthEvent(tx, projectAllergy(events, row));
      await this.audit(tx, ctx, "allergy.created", "patient_allergy", row.id, { matchedIngredient: Boolean(matchedIngredient) });
      return row;
    });
    // Allergy changes trigger safety re-evaluation (docs/09).
    await this.safety.evaluate(ctx.profileId, "allergy_added");
    return presentAllergy(created);
  }

  async updateAllergy(ctx: ClinicalWriteContext, id: string, input: UpdateAllergyInput) {
    const existing = await this.prisma.patientAllergy.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Allergy not found", 404);
    const { onsetDate, label, ...rest } = input;
    // A renamed allergen is re-matched; an unchanged label keeps its link.
    const matchedIngredient = label !== undefined && label !== existing.label ? await this.matchIngredient(label) : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.patientAllergy.update({
        where: { id },
        data: {
          ...rest,
          ...(label !== undefined ? { label } : {}),
          ...(matchedIngredient !== undefined ? { allergenIngredientId: matchedIngredient?.id ?? null } : {}),
          onsetDate: dateField(onsetDate),
          ...restampProvenance(existing.verification, ctx.provenance),
        },
      });
      await this.reproject(tx, ctx, "patient_allergy", row.id, projectAllergy(await eventCtx(tx, ctx.profileId, ctx), row));
      await this.audit(tx, ctx, "allergy.updated", "patient_allergy", row.id, { fields: Object.keys(input) });
      return row;
    });
    await this.safety.evaluate(ctx.profileId, "allergy_updated");
    return presentAllergy(updated);
  }

  async deleteAllergy(ctx: ClinicalWriteContext, id: string): Promise<void> {
    const existing = await this.prisma.patientAllergy.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Allergy not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.patientAllergy.update({ where: { id }, data: { deletedAt: new Date() } });
      await supersedeHealthEvents(tx, "patient_allergy", id);
      await this.audit(tx, ctx, "allergy.deleted", "patient_allergy", id);
    });
    await this.safety.evaluate(ctx.profileId, "allergy_removed");
  }

  // ───────────────────────── Conditions ─────────────────────────

  async listConditions(profileId: string) {
    const rows = await this.prisma.patientCondition.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(presentCondition);
  }

  async createCondition(ctx: ClinicalWriteContext, input: ConditionInput) {
    const { onsetDate, abatementDate, ...rest } = input;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnedLinks(tx, ctx.profileId, input);
      const row = await tx.patientCondition.create({
        data: {
          ...rest,
          onsetDate: dateField(onsetDate),
          abatementDate: dateField(abatementDate),
          patientProfileId: ctx.profileId,
          ...ctx.provenance,
        },
      });
      await emitHealthEvent(tx, projectCondition(await eventCtx(tx, ctx.profileId, ctx), row));
      await this.audit(tx, ctx, "condition.created", "patient_condition", row.id);
      return row;
    });
    return presentCondition(created);
  }

  async updateCondition(ctx: ClinicalWriteContext, id: string, input: UpdateConditionInput) {
    const existing = await this.prisma.patientCondition.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Condition not found", 404);
    const { onsetDate, abatementDate, ...rest } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnedLinks(tx, ctx.profileId, input);
      const row = await tx.patientCondition.update({
        where: { id },
        data: {
          ...rest,
          onsetDate: dateField(onsetDate),
          abatementDate: dateField(abatementDate),
          ...restampProvenance(existing.verification, ctx.provenance),
        },
      });
      await this.reproject(tx, ctx, "patient_condition", row.id, projectCondition(await eventCtx(tx, ctx.profileId, ctx), row));
      await this.audit(tx, ctx, "condition.updated", "patient_condition", row.id, { fields: Object.keys(input) });
      return row;
    });
    return presentCondition(updated);
  }

  async deleteCondition(ctx: ClinicalWriteContext, id: string): Promise<void> {
    const existing = await this.prisma.patientCondition.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Condition not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.patientCondition.update({ where: { id }, data: { deletedAt: new Date() } });
      await supersedeHealthEvents(tx, "patient_condition", id);
      await this.audit(tx, ctx, "condition.deleted", "patient_condition", id);
    });
  }

  // ───────────────────────── Immunizations ─────────────────────────

  async listImmunizations(profileId: string) {
    const rows = await this.prisma.immunization.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: [{ administeredOn: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(presentImmunization);
  }

  async createImmunization(ctx: ClinicalWriteContext, input: CreateImmunizationInput) {
    const { administeredOn, ...rest } = input;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnedLinks(tx, ctx.profileId, input);
      const row = await tx.immunization.create({
        data: { ...rest, administeredOn: dateField(administeredOn)!, patientProfileId: ctx.profileId, ...ctx.provenance },
      });
      await emitHealthEvent(tx, projectImmunization(await eventCtx(tx, ctx.profileId, ctx), row));
      await this.audit(tx, ctx, "immunization.created", "immunization", row.id);
      return row;
    });
    return presentImmunization(created);
  }

  async updateImmunization(ctx: ClinicalWriteContext, id: string, input: UpdateImmunizationInput) {
    const existing = await this.prisma.immunization.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Immunization not found", 404);
    const { administeredOn, ...rest } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnedLinks(tx, ctx.profileId, input);
      const row = await tx.immunization.update({
        where: { id },
        data: { ...rest, administeredOn: dateField(administeredOn) ?? undefined, ...restampProvenance(existing.verification, ctx.provenance) },
      });
      await this.reproject(tx, ctx, "immunization", row.id, projectImmunization(await eventCtx(tx, ctx.profileId, ctx), row));
      await this.audit(tx, ctx, "immunization.updated", "immunization", row.id, { fields: Object.keys(input) });
      return row;
    });
    return presentImmunization(updated);
  }

  async deleteImmunization(ctx: ClinicalWriteContext, id: string): Promise<void> {
    const existing = await this.prisma.immunization.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Immunization not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.immunization.update({ where: { id }, data: { deletedAt: new Date() } });
      await supersedeHealthEvents(tx, "immunization", id);
      await this.audit(tx, ctx, "immunization.deleted", "immunization", id);
    });
  }

  // ───────────────────────── Procedures ─────────────────────────

  async listProcedures(profileId: string) {
    const rows = await this.prisma.procedure.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: [{ performedOn: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(presentProcedure);
  }

  async createProcedure(ctx: ClinicalWriteContext, input: CreateProcedureInput) {
    const { performedOn, ...rest } = input;
    const created = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnedLinks(tx, ctx.profileId, input);
      const row = await tx.procedure.create({
        data: { ...rest, performedOn: dateField(performedOn)!, patientProfileId: ctx.profileId, ...ctx.provenance },
      });
      await emitHealthEvent(tx, projectProcedure(await eventCtx(tx, ctx.profileId, ctx), row));
      await this.audit(tx, ctx, "procedure.created", "procedure", row.id);
      return row;
    });
    return presentProcedure(created);
  }

  async updateProcedure(ctx: ClinicalWriteContext, id: string, input: UpdateProcedureInput) {
    const existing = await this.prisma.procedure.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Procedure not found", 404);
    const { performedOn, ...rest } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnedLinks(tx, ctx.profileId, input);
      const row = await tx.procedure.update({
        where: { id },
        data: { ...rest, performedOn: dateField(performedOn) ?? undefined, ...restampProvenance(existing.verification, ctx.provenance) },
      });
      await this.reproject(tx, ctx, "procedure", row.id, projectProcedure(await eventCtx(tx, ctx.profileId, ctx), row));
      await this.audit(tx, ctx, "procedure.updated", "procedure", row.id, { fields: Object.keys(input) });
      return row;
    });
    return presentProcedure(updated);
  }

  async deleteProcedure(ctx: ClinicalWriteContext, id: string): Promise<void> {
    const existing = await this.prisma.procedure.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Procedure not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.procedure.update({ where: { id }, data: { deletedAt: new Date() } });
      await supersedeHealthEvents(tx, "procedure", id);
      await this.audit(tx, ctx, "procedure.deleted", "procedure", id);
    });
  }

  // ───────────────────────── Family history (no timeline event) ─────────────────────────

  async listFamilyHistory(profileId: string) {
    const rows = await this.prisma.familyHistory.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(presentFamilyHistory);
  }

  async createFamilyHistory(ctx: ClinicalWriteContext, input: CreateFamilyHistoryInput) {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.familyHistory.create({ data: { ...input, patientProfileId: ctx.profileId, ...ctx.provenance } });
      await this.audit(tx, ctx, "family_history.created", "family_history", row.id);
      return row;
    });
    return presentFamilyHistory(created);
  }

  async updateFamilyHistory(ctx: ClinicalWriteContext, id: string, input: UpdateFamilyHistoryInput) {
    const existing = await this.prisma.familyHistory.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Family history entry not found", 404);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.familyHistory.update({
        where: { id },
        data: { ...input, ...restampProvenance(existing.verification, ctx.provenance) },
      });
      await this.audit(tx, ctx, "family_history.updated", "family_history", row.id, { fields: Object.keys(input) });
      return row;
    });
    return presentFamilyHistory(updated);
  }

  async deleteFamilyHistory(ctx: ClinicalWriteContext, id: string): Promise<void> {
    const existing = await this.prisma.familyHistory.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Family history entry not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.familyHistory.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit(tx, ctx, "family_history.deleted", "family_history", id);
    });
  }

  // ───────────────────────── Emergency contacts (phone encrypted at rest, no timeline event) ─────────────────────────

  async listEmergencyContacts(profileId: string) {
    const rows = await this.prisma.emergencyContact.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(presentEmergencyContact);
  }

  async createEmergencyContact(ctx: ClinicalWriteContext, input: CreateEmergencyContactInput) {
    const { phone, ...rest } = input;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.emergencyContact.create({
        data: { ...rest, phoneCiphertext: encryptField(phone), patientProfileId: ctx.profileId, recordedByUserId: ctx.userId },
      });
      await this.audit(tx, ctx, "emergency_contact.created", "emergency_contact", row.id);
      return row;
    });
    return presentEmergencyContact(created);
  }

  async updateEmergencyContact(ctx: ClinicalWriteContext, id: string, input: UpdateEmergencyContactInput) {
    const existing = await this.prisma.emergencyContact.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Emergency contact not found", 404);
    const { phone, ...rest } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.emergencyContact.update({
        where: { id },
        data: { ...rest, ...(phone !== undefined ? { phoneCiphertext: encryptField(phone) } : {}), recordedByUserId: ctx.userId },
      });
      await this.audit(tx, ctx, "emergency_contact.updated", "emergency_contact", row.id, { fields: Object.keys(input) });
      return row;
    });
    return presentEmergencyContact(updated);
  }

  async deleteEmergencyContact(ctx: ClinicalWriteContext, id: string): Promise<void> {
    const existing = await this.prisma.emergencyContact.findFirst({ where: { id, patientProfileId: ctx.profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Emergency contact not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.emergencyContact.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit(tx, ctx, "emergency_contact.deleted", "emergency_contact", id);
    });
  }

  // ───────────────────────── Shared ─────────────────────────

  private async matchIngredient(label: string) {
    const norm = (s: string) => s.trim().toLowerCase();
    const ingredients = await this.prisma.medicationIngredient.findMany({ where: { status: "active" } });
    return ingredients.find((i) => norm(i.name) === norm(label) || i.synonyms.some((s) => norm(s) === norm(label))) ?? null;
  }

  /** An edit supersedes the row's live events and appends the replacement (ADR-V2-008). */
  private async reproject(tx: Tx, _ctx: ClinicalWriteContext, entityType: string, entityId: string, event: HealthEventInput): Promise<void> {
    await supersedeHealthEvents(tx, entityType, entityId);
    await emitHealthEvent(tx, event);
  }

  /**
   * Links to other patient-scoped records must point inside the same
   * profile — a foreign id is a validation error, never a cross-profile
   * read. Global (unscoped) organizations are allowed once they exist.
   */
  private async requireOwnedLinks(
    tx: Tx,
    profileId: string,
    input: { encounterId?: string | null; organizationId?: string | null; practitionerId?: string | null; diagnosedByPractitionerId?: string | null; documentId?: string | null },
  ): Promise<void> {
    const errors: Array<{ path: string; message: string }> = [];
    if (input.encounterId) {
      const row = await tx.encounter.findFirst({ where: { id: input.encounterId, patientProfileId: profileId, deletedAt: null }, select: { id: true } });
      if (!row) errors.push({ path: "encounterId", message: "Unknown encounter" });
    }
    if (input.organizationId) {
      const row = await tx.organization.findFirst({
        where: { id: input.organizationId, deletedAt: null, OR: [{ patientProfileId: profileId }, { patientProfileId: null }] },
        select: { id: true },
      });
      if (!row) errors.push({ path: "organizationId", message: "Unknown organization" });
    }
    for (const key of ["practitionerId", "diagnosedByPractitionerId"] as const) {
      const id = input[key];
      if (!id) continue;
      const row = await tx.practitioner.findFirst({ where: { id, createdByProfileId: profileId, deletedAt: null }, select: { id: true } });
      if (!row) errors.push({ path: key, message: "Unknown doctor" });
    }
    if (input.documentId) {
      const row = await tx.prescriptionDocument.findFirst({ where: { id: input.documentId, patientProfileId: profileId }, select: { id: true } });
      if (!row) errors.push({ path: "documentId", message: "Unknown document" });
    }
    if (errors.length > 0) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Some fields are invalid", 400, errors);
  }

  private audit(tx: Tx, ctx: ClinicalWriteContext, action: AuditAction, entityType: string, entityId: string, context?: Record<string, unknown>) {
    return writeAudit(tx, {
      action,
      actorUserId: ctx.userId,
      actorType: ctx.actorRole,
      entityType,
      entityId,
      patientProfileId: ctx.profileId,
      correlationId: ctx.correlationId,
      context,
    });
  }
}

// ───────────────────────── Wire shapes ─────────────────────────
// Dates-only columns go out as YYYY-MM-DD; the ciphertext never leaves.

type Rows = {
  allergy: NonNullable<Awaited<ReturnType<PrismaService["patientAllergy"]["findFirst"]>>>;
  condition: NonNullable<Awaited<ReturnType<PrismaService["patientCondition"]["findFirst"]>>>;
  immunization: NonNullable<Awaited<ReturnType<PrismaService["immunization"]["findFirst"]>>>;
  procedure: NonNullable<Awaited<ReturnType<PrismaService["procedure"]["findFirst"]>>>;
  familyHistory: NonNullable<Awaited<ReturnType<PrismaService["familyHistory"]["findFirst"]>>>;
  emergencyContact: NonNullable<Awaited<ReturnType<PrismaService["emergencyContact"]["findFirst"]>>>;
};

function presentAllergy(row: Rows["allergy"]) {
  return { ...row, onsetDate: dateOnly(row.onsetDate) };
}

function presentCondition(row: Rows["condition"]) {
  return { ...row, onsetDate: dateOnly(row.onsetDate), abatementDate: dateOnly(row.abatementDate) };
}

function presentImmunization(row: Rows["immunization"]) {
  return { ...row, administeredOn: dateOnly(row.administeredOn) };
}

function presentProcedure(row: Rows["procedure"]) {
  return { ...row, performedOn: dateOnly(row.performedOn) };
}

function presentFamilyHistory(row: Rows["familyHistory"]) {
  return row;
}

function presentEmergencyContact(row: Rows["emergencyContact"]) {
  const { phoneCiphertext, ...rest } = row;
  return { ...rest, phone: decryptField(phoneCiphertext) };
}
