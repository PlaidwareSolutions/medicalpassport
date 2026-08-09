import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { createPractitionerSchema, mergePractitionerSchema, updatePractitionerSchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { PractitionersService } from "./practitioners.service";

/**
 * "My doctors" — the shared records behind every prescriber/doctor field.
 * Same view_profile/edit_profile gating as prescriptions: these are
 * patient-owned reference records, not medication mutations, and the list
 * must be readable wherever a doctor field can be filled in.
 */
@Controller()
export class PractitionersController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly practitioners: PractitionersService,
  ) {}

  @Get("profiles/current/practitioners")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.practitioners.list(profileId) };
  }

  @Post("profiles/current/practitioners")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(createPractitionerSchema, body);
    return this.practitioners.create(profileId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }

  @Patch("practitioners/:id")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(updatePractitionerSchema, body);
    return this.practitioners.update(profileId, id, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }

  @Post("practitioners/:id/merge")
  async merge(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(mergePractitionerSchema, body);
    return this.practitioners.merge(profileId, id, input.targetId, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }

  @Delete("practitioners/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    await this.practitioners.softDelete(profileId, id, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }
}
