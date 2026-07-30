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

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  privacyMode: z.enum(NOTIFICATION_PRIVACY_MODES),
  quietHoursEnabled: z.boolean().default(true),
  quietHoursStart: z.string().regex(TIME_OF_DAY, "Use HH:MM").default("22:00"),
  quietHoursEnd: z.string().regex(TIME_OF_DAY, "Use HH:MM").default("07:00"),
  soundEnabled: z.boolean().default(true),
  vibrationEnabled: z.boolean().default(true),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
