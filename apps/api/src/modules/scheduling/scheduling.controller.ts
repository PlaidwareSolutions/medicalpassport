import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { recordDoseEventSchema, recordPrnDoseEventSchema, timelineQuerySchema } from "@medpass/validation";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { TimelineService } from "./timeline.service";

function todayIst(): string {
  // Fixed Asia/Kolkata offset (docs/16 simplification note).
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

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
    return this.timeline.getDay(profileId, input.date ?? todayIst());
  }

  @Post("doses/:scheduledDoseId/events")
  async recordDoseEvent(@Param("scheduledDoseId") scheduledDoseId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "record_doses");
    const input = parseWith(recordDoseEventSchema, body);
    return this.timeline.recordDoseEvent(profileId, scheduledDoseId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
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
