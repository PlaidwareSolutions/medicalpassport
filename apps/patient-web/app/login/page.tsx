"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type OtpTransportDto } from "@medpass/api-client";
import { Banner, Button, TextInput, TurnstileWidget } from "@medpass/ui-web";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";

const RESEND_SECONDS = 30;

/** Screen 3: OTP login (docs/07) — enumeration-safe, limits reflected in UI. */
export default function LoginPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { refresh } = useSession();

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+91");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [resendIn, setResendIn] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>();
  const [otpTransport, setOtpTransport] = useState<OtpTransportDto["transport"]>("sms");

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    // Drives accurate "we'll call you" vs "we've texted you" wording below
    // — real confusion otherwise, since most patients bring an SMS
    // assumption to any OTP screen. Falls back to the sms/generic copy on
    // any fetch failure, never blocking the login flow over this.
    api
      .get<OtpTransportDto>("/auth/otp-transport")
      .then((res) => setOtpTransport(res.transport))
      .catch(() => undefined);
  }, []);

  async function requestCode() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/auth/otp/request", { phone, turnstileToken });
      setNotice(otpTransport === "voice" ? t("auth.sent_voice") : t("auth.sent_generic"));
      setStep("code");
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? mapAuthError(err) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/auth/otp/verify", { phone, code, device: { kind: "browser" }, locale });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? mapAuthError(err) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  function mapAuthError(err: ApiError): string {
    switch (err.problem.code) {
      case "otp_invalid":
      case "otp_expired":
        return t("auth.invalid_code");
      case "otp_locked":
      case "otp_resend_limit":
        return t("auth.locked");
      case "turnstile_failed":
        return t("auth.verification_failed");
      case "validation_failed":
        return err.problem.errors?.[0]?.message ?? t("common.error_generic");
      default:
        return t("common.error_generic");
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-xl) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <h1 style={{ fontSize: "var(--font-title)" }}>{t("app.name")}</h1>
      {notice ? <Banner tone="info">{notice}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {step === "phone" ? (
        <>
          <TextInput
            label={t("auth.phone_label")}
            help={otpTransport === "voice" ? t("auth.phone_help_voice") : t("auth.phone_help")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TurnstileWidget siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} onToken={setTurnstileToken} />
          <Button
            fullWidth
            disabled={
              busy ||
              phone.replace(/\D/g, "").length < 8 ||
              // Only wait on a token when a widget actually exists (dev/local
              // with no site key renders nothing and never calls onToken).
              (!!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken)
            }
            onClick={() => void requestCode()}
          >
            {t("auth.send_code")}
          </Button>
        </>
      ) : (
        <>
          {otpTransport === "voice" ? (
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t("auth.code_hint_voice")}
            </span>
          ) : null}
          <TextInput
            label={t("auth.code_label")}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            style={{ letterSpacing: "0.5em", textAlign: "center" }}
          />
          <Button fullWidth disabled={busy || code.length !== 6} onClick={() => void verify()}>
            {t("auth.verify")}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            disabled={busy || resendIn > 0}
            onClick={() => void requestCode()}
          >
            {resendIn > 0 ? t("auth.resend_wait", { seconds: resendIn }) : t("auth.resend")}
          </Button>
        </>
      )}
    </main>
  );
}
