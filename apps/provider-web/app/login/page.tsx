"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, ChoiceGrid, TextInput } from "@medpass/ui-web";
import { TurnstileWidget } from "../../components/TurnstileWidget";
import { api, setOrganizationId } from "../../lib/api";
import { useProviderSession } from "../../lib/session";
import { ORGANIZATION_KIND_LABELS } from "../../lib/proposal-kinds";
import type { ProviderTotpDto, SessionOrganization } from "../../lib/types";

type Step = "phone" | "code" | "organization";

const PHONE_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Provider sign-in (docs_v2/06 P11-2): phone → one-time code → provider
 * session. The API never says whether a number belongs to a provider until
 * the code is right, and then only whether it is one. A member of several
 * organizations picks the one this session acts for.
 */
export default function ProviderLoginPage() {
  const router = useRouter();
  const { status, refresh } = useProviderSession();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("+91");
  const [code, setCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>();
  const [organizations, setOrganizations] = useState<SessionOrganization[]>([]);
  const [chosen, setChosen] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (status === "ready") router.replace("/");
  }, [status, router]);

  function mapError(err: unknown): string {
    if (!(err instanceof ApiError)) return "Could not reach the server. Check the connection and try again.";
    switch (err.problem.code) {
      case "otp_invalid":
        return "That code is not correct. Please check and try again.";
      case "otp_expired":
        return "That code has expired. Please request a new one.";
      case "otp_locked":
        return "Too many attempts. Please request a new code later.";
      case "rate_limited":
        return "Too many requests. Please wait a while and try again.";
      case "turnstile_failed":
        return "Verification failed. Please try again.";
      case "forbidden":
        return "This number is not registered with a provider organization.";
      case "validation_failed":
        return "Enter the phone number with its country code, e.g. +91 98765 43210.";
      default:
        return err.problem.title || "Something went wrong. Please try again.";
    }
  }

  const normalizedPhone = phone.replace(/[\s-]/g, "");

  async function requestCode() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/provider/auth/login", { phone: normalizedPhone, ...(turnstileToken ? { turnstileToken } : {}) });
      setStep("code");
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish(organizationId: string) {
    setOrganizationId(organizationId);
    await refresh();
    router.replace("/");
  }

  async function verifyCode() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.post<ProviderTotpDto>("/provider/auth/totp", { phone: normalizedPhone, code });
      if (res.organizations.length === 1) {
        await finish(res.organizations[0]!.id);
        return;
      }
      setOrganizations(res.organizations);
      setStep("organization");
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "var(--space-xl) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>Medicine Passport for clinics</h1>
        <p style={{ color: "var(--color-text-muted)", margin: "var(--space-xs) 0 0" }}>Sign in with the phone number your organization registered.</p>
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {step === "phone" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          <TextInput
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            help="With country code, e.g. +91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} />
          <Button type="submit" fullWidth loading={busy} disabled={busy || !PHONE_RE.test(normalizedPhone) || (!!siteKey && !turnstileToken)}>
            Send code
          </Button>
        </form>
      ) : null}

      {step === "code" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verifyCode();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          <Banner tone="info">If this number can receive codes, one has been sent.</Banner>
          <TextInput
            label="6-digit code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            style={{ letterSpacing: "0.5em", textAlign: "center" }}
          />
          <Button type="submit" fullWidth loading={busy} disabled={busy || code.length !== 6}>
            Verify and sign in
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep("phone")} disabled={busy}>
            Use a different number
          </Button>
        </form>
      ) : null}

      {step === "organization" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <ChoiceGrid
            label="Which organization are you working for now?"
            columns={1}
            choices={organizations.map((o) => ({ value: o.id, label: o.displayName, description: `${ORGANIZATION_KIND_LABELS[o.kind] ?? o.kind} · ${o.role}` }))}
            value={chosen}
            onChange={setChosen}
          />
          <Button fullWidth disabled={!chosen || busy} onClick={() => chosen && void finish(chosen)}>
            Continue
          </Button>
        </div>
      ) : null}
    </main>
  );
}
