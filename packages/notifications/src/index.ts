/**
 * Notification/OTP provider adapters (docs/24 ADR-9). Real providers are an
 * open decision (OD-10); development uses the log transport, which the API
 * refuses to run in production.
 */

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
