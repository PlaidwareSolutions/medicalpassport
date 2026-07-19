/**
 * Notification/OTP provider adapters (docs/24 ADR-9). Real SMS/WhatsApp
 * providers are an open decision (OD-10); development uses the log
 * transport, which the API refuses to run in production. Web push (docs/16)
 * needs no such decision — it's standards-based and provider-free.
 */
import webpush from "web-push";

export interface OtpSender {
  /** Sends an OTP to a phone number. Implementations must not log the code. */
  sendOtp(phoneE164: string, code: string, locale: string): Promise<void>;
}

/** Pre-approved, PHI-free-unless-opted-in message keys (docs/16) — never freeform text. */
export type SmsTemplateKey = "dose_reminder" | "refill" | "completion";

export interface SmsMessageSender {
  sendTemplate(phoneE164: string, templateKey: string, params: Record<string, string>): Promise<{ providerMessageId: string }>;
}

interface LogFn {
  (obj: Record<string, unknown>, msg: string): void;
}

/**
 * Development-only transport: acknowledges the send without revealing the
 * code (OTP values are never logged — docs/12 §log hygiene). Pair with
 * OTP_DEV_FIXED_CODE so developers know the code without it being sent.
 */
export class LogOtpSender implements OtpSender {
  constructor(private readonly log: LogFn) {}

  async sendOtp(phoneE164: string, _code: string, locale: string): Promise<void> {
    this.log(
      { phoneSuffix: phoneE164.slice(-3), locale, transport: "log" },
      "OTP send simulated (dev transport; use OTP_DEV_FIXED_CODE to sign in)",
    );
  }
}

export interface WebPushSubscriptionDetails {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface WebPushPayload {
  title: string;
  body: string;
  /** Relative in-app URL to open on notification click (e.g. "/timeline"). */
  url: string;
}

export type WebPushSendResult = { ok: true } | { ok: false; gone: boolean; statusCode?: number };

export interface WebPushSender {
  send(subscription: WebPushSubscriptionDetails, payload: WebPushPayload): Promise<WebPushSendResult>;
}

/**
 * Web Push (docs/16) — no external provider or account needed, unlike
 * SMS/WhatsApp (blocked on OD-10): a self-signed VAPID keypair is enough.
 * `gone: true` tells the caller the browser unsubscribed or the
 * subscription otherwise died, so the channel should stop being used
 * rather than retried.
 */
export class VapidWebPushSender implements WebPushSender {
  constructor(config: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  }

  async send(subscription: WebPushSubscriptionDetails, payload: WebPushPayload): Promise<WebPushSendResult> {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      return { ok: true };
    } catch (err) {
      if (err instanceof webpush.WebPushError) {
        return { ok: false, gone: err.statusCode === 404 || err.statusCode === 410, statusCode: err.statusCode };
      }
      throw err;
    }
  }
}

/**
 * Privacy-safe SMS wording (docs/16) — the medicine name only appears in the
 * `full_name`-opted-in variant, mirroring the push payload text in
 * apps/cron's detect-due-reminders.ts exactly (kept in sync manually; a
 * genuine drift between the two would just mean inconsistent wording across
 * channels, not a broken send). Terse: SMS is billed per-segment.
 */
const SMS_TEMPLATES: Record<SmsTemplateKey, (name: string | undefined) => string> = {
  dose_reminder: (name) => (name ? `${name}: it's time to take this now.` : "Medicine reminder: time to take your scheduled medicine."),
  refill: (name) => (name ? `${name}: you may be running low — check your supply.` : "Medicine reminder: you may be running low on a medicine. Check your supply."),
  completion: (name) => (name ? `${name}: this course was expected to finish. Please review it.` : "Medicine reminder: a course of medicine was expected to finish. Please review it."),
};

interface TelnyxMessageResponse {
  data?: { id: string };
  errors?: Array<{ code: string; detail: string }>;
}

/**
 * Real SMS delivery via Telnyx (docs/16, OD-10) — a thin wrapper around
 * `POST /v2/messages`, the same call for both OTP and reminder templates.
 * Throws on failure (matching both interfaces' existing throw-on-failure
 * contract) with the real Telnyx error code/detail in the message, since
 * callers (the cron's NotificationAttempt recording) want that detail for
 * diagnosis rather than a generic "send failed".
 */
export class TelnyxSmsSender implements OtpSender, SmsMessageSender {
  constructor(private readonly config: { apiKey: string; fromNumber: string }) {}

  private async send(to: string, text: string): Promise<string> {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.config.fromNumber, to, text }),
    });
    const json = (await res.json().catch(() => null)) as TelnyxMessageResponse | null;
    if (!res.ok || !json?.data) {
      const err = json?.errors?.[0];
      throw new Error(err ? `telnyx_${err.code}: ${err.detail}` : `telnyx_http_${res.status}`);
    }
    return json.data.id;
  }

  /** OTP codes are never logged (docs/12 §log hygiene) — only ever sent. */
  async sendOtp(phoneE164: string, code: string, locale: string): Promise<void> {
    const text =
      locale === "hi"
        ? `आपका मेडपास कोड ${code} है। इसे किसी के साथ साझा न करें।`
        : `Your medpass code is ${code}. Do not share this with anyone.`;
    await this.send(phoneE164, text);
  }

  async sendTemplate(phoneE164: string, templateKey: string, params: Record<string, string>): Promise<{ providerMessageId: string }> {
    const build = SMS_TEMPLATES[templateKey as SmsTemplateKey];
    if (!build) throw new Error(`Unknown SMS template: ${templateKey}`);
    const text = build(params.medicationName);
    const providerMessageId = await this.send(phoneE164, text);
    return { providerMessageId };
  }
}
