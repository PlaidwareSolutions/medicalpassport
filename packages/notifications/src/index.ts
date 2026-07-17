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
