import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { recordDoseEventSchema, recordPrnDoseEventSchema, timelineQuerySchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { TimelineService } from "./timeline.service";
import { emitProductEvent, productEventContext } from "../product-events/product-events.service";

@Controller()
export class SchedulingController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly timeline: TimelineService,
  ) {}

  @Get("profiles/current/timeline")
  async getTimeline(@Query() query: Record<string, string>, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_schedule");
    const input = parseWith(timelineQuerySchema, query);
    // No date given = "today" in the profile's own timezone — the service
    // resolves it, since only it knows the profile (docs/16).
    return this.timeline.getDay(profileId, input.date);
  }

  @Post("doses/:scheduledDoseId/events")
  async recordDoseEvent(@Param("scheduledDoseId") scheduledDoseId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "record_doses");
    const input = parseWith(recordDoseEventSchema, body);
    const result = await this.timeline.recordDoseEvent(profileId, scheduledDoseId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
    // Product metrics (docs_v2/06 P1-7): the action enum only — never which medicine.
    emitProductEvent({ ...productEventContext(req), name: "engagement.dose_recorded", profileId, properties: { action: input.action, offline: false } });
    return result;
  }

  @Post("profiles/current/doses/prn-events")
  async recordPrnDoseEvent(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "record_doses");
    const input = parseWith(recordPrnDoseEventSchema, body);
    return this.timeline.recordPrnDoseEvent(profileId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }
}
