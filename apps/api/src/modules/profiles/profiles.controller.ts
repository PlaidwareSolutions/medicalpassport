import { Body, Controller, Get, Patch, Post, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import {
  allergySchema,
  conditionSchema,
  createDependentSchema,
  createProfileSchema,
  updateProfileSchema,
} from "@medpass/validation";
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
    return {
      items: profiles.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        yearOfBirth: p.yearOfBirth,
        preferredLocale: p.preferredLocale,
        relationship: relationships.get(p.id)!,
        claimInvited: !!p.claimInvitedPhoneDigest,
        rowVersion: p.rowVersion,
      })),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(createProfileSchema, body);
    const userId = req.auth!.userId;

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
