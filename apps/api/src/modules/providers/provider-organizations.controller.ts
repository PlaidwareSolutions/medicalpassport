import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { addOrganizationMemberSchema, updateOrganizationMemberSchema, updateProviderOrganizationSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { ProviderGuard, providerContext, requireOwner } from "./provider.guard";
import { ProviderOrganizationsService } from "./provider-organizations.service";

/** The signed-in staff member's organization and its member list (docs_v2/05 §11; owner-only writes). */
@Public()
@UseGuards(ProviderGuard)
@Controller("provider/organizations/current")
export class ProviderOrganizationsController {
  constructor(private readonly organizations: ProviderOrganizationsService) {}

  @Get()
  async current(@Req() req: ApiRequest) {
    const ctx = providerContext(req);
    return this.organizations.current(ctx.organizationId, ctx.role);
  }

  @Patch()
  async update(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = requireOwner(req);
    const input = parseWith(updateProviderOrganizationSchema, body);
    return this.organizations.update(input, { userId: ctx.userId, organizationId: ctx.organizationId, correlationId: req.correlationId }, ctx.role);
  }

  @Get("members")
  async members(@Req() req: ApiRequest) {
    const ctx = requireOwner(req);
    return { items: await this.organizations.listMembers(ctx.organizationId) };
  }

  @Post("members")
  async addMember(@Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = requireOwner(req);
    const input = parseWith(addOrganizationMemberSchema, body);
    return this.organizations.addMember(input, { userId: ctx.userId, organizationId: ctx.organizationId, correlationId: req.correlationId });
  }

  @Patch("members/:memberId")
  async updateMember(@Param("memberId") memberId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const ctx = requireOwner(req);
    const input = parseWith(updateOrganizationMemberSchema, body);
    return this.organizations.updateMember(memberId, input, {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      correlationId: req.correlationId,
    });
  }

  @Delete("members/:memberId")
  @HttpCode(204)
  async removeMember(@Param("memberId") memberId: string, @Req() req: ApiRequest) {
    const ctx = requireOwner(req);
    await this.organizations.removeMember(memberId, { userId: ctx.userId, organizationId: ctx.organizationId, correlationId: req.correlationId });
  }
}
