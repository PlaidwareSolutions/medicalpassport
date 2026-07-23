import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { adminRevokeShareSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { SharingService } from "../sharing/sharing.service";
import { AdminIncidentsService } from "./admin-incidents.service";

/** Incident-response tools (docs/06, docs/30): DLQ review/replay, admin share revoke. */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin")
export class AdminIncidentsController {
  constructor(
    private readonly incidents: AdminIncidentsService,
    private readonly sharing: SharingService,
  ) {}

  @Get("incidents/dlq")
  async listDlq(@Query("queue") queue: string | undefined, @Query("replayed") replayed: string | undefined, @Req() req: ApiRequest) {
    requireAdminDuty(req, "replay_job");
    const items = await this.incidents.listDlq({ queue, replayed: replayed === undefined ? undefined : replayed === "true" });
    return { items };
  }

  @Post("jobs/:id/replay")
  async replay(@Param("id") id: string, @Req() req: ApiRequest) {
    requireAdminDuty(req, "replay_job");
    return this.incidents.replayJob(id, req.adminAuth!.adminUserId, req.correlationId);
  }

  @Post("incidents/shares/:shareLinkId/revoke")
  async revokeShare(@Param("shareLinkId") shareLinkId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    requireAdminDuty(req, "revoke_share");
    const input = parseWith(adminRevokeShareSchema, body);
    return this.sharing.revokeAsAdmin(shareLinkId, req.adminAuth!.adminUserId, req.correlationId, input.reason);
  }
}
