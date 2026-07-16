import type { ConsentType } from "@medpass/domain";

/**
 * Consent purpose texts (localization keys) and the channel→consent mapping.
 * Enforcement lives in the API; this package keeps the vocabulary shared
 * with future native clients.
 */
export const CONSENT_PURPOSE_KEYS: Record<ConsentType, string> = {
  data_processing: "consent.purpose.data_processing",
  sms_reminders: "consent.purpose.sms_reminders",
  whatsapp_reminders: "consent.purpose.whatsapp_reminders",
  email: "consent.purpose.email",
  caregiver_access: "consent.purpose.caregiver_access",
  sharing: "consent.purpose.sharing",
  ai_processing: "consent.purpose.ai_processing",
  emergency_card: "consent.purpose.emergency_card",
};

/** Channels that must not operate without an active consent record (docs/16). */
export const CONSENT_GATED_CHANNELS = ["sms", "whatsapp", "email", "caregiver"] as const;

export function consentTypeForChannel(
  channel: (typeof CONSENT_GATED_CHANNELS)[number],
): ConsentType {
  switch (channel) {
    case "sms":
      return "sms_reminders";
    case "whatsapp":
      return "whatsapp_reminders";
    case "email":
      return "email";
    case "caregiver":
      return "caregiver_access";
  }
}
