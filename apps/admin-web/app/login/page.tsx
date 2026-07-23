"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, TextInput, TurnstileWidget } from "@medpass/ui-web";
import { api } from "../../lib/api";
import { useAdminSession } from "../../lib/session";

type Step = "credentials" | "enroll" | "verify";

/** Admin login (docs/18): email + password, then mandatory TOTP MFA — first
 * login for an unenrolled account walks through QR enrollment in place. */
export default function AdminLoginPage() {
  const router = useRouter();
  const { refresh } = useAdminSession();

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>();
  const [otpauthUri, setOtpauthUri] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (otpauthUri && canvasRef.current) void QRCode.toCanvas(canvasRef.current, otpauthUri, { width: 220, margin: 1 });
  }, [otpauthUri]);

  function mapError(err: ApiError): string {
    switch (err.problem.code) {
      case "admin_credentials_invalid":
        return "Incorrect email or password.";
      case "admin_locked":
        return "Too many failed attempts. Try again later.";
      case "mfa_invalid":
        return "That code is not correct.";
      case "turnstile_failed":
        return "Verification failed. Please try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }

  async function submitCredentials() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.post<{ status: "mfa_enrollment_required" | "mfa_required" }>("/admin/auth/login", { email, password, turnstileToken });
      if (res.status === "mfa_enrollment_required") {
        const enroll = await api.post<{ secretBase32: string; otpauthUri: string }>("/admin/auth/mfa/enroll");
        setOtpauthUri(enroll.otpauthUri);
        setStep("enroll");
      } else {
        setStep("verify");
      }
    } catch (err) {
      setError(err instanceof ApiError ? mapError(err) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/admin/auth/mfa/enroll/confirm", { code });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? mapError(err) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/admin/auth/mfa/verify", { code });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? mapError(err) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "var(--space-xl) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <h1 style={{ fontSize: "var(--font-title)" }}>medpass admin</h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {step === "credentials" ? (
        <>
          <TextInput label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextInput label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <TurnstileWidget siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} onToken={setTurnstileToken} />
          <Button
            fullWidth
            disabled={busy || !email || !password || (!!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken)}
            onClick={() => void submitCredentials()}
          >
            Sign in
          </Button>
        </>
      ) : null}

      {step === "enroll" ? (
        <>
          <Banner tone="info">First sign-in: set up two-factor authentication with an authenticator app.</Banner>
          <canvas ref={canvasRef} style={{ alignSelf: "center" }} />
          <TextInput
            label="6-digit code from your authenticator app"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            style={{ letterSpacing: "0.5em", textAlign: "center" }}
          />
          <Button fullWidth disabled={busy || code.length !== 6} onClick={() => void confirmEnroll()}>
            Confirm and finish setup
          </Button>
        </>
      ) : null}

      {step === "verify" ? (
        <>
          <TextInput
            label="6-digit code from your authenticator app"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            style={{ letterSpacing: "0.5em", textAlign: "center" }}
          />
          <Button fullWidth disabled={busy || code.length !== 6} onClick={() => void verifyMfa()}>
            Verify
          </Button>
        </>
      ) : null}
    </main>
  );
}
