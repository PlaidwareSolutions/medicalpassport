import { z } from "zod";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_KINDS,
  NOTIFICATION_KINDS_NEVER_MUTED,
  NOTIFICATION_PRIVACY_MODES,
} from "@medpass/domain";

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

/** One kind's delivery control (docs_v2/04 §12): which channels, and how often. */
export const channelFrequencyEntrySchema = z.object({
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).max(NOTIFICATION_CHANNELS.length),
  frequency: z.enum(NOTIFICATION_FREQUENCIES),
});
export type ChannelFrequencyEntry = z.infer<typeof channelFrequencyEntrySchema>;

/**
 * Per-kind `{channels[], frequency}` map, keyed by NotificationKind.
 * `dose_reminder` and `caregiver_escalation` are refused outright (hazard
 * H-48): this control can never turn a dose reminder or a missed-dose
 * escalation down, and refusing the key is clearer than silently ignoring
 * it. Unknown kinds are a validation error, not dropped.
 */
export const channelFrequencySchema = z
  .record(z.string(), channelFrequencyEntrySchema)
  .superRefine((value, ctx) => {
    for (const kind of Object.keys(value)) {
      if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [kind], message: "Not a notification kind" });
      } else if ((NOTIFICATION_KINDS_NEVER_MUTED as readonly string[]).includes(kind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [kind],
          message: "Dose reminders and missed-dose alerts always reach you — they can't be turned down here",
        });
      }
    }
  });
export type ChannelFrequencyInput = z.infer<typeof channelFrequencySchema>;

export const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  privacyMode: z.enum(NOTIFICATION_PRIVACY_MODES),
  quietHoursEnabled: z.boolean().default(true),
  quietHoursStart: z.string().regex(TIME_OF_DAY, "Use HH:MM").default("22:00"),
  quietHoursEnd: z.string().regex(TIME_OF_DAY, "Use HH:MM").default("07:00"),
  soundEnabled: z.boolean().default(true),
  vibrationEnabled: z.boolean().default(true),
  /** Omitted → left as it was (the V1 POST body never carried it); `{}` → cleared. */
  channelFrequency: channelFrequencySchema.optional(),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
