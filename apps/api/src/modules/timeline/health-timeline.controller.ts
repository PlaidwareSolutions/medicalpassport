import { Controller, Get, Query, Req } from "@nestjs/common";
import { healthTimelineQuerySchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { HealthTimelineService } from "./health-timeline.service";

/**
 * Unified health timeline (docs_v2/05 §3, ADR-V2-008). Distinct from
 * `GET profiles/current/timeline` (the dose timeline for one day), which
 * stays exactly as it is.
 */
@Controller()
export class HealthTimelineController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly timeline: HealthTimelineService,
  ) {}

  @Get("profiles/current/health-timeline")
  async page(@Query() query: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    const input = parseWith(healthTimelineQuerySchema, query);
    return this.timeline.page(profileId, input);
  }

  @Get("profiles/current/health-timeline/summary")
  async summary(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_profile");
    return this.timeline.summary(profileId);
  }
}
