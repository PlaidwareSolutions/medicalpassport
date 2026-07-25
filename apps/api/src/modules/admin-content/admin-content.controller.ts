import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  decideContentChangeSchema,
  proposeContentChangeSchema,
  decideContentTranslationSchema,
  proposeContentTranslationSchema,
} from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { AdminContentService } from "./admin-content.service";

/** Clinical content review (docs/06, docs/13, docs/34 Gate 6/OD-6). */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/content")
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get()
  async list(@Req() req: ApiRequest) {
    requireAdminDuty(req, "read_content");
    const items = await this.content.list();
    return { items };
  }

  @Get("versions")
  async versionsQueue(@Query("status") status: string | undefined, @Req() req: ApiRequest) {
    requireAdminDuty(req, "read_content");
    const items = await this.content.versionsQueue(status);
    return { items };
  }

  @Get(":id")
  async detail(@Param("id") id: string, @Req() req: ApiRequest) {
    requireAdminDuty(req, "read_content");
    return this.content.detail(id);
  }

  @Post()
  async propose(@Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "propose_content_change");
    const input = parseWith(proposeContentChangeSchema, body);
    return this.content.propose(input, req.adminAuth!.adminUserId, req.correlationId);
  }

  @Post("versions/:id/decide")
  async decide(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "decide_content_change");
    const input = parseWith(decideContentChangeSchema, body);
    return this.content.decide(id, input, req.adminAuth!.adminUserId, req.correlationId);
  }

  @Post("versions/:id/translations")
  async proposeTranslation(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "propose_content_translation");
    const input = parseWith(proposeContentTranslationSchema, body);
    return this.content.proposeTranslation(id, input, req.adminAuth!.adminUserId, req.correlationId);
  }

  @Post("translations/:id/decide")
  async decideTranslation(@Param("id") id: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "decide_content_translation");
    const input = parseWith(decideContentTranslationSchema, body);
    return this.content.decideTranslation(id, input, req.adminAuth!.adminUserId, req.correlationId);
  }
}
