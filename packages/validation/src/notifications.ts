import { z } from "zod";
import { NOTIFICATION_PRIVACY_MODES } from "@medpass/domain";

export const webPushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type WebPushSubscribeInput = z.infer<typeof webPushSubscribeSchema>;

export const webPushUnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});
export type WebPushUnsubscribeInput = z.infer<typeof webPushUnsubscribeSchema>;

export const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  privacyMode: z.enum(NOTIFICATION_PRIVACY_MODES),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
