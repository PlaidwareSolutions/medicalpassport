import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import { encounterSchema, updateEncounterSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { recordedViaFor, rejectClientProvenance } from "../../common/provenance";
import { EncountersService } from "./encounters.service";

/**
 * Encounters (docs_v2/04 §3.3, docs_v2/05 §2). Gated on view_profile /
 * edit_profile like prescriptions and reports — a patient-owned record, not
 * a medication mutation.
 */
@Controller()
export class EncountersController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly encounters: EncountersService,
  ) {}

  private actor(req: ApiRequest, actorRole: "patient" | "caregiver") {
    return { userId: req.auth!.userId, actorRole, correlationId: req.correlationId, recordedVia: recordedViaFor(req) };
  }

  @Get("profiles/current/encounters")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.encounters.list(profileId) };
  }

  @Post("profiles/current/encounters")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    rejectClientProvenance(body);
    const input = parseWith(encounterSchema, body);
    return this.encounters.create(profileId, input, this.actor(req, actorRole));
  }

  @Get("encounters/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const encounter = await this.encounters.byId(profileId, id);
    if (!encounter) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Encounter not found", 404);
    return encounter;
  }

  @Patch("encounters/:id")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    rejectClientProvenance(body);
    const input = parseWith(updateEncounterSchema, body);
    return this.encounters.update(profileId, id, input, this.actor(req, actorRole));
  }

  @Delete("encounters/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    await this.encounters.softDelete(profileId, id, this.actor(req, actorRole));
  }
}
