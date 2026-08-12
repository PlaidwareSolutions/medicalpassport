import { Body, Controller, Get, Patch, Post, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { CAREGIVER_ALERT_WINDOW_DAYS, ERROR_CODES, isMinorByBirthYear } from "@medpass/domain";
import {
  allergySchema,
  conditionSchema,
  createDependentSchema,
  createProfileSchema,
  createSelfProfileSchema,
  updateProfileSchema,
} from "@medpass/validation";

/** Children V1 attestation version stamped on child dependents (audit/provenance). */
const GUARDIAN_ATTESTATION_VERSION = "v1-2026-08";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { computeProfileRelationships } from "../../common/profile-relationship";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import { SafetyEvaluationService } from "../safety/safety-evaluation.service";

@Controller("profiles")
export class ProfilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
    private readonly safety: SafetyEvaluationService,
  ) {}

  @Get()
  async list(@Req() req: ApiRequest) {
    const userId = req.auth!.userId;
    const profiles = await this.prisma.patientProfile.findMany({
      where: {
        deletedAt: null,
        OR: [
          { ownerUserId: userId },
          { claimedByUserId: userId },
          { caregiverRelationships: { some: { caregiverUserId: userId, status: "active" } } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    const relationships = computeProfileRelationships(profiles, userId);

    // A profile-switcher badge for "this patient has an open missed-dose
    // alert" — the same manage_reminders/full_management scope that
    // actually receives the escalation, so a view-only caregiver doesn't
    // see a badge for something they have no responsibility for. Self/
    // dependent profiles always qualify (it's the caller's own data).
    // Shares CAREGIVER_ALERT_WINDOW_DAYS with the alert-history list by
    // design: a badge lit by a miss too old to appear there would lead
    // nowhere.
    const caregiverProfileIds = profiles.filter((p) => relationships.get(p.id) === "caregiver").map((p) => p.id);
    let scopedCaregiverProfileIds = new Set<string>();
    if (caregiverProfileIds.length > 0) {
      const scopedRelationships = await this.prisma.caregiverRelationship.findMany({
        where: {
          patientProfileId: { in: caregiverProfileIds },
          caregiverUserId: userId,
          status: "active",
          permissions: { some: { scope: { in: ["manage_reminders", "full_management"] }, revokedAt: null } },
        },
        select: { patientProfileId: true },
      });
      scopedCaregiverProfileIds = new Set(scopedRelationships.map((r) => r.patientProfileId));
    }
    const visibleProfileIds = profiles
      .filter((p) => relationships.get(p.id) !== "caregiver" || scopedCaregiverProfileIds.has(p.id))
      .map((p) => p.id);

    const alertWindowStart = new Date(Date.now() - CAREGIVER_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const missedDoses = await this.prisma.scheduledDose.findMany({
      where: {
        status: "missed",
        dueAt: { gte: alertWindowStart },
        medicationSchedule: { patientMedication: { patientProfileId: { in: visibleProfileIds }, deletedAt: null } },
      },
      select: { medicationSchedule: { select: { patientMedication: { select: { patientProfileId: true } } } } },
      distinct: ["medicationScheduleId"],
    });
    const profilesWithOpenAlerts = new Set(missedDoses.map((d) => d.medicationSchedule.patientMedication.patientProfileId));

    return {
      items: profiles.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        yearOfBirth: p.yearOfBirth,
        preferredLocale: p.preferredLocale,
        relationship: relationships.get(p.id)!,
        claimInvited: !!p.claimInvitedPhoneDigest,
        rowVersion: p.rowVersion,
        hasOpenAlerts: profilesWithOpenAlerts.has(p.id),
      })),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(createSelfProfileSchema, body);
    const userId = req.auth!.userId;

    // Children V1 age gate: a person under 18 may not run their own adult
    // account. A child's Medicine Passport must be set up by a parent or lawful
    // guardian (as a dependent). Year-of-birth is required for the self profile
    // (createSelfProfileSchema) precisely so this check can run.
    if (isMinorByBirthYear(input.yearOfBirth)) {
      throw new ApiProblem(
        ERROR_CODES.SELF_ACCOUNT_MINOR,
        "A parent or lawful guardian must set up a child's Medicine Passport.",
        403,
      );
    }

    const existingSelf = await this.prisma.patientProfile.findFirst({
      where: { ownerUserId: userId, claimedByUserId: null, deletedAt: null },
    });
    if (existingSelf) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "You already have a profile", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.patientProfile.create({
        data: {
          ownerUserId: userId,
          displayName: input.displayName,
          yearOfBirth: input.yearOfBirth,
          sex: input.sex,
          preferredLocale: input.preferredLocale,
        },
      });
      // Baseline processing consent is recorded at profile creation (docs/18).
      const consent = await tx.consent.create({
        data: {
          patientProfileId: profile.id,
          type: "data_processing",
          purpose: "Store and process medication records for this profile",
        },
      });
      await tx.consentEvent.create({
        data: { consentId: consent.id, event: "granted", actorUserId: userId },
      });
      await writeAudit(tx, {
        action: "profile.created",
        actorUserId: userId,
        actorType: "patient",
        entityType: "patient_profile",
        entityId: profile.id,
        patientProfileId: profile.id,
        correlationId: req.correlationId,
      });
      return { id: profile.id, displayName: profile.displayName, rowVersion: profile.rowVersion };
    });
  }

  @Post("dependents")
  async createDependent(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(createDependentSchema, body);
    const userId = req.auth!.userId;

    // Children V1: a child dependent (relationship "child", or a birth year that
    // indicates under 18) requires an explicit parent/lawful-guardian
    // attestation. Adult dependents (e.g. an elderly parent) are unaffected.
    const isChild =
      input.relationship === "child" ||
      (input.yearOfBirth != null && isMinorByBirthYear(input.yearOfBirth));
    if (isChild && input.guardianAttestation !== true) {
      throw new ApiProblem(
        ERROR_CODES.GUARDIAN_ATTESTATION_REQUIRED,
        "Please confirm you are the parent or lawful guardian of this child.",
        400,
      );
    }
    const attested = isChild
      ? { guardianAttestedByUserId: userId, guardianAttestedAt: new Date(), guardianAttestationVersion: GUARDIAN_ATTESTATION_VERSION }
      : {};

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.patientProfile.create({
        data: {
          ownerUserId: userId,
          displayName: input.displayName,
          yearOfBirth: input.yearOfBirth,
          sex: input.sex,
          preferredLocale: input.preferredLocale,
          // Stored as a real column (not just the consent purpose string
          // below) so it can be correctly inverted into the reciprocal
          // caregiver relationship's own `relationship` value if this
          // profile is later claimed (apps/api/.../claims/claims.controller.ts).
          dependentRelationship: input.relationship,
          ...attested,
        },
      });
      const consent = await tx.consent.create({
        data: {
          patientProfileId: profile.id,
          type: "caregiver_access",
          purpose: `Managed by caregiver (${input.relationship}); claimable by the dependent later`,
        },
      });
      await tx.consentEvent.create({ data: { consentId: consent.id, event: "granted", actorUserId: userId } });
      await writeAudit(tx, {
        action: "caregiver.dependent_created",
        actorUserId: userId,
        actorType: "caregiver",
        entityType: "patient_profile",
        entityId: profile.id,
        patientProfileId: profile.id,
        correlationId: req.correlationId,
        context: { relationship: input.relationship },
      });
      return { id: profile.id, displayName: profile.displayName, rowVersion: profile.rowVersion };
    });
  }

  @Get("current")
  async current(@Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "view_profile");
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: profileId } });
    if (actorRole === "caregiver") {
      await writeAudit(this.prisma, {
        action: "profile.viewed_by_caregiver",
        actorUserId: req.auth!.userId,
        actorType: "caregiver",
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    }
    return {
      id: profile.id,
      displayName: profile.displayName,
      yearOfBirth: profile.yearOfBirth,
      sex: profile.sex,
      preferredLocale: profile.preferredLocale,
      rowVersion: profile.rowVersion,
    };
  }

  @Patch("current")
  async update(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "edit_profile");
    const input = parseWith(updateProfileSchema, body);
    const { rowVersion, ...fields } = input;

    const updated = await this.prisma.patientProfile.updateMany({
      where: { id: profileId, rowVersion, deletedAt: null },
      data: { ...fields, rowVersion: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ApiProblem(ERROR_CODES.CONFLICT_ROW_VERSION, "This profile was changed elsewhere. Reload and retry.", 409);
    }
    await writeAudit(this.prisma, {
      action: "profile.updated",
      actorUserId: req.auth!.userId,
      actorType: req.profileContext!.actorRole,
      entityType: "patient_profile",
      entityId: profileId,
      patientProfileId: profileId,
      correlationId: req.correlationId,
      context: { fields: Object.keys(fields) },
    });
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: profileId } });
    return { id: profile.id, rowVersion: profile.rowVersion };
  }

  @Get("current/allergies")
  async allergies(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const items = await this.prisma.patientAllergy.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return { items };
  }

  @Post("current/allergies")
  async addAllergy(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "edit_profile");
    const input = parseWith(allergySchema, body);

    // Exact/synonym name match against the controlled ingredient vocabulary
    // only — never a fuzzy guess (docs/09 §6 "never silently interpret").
    // No match just means no drug-allergy check is possible for this entry;
    // it is never fabricated.
    const norm = (s: string) => s.trim().toLowerCase();
    const ingredients = await this.prisma.medicationIngredient.findMany({ where: { status: "active" } });
    const matchedIngredient = ingredients.find(
      (i) => norm(i.name) === norm(input.label) || i.synonyms.some((s) => norm(s) === norm(input.label)),
    );

    const allergy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.patientAllergy.create({
        data: {
          ...input,
          allergenIngredientId: matchedIngredient?.id,
          patientProfileId: profileId,
          recordedByUserId: req.auth!.userId,
        },
      });
      await writeAudit(tx, {
        action: "allergy.created",
        actorUserId: req.auth!.userId,
        actorType: req.profileContext!.actorRole,
        entityType: "patient_allergy",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { matchedIngredient: Boolean(matchedIngredient) },
      });
      return created;
    });
    // Allergy changes trigger safety re-evaluation (docs/09).
    await this.safety.evaluate(profileId, "allergy_added");
    return allergy;
  }

  @Get("current/conditions")
  async conditions(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const items = await this.prisma.patientCondition.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return { items };
  }

  @Post("current/conditions")
  async addCondition(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "edit_profile");
    const input = parseWith(conditionSchema, body);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.patientCondition.create({
        data: { ...input, patientProfileId: profileId, recordedByUserId: req.auth!.userId },
      });
      await writeAudit(tx, {
        action: "condition.created",
        actorUserId: req.auth!.userId,
        actorType: req.profileContext!.actorRole,
        entityType: "patient_condition",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
      return created;
    });
  }
}
