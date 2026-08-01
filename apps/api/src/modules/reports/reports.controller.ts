import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import { createReportSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { ReportsService } from "./reports.service";

/**
 * Test reports (docs/07 screen 44). Gated on view_profile/edit_profile — the
 * same scopes as allergies/conditions/glucose/prescriptions, since this is a
 * patient-owned record rather than a medication mutation. A caregiver with
 * only `view_medications` can read these but not create or delete them.
 */
@Controller()
export class ReportsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly reports: ReportsService,
  ) {}

  @Get("profiles/current/reports")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return { items: await this.reports.list(profileId) };
  }

  @Post("profiles/current/reports")
  async create(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    const input = parseWith(createReportSchema, body);
    return this.reports.create(profileId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }

  @Get("reports/:id")
  async byId(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const report = await this.reports.byId(profileId, id);
    if (!report) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Report not found", 404);
    return report;
  }

  @Delete("reports/:id")
  @HttpCode(204)
  async softDelete(@Param("id") id: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_profile");
    await this.reports.softDelete(profileId, id, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }
}
