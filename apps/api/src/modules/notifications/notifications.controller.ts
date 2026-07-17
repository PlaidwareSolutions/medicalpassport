import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { notificationPreferencesSchema, webPushSubscribeSchema, webPushUnsubscribeSchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
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
}
