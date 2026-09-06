"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, type StepUpRequestedDto } from "@medpass/api-client";
import { Banner, Button, TextInput } from "@medpass/ui-web";
import { api, setStepUpResolver } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { ReadAloud } from "./ReadAloud";

const RESEND_SECONDS = 30;

/**
 * Step-up re-verification (ADR-V2-012, docs_v2/11 §7). Mounted once in the
 * root layout; registers the resolver `lib/api.ts` calls whenever a guarded
 * endpoint (share creation, caregiver invite/scope/revoke) answers
 * `403 step_up_required`. Opens the "Confirm it's you" sheet and resolves
 * true once the session is re-verified — the api-client then retries the
 * original call — or false when the patient cancels, in which case the
 * original action fails with that same 403 and the screen says so.
 *
 * Only ever one sheet: `lib/api.ts` shares a single in-flight promise across
 * concurrent guarded calls, so this component holds at most one pending
 * resolver.
 */
export function StepUpProvider() {
  const [pending, setPending] = useState<{ resolve: (verified: boolean) => void } | undefined>();

  useEffect(() => {
    setStepUpResolver(() => new Promise<boolean>((resolve) => setPending({ resolve })));
    return () => setStepUpResolver(undefined);
  }, []);

  if (!pending) return null;
  return (
    <StepUpSheet
      onDone={(verified) => {
        pending.resolve(verified);
        setPending(undefined);
      }}
    />
  );
}

type Phase = "sending" | "ready" | "verifying";

function StepUpSheet({ onDone }: { onDone: (verified: boolean) => void }) {
  const { t } = useI18n();
  const titleId = useId();
  const descId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const codeInputId = useId();
  const requestedOnce = useRef(false);

  const [phase, setPhase] = useState<Phase>("sending");
  const [transport, setTransport] = useState<StepUpRequestedDto["transport"]>("sms");
  // Only ever say "we've texted/called you" once the API confirmed a send.
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);

  const cancel = useCallback(() => onDone(false), [onDone]);

  const mapError = useCallback(
    (err: unknown): string => {
      if (!(err instanceof ApiError)) return t("common.error_generic");
      switch (err.problem.code) {
        case "otp_invalid":
          return t("auth.invalid_code");
        case "otp_expired":
          return t("stepup.code_expired");
        case "otp_locked":
          return t("auth.locked");
        case "otp_resend_limit":
          return t("stepup.resend_limit");
        default:
          return t("common.error_generic");
      }
    },
    [t],
  );

  const requestCode = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.post<StepUpRequestedDto>("/auth/step-up");
      setTransport(res.transport);
      setSent(true);
      setPhase("ready");
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      // A 429 right after an OTP login is expected (the send cooldown is
      // per number, shared with login) — the sheet stays open with Resend
      // counting down rather than failing the action outright.
      setError(
        err instanceof ApiError && err.problem.code === "otp_resend_limit" ? t("stepup.resend_limit") : t("stepup.send_failed"),
      );
      setPhase("ready");
      setResendIn(RESEND_SECONDS);
    }
  }, [t]);

  // Send once on open. The ref guards React's dev-mode double effect so a
  // single open can never burn two sends against the per-number cooldown.
  useEffect(() => {
    if (requestedOnce.current) return;
    requestedOnce.current = true;
    void requestCode();
  }, [requestCode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // Focus management: move focus into the dialog on open, onto the code
  // field as soon as it exists, and hand it back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);
  useEffect(() => {
    if (phase === "ready") document.getElementById(codeInputId)?.focus();
  }, [phase, codeInputId]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key !== "Tab" || !sheetRef.current) return;
    // Focus trap: Tab wraps within the sheet in both directions.
    const focusable = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function verify() {
    setPhase("verifying");
    setError(undefined);
    try {
      await api.post("/auth/step-up/verify", { code });
      onDone(true);
    } catch (err) {
      setError(mapError(err));
      setCode("");
      setPhase("ready");
    }
  }

  async function resend() {
    setResending(true);
    setCode("");
    try {
      await requestCode();
    } finally {
      setResending(false);
    }
  }

  // While a send failed (banner says why) there is no "we've texted you" line at all.
  const sentText =
    phase === "sending" ? t("stepup.sending") : !sent ? "" : transport === "voice" ? t("stepup.sent_voice") : t("stepup.sent_sms");
  const busy = phase === "sending" || phase === "verifying" || resending;

  return (
    <div
      // Backdrop: a tap outside is the same as Cancel — nothing changes.
      onClick={cancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "100%",
          overflowY: "auto",
          background: "var(--color-surface, var(--color-bg))",
          color: "var(--color-text)",
          borderRadius: "var(--radius) var(--radius) 0 0",
          padding: "var(--space-lg) var(--space-md)",
          paddingBottom: "calc(var(--space-lg) + env(safe-area-inset-bottom, 0px))",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
          outline: "none",
        }}
      >
        <h2 id={titleId} style={{ fontSize: "var(--font-title)", margin: 0 }}>
          {t("stepup.title")}
        </h2>
        <div id={descId} style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <span>{t("stepup.intro")}</span>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }} aria-live="polite">
            {sentText}
          </span>
          {sent && transport === "voice" ? (
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("auth.code_hint_voice")}</span>
          ) : null}
        </div>
        <ReadAloud segments={[{ text: `${t("stepup.title")}. ${t("stepup.intro")} ${sentText}` }]} />

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <TextInput
          id={codeInputId}
          label={t("auth.code_label")}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          disabled={phase === "sending"}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.length === 6 && !busy) void verify();
          }}
          style={{ letterSpacing: "0.5em", textAlign: "center" }}
        />

        <Button fullWidth loading={phase === "verifying"} disabled={busy || code.length !== 6} onClick={() => void verify()}>
          {t("stepup.confirm")}
        </Button>
        <Button variant="ghost" fullWidth loading={resending} disabled={busy || resendIn > 0} onClick={() => void resend()}>
          {resendIn > 0 ? t("auth.resend_wait", { seconds: resendIn }) : t("auth.resend")}
        </Button>
        <Button variant="secondary" fullWidth disabled={phase === "verifying"} onClick={cancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
