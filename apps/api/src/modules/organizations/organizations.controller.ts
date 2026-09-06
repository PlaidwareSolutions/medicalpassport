import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { createOrganizationSchema, mergeOrganizationSchema, updateOrganizationSchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { ProfileAccessService } from "../../common/profile-access.service";
import { entrySourceFor, rejectClientProvenance, stampProvenance } from "../../common/provenance";
import { parseWith } from "../../common/zod";
import { OrganizationsService, type OrganizationWriteContext } from "./organizations.service";

/**
 * "My facilities" — patient-scoped organizations (docs_v2/05 §2). Same
 * view_profile/edit_profile gating as practitioners: reference records,
 * readable wherever a facility field can be filled in.
 */
@Controller()
export class OrganizationsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly organizations: OrganizationsService,
  ) {}

  private async writeContext(req: ApiRequest, body: unknown): Promise<OrganizationWriteContext> {
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

  @Get("profiles/current/organizations")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.organizations.list(profileId) };
  }

  @Post("profiles/current/organizations")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.organizations.create(ctx, parseWith(createOrganizationSchema, body));
  }

  @Patch("organizations/:id")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    return this.organizations.update(ctx, id, parseWith(updateOrganizationSchema, body));
  }

  @Post("organizations/:id/merge")
  async merge(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, body);
    const input = parseWith(mergeOrganizationSchema, body);
    return this.organizations.merge(ctx, id, input.intoId);
  }

  @Delete("organizations/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const ctx = await this.writeContext(req, undefined);
    await this.organizations.softDelete(ctx, id);
  }
}
