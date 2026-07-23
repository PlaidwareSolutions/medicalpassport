import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { decideCatalogChangeSchema, proposeCatalogChangeSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { AdminCatalogChangesService } from "./admin-catalog-changes.service";

/** Maker-checker workflow over the 7 catalog entity kinds (docs/06, docs/14, docs/23 E10.1). */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/catalog-changes")
export class AdminCatalogChangesController {
  constructor(private readonly changes: AdminCatalogChangesService) {}

  @Get()
  async list(
    @Query("status") status: string | undefined,
    @Query("entityType") entityType: string | undefined,
    @Query("requestedBy") requestedBy: string | undefined,
    @Req() req: ApiRequest,
  ) {
    requireAdminDuty(req, "read_catalog");
    const items = await this.changes.list({ status, entityType, requestedByAdminUserId: requestedBy });
    return { items };
  }

  @Get(":id")
  async detail(@Param("id") id: string, @Req() req: ApiRequest) {
    requireAdminDuty(req, "read_catalog");
    return this.changes.detail(id);
  }

  @Post()
  async propose(@Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "propose_catalog_change");
    const input = parseWith(proposeCatalogChangeSchema, body);
    return this.changes.propose(input, req.adminAuth!.adminUserId, req.correlationId);
  }

  @Post(":id/decide")
  async decide(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "decide_catalog_change");
    const input = parseWith(decideCatalogChangeSchema, body);
    return this.changes.decide(id, input, req.adminAuth!.adminUserId, req.correlationId);
  }
}
