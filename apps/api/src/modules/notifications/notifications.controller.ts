import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import { measurementRemindersSchema, notificationPreferencesSchema, webPushSubscribeSchema, webPushUnsubscribeSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { ProfileAccessService } from "../../common/profile-access.service";
import { NotificationsService } from "./notifications.service";

@Controller()
export class NotificationsController {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  @Public()
  @Get("push/vapid-public-key")
  vapidPublicKey() {
    return this.notifications.vapidPublicKey();
  }

  @Post("notification-channels/web-push")
  async subscribe(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(webPushSubscribeSchema, body);
    return this.notifications.subscribeWebPush(req.auth!.userId, input);
  }

  @Post("notification-channels/web-push/unsubscribe")
  async unsubscribe(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(webPushUnsubscribeSchema, body);
    return this.notifications.unsubscribeWebPush(req.auth!.userId, input.endpoint);
  }

  @Get("profiles/current/notification-preferences")
  async getPreferences(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_reminders");
    return this.notifications.getPreferences(profileId);
  }

  @Post("profiles/current/notification-preferences")
  async updatePreferences(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_reminders");
    const input = parseWith(notificationPreferencesSchema, body);
    return this.notifications.updatePreferences(profileId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }

  /**
   * V2 (docs_v2/05 §12): the same full-replace as POST, now also carrying
   * the per-kind `channelFrequency` control. POST stays for the V1 client;
   * both write the one row.
   */
  @Put("profiles/current/notification-preferences")
  async putPreferences(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_reminders");
    const input = parseWith(notificationPreferencesSchema, body);
    return this.notifications.updatePreferences(profileId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }

  @Get("profiles/current/refill-reminders")
  async listRefillReminders(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "view_medications");
    return this.notifications.listRefillReminders(profileId);
  }

  @Post("refill-reminders/:notificationId/dismiss")
  async dismissRefillReminder(@Param("notificationId") notificationId: string, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "edit_medications");
    return this.notifications.dismissRefillReminder(profileId, notificationId, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }

  /** Same scope as who a missed dose actually escalates to (manage_reminders/full_management) — the persistent in-app record for that same audience. */
  @Get("profiles/current/caregiver-alerts")
  async listCaregiverAlerts(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_reminders");
    return this.notifications.listCaregiverAlerts(profileId);
  }

  // ───────────────────────── V2 Phase 17 ─────────────────────────

  /** Per-concept measurement reminder plan (times of day, weekdays) — same scope as the other reminder settings. */
  @Get("profiles/current/measurement-reminders")
  async getMeasurementReminders(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_reminders");
    return this.notifications.getMeasurementReminders(profileId);
  }

  @Put("profiles/current/measurement-reminders")
  async putMeasurementReminders(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId, actorRole } = await this.access.require(req, "manage_reminders");
    const input = parseWith(measurementRemindersSchema, body);
    return this.notifications.updateMeasurementReminders(profileId, input, {
      userId: req.auth!.userId,
      actorRole,
      correlationId: req.correlationId,
    });
  }

  /**
   * docs_v2/05 §12: WhatsApp opt-in exists in the contract but no Business
   * Solution Provider is contracted (OD-10), so the route answers
   * `501 channel_not_available` rather than pretending to subscribe. The
   * body is deliberately not parsed: nothing is stored until a BSP exists.
   */
  @Post("notification-channels/whatsapp")
  whatsappOptIn() {
    throw new ApiProblem(ERROR_CODES.CHANNEL_NOT_AVAILABLE, "WhatsApp reminders are not available yet", 501);
  }
}
