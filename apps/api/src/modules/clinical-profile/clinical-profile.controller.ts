import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import {
  allergySchema,
  conditionSchema,
  createEmergencyContactSchema,
  createFamilyHistorySchema,
  createImmunizationSchema,
  createProcedureSchema,
  updateAllergySchema,
  updateConditionSchema,
  updateEmergencyContactSchema,
  updateFamilyHistorySchema,
  updateImmunizationSchema,
  updateProcedureSchema,
} from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { ProfileAccessService } from "../../common/profile-access.service";
import { entrySourceFor, rejectClientProvenance, stampProvenance } from "../../common/provenance";
import { parseWith } from "../../common/zod";
import { ClinicalProfileService, type ClinicalWriteContext } from "./clinical-profile.service";

/**
 * V2 Phase 1 clinical profile (docs_v2/05 §2). Reads need `view_profile`,
 * writes `edit_profile` — the same gating as the V1 allergy/condition
 * endpoints these extend. Every write rejects client-sent provenance before
 * parsing and stamps its own (ADR-V2-002).
 */
@Controller()
export class ClinicalProfileController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly clinical: ClinicalProfileService,
  ) {}

  /** Resolves edit access, then builds the write context with server-stamped provenance. */
  private async writeContext(req: ApiRequest, body: unknown): Promise<ClinicalWriteContext> {
    rejectClientProvenance(body);
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    return {
      profileId,
      actorRole,
      userId: req.auth!.userId,
      correlationId: req.correlationId,
      provenance: stampProvenance(req, entrySourceFor(req)),
    };
  }

  // ───────────────────────── Allergies ─────────────────────────

  @Get("profiles/current/allergies")
  async allergies(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.clinical.listAllergies(profileId) };
  }

  @Post("profiles/current/allergies")
  async addAllergy(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.createAllergy(ctx, parseWith(allergySchema, body));
  }

  @Patch("allergies/:id")
  async updateAllergy(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.updateAllergy(ctx, id, parseWith(updateAllergySchema, body));
  }

  @Delete("allergies/:id")
  @HttpCode(204)
  async deleteAllergy(@Param("id") id: string, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, undefined);
    await this.clinical.deleteAllergy(ctx, id);
  }

  // ───────────────────────── Conditions ─────────────────────────

  @Get("profiles/current/conditions")
  async conditions(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.clinical.listConditions(profileId) };
  }

  @Post("profiles/current/conditions")
  async addCondition(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.createCondition(ctx, parseWith(conditionSchema, body));
  }

  @Patch("conditions/:id")
  async updateCondition(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.updateCondition(ctx, id, parseWith(updateConditionSchema, body));
  }

  @Delete("conditions/:id")
  @HttpCode(204)
  async deleteCondition(@Param("id") id: string, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, undefined);
    await this.clinical.deleteCondition(ctx, id);
  }

  // ───────────────────────── Immunizations ─────────────────────────

  @Get("profiles/current/immunizations")
  async immunizations(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.clinical.listImmunizations(profileId) };
  }

  @Post("profiles/current/immunizations")
  async addImmunization(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.createImmunization(ctx, parseWith(createImmunizationSchema, body));
  }

  @Patch("immunizations/:id")
  async updateImmunization(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.updateImmunization(ctx, id, parseWith(updateImmunizationSchema, body));
  }

  @Delete("immunizations/:id")
  @HttpCode(204)
  async deleteImmunization(@Param("id") id: string, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, undefined);
    await this.clinical.deleteImmunization(ctx, id);
  }

  // ───────────────────────── Procedures ─────────────────────────

  @Get("profiles/current/procedures")
  async procedures(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.clinical.listProcedures(profileId) };
  }

  @Post("profiles/current/procedures")
  async addProcedure(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.createProcedure(ctx, parseWith(createProcedureSchema, body));
  }

  @Patch("procedures/:id")
  async updateProcedure(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.updateProcedure(ctx, id, parseWith(updateProcedureSchema, body));
  }

  @Delete("procedures/:id")
  @HttpCode(204)
  async deleteProcedure(@Param("id") id: string, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, undefined);
    await this.clinical.deleteProcedure(ctx, id);
  }

  // ───────────────────────── Family history ─────────────────────────

  @Get("profiles/current/family-history")
  async familyHistory(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.clinical.listFamilyHistory(profileId) };
  }

  @Post("profiles/current/family-history")
  async addFamilyHistory(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.createFamilyHistory(ctx, parseWith(createFamilyHistorySchema, body));
  }

  @Patch("family-history/:id")
  async updateFamilyHistory(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.updateFamilyHistory(ctx, id, parseWith(updateFamilyHistorySchema, body));
  }

  @Delete("family-history/:id")
  @HttpCode(204)
  async deleteFamilyHistory(@Param("id") id: string, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, undefined);
    await this.clinical.deleteFamilyHistory(ctx, id);
  }

  // ───────────────────────── Emergency contacts ─────────────────────────

  @Get("profiles/current/emergency-contacts")
  async emergencyContacts(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.clinical.listEmergencyContacts(profileId) };
  }

  @Post("profiles/current/emergency-contacts")
  async addEmergencyContact(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.createEmergencyContact(ctx, parseWith(createEmergencyContactSchema, body));
  }

  @Patch("emergency-contacts/:id")
  async updateEmergencyContact(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.clinical.updateEmergencyContact(ctx, id, parseWith(updateEmergencyContactSchema, body));
  }

  @Delete("emergency-contacts/:id")
  @HttpCode(204)
  async deleteEmergencyContact(@Param("id") id: string, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, undefined);
    await this.clinical.deleteEmergencyContact(ctx, id);
  }
}
