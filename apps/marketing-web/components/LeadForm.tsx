"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { en } from "../lib/dictionaries/en";
import type { MarketingLocale } from "../lib/locales";
import { LEAD_API_URL, LEAD_TURNSTILE_SITEKEY } from "../lib/lead-api";

// /for-clinics/ is English-only V1 (§16). Sourcing strings directly from the
// English dictionary (rather than the multi-locale `t`) keeps this client
// bundle from shipping the hi/te/ur dictionaries (§44). Signature mirrors
// `t(locale, key)` so existing call sites and `Parameters<typeof t>` are unchanged.
const t = (_locale: MarketingLocale, key: keyof typeof en): string => en[key];

type TurnstileApi = {
  render: (el: HTMLElement, opts: { sitekey: string; callback?: (t: string) => void }) => string;
  reset: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Kept in sync with packages/validation `PROFESSIONAL_ROLES` (the server is
// authoritative). Inlined rather than imported so the client bundle never
// pulls in zod/the validation package.
const PROFESSIONAL_ROLES = ["doctor", "pharmacist", "clinic_owner", "hospital_admin", "care_coordinator", "other"] as const;

/** Reset the Turnstile widget (if present) so the next submit gets a fresh,
 *  single-use token. No-op when Turnstile isn't loaded. */
function resetTurnstile() {
  try {
    window.turnstile?.reset();
  } catch {
    /* widget not ready — ignore */
  }
}

/**
 * Professional lead form (C7 / OD-LP-2). Business contact info only — the
 * form never asks for and the API never stores patient/health data (the
 * server schema is `.strict()`). Client validation mirrors the server as a
 * courtesy; the server is authoritative. Turnstile renders only when a
 * sitekey is configured; otherwise the form submits without a token and the
 * server skips verification (optional-vendor pattern). No lead field ever
 * touches analytics, the URL, or a console log (§21).
 */
type Status = "idle" | "submitting" | "success" | "error";

const label = (locale: MarketingLocale, key: Parameters<typeof t>[1], required = false) => (
  <span style={{ display: "block", fontWeight: 650, fontSize: "0.9375rem", marginBottom: "6px" }}>
    {t(locale, key)}
    {required ? (
      <span className="mkt-muted" style={{ fontWeight: 500 }}>
        {" "}
        ({t(locale, "lead.required")})
      </span>
    ) : null}
  </span>
);

const field: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "1rem",
  border: "1.5px solid var(--mkt-border-control)",
  borderRadius: "var(--radius-sm)",
  background: "var(--mkt-surface)",
  color: "var(--mkt-ink)",
};

const roleKey: Record<(typeof PROFESSIONAL_ROLES)[number], Parameters<typeof t>[1]> = {
  doctor: "lead.role_doctor",
  pharmacist: "lead.role_pharmacist",
  clinic_owner: "lead.role_clinic_owner",
  hospital_admin: "lead.role_hospital_admin",
  care_coordinator: "lead.role_care_coordinator",
  other: "lead.role_other",
};

// Friendly, localized copy for the fields users most often trip on. For any
// other field the server's own message is shown verbatim (still accurate, just
// less polished) — so a new server-side rule never regresses to a blank field.
const fieldMessageKey: Partial<Record<string, Parameters<typeof t>[1]>> = {
  email: "lead.error_email",
  phone: "lead.error_phone",
  consentToContact: "lead.error_consent",
};

// The API's ApiProblem serializes Zod field issues under `errors` (see
// api/src/common/errors.ts) — each `{ path, message }`.
type LeadProblem = { code?: string; errors?: { path?: string; message?: string }[] };

export function LeadForm({ locale }: { locale: MarketingLocale }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const turnstileRef = useRef<HTMLDivElement | null>(null);

  // Explicit render: the Turnstile script auto-renders on load, but this
  // client-rendered widget div mounts after hydration — after the script has
  // already run — so we render it ourselves once `window.turnstile` is ready.
  useEffect(() => {
    if (!LEAD_TURNSTILE_SITEKEY) return;
    let done = false;
    const id = setInterval(() => {
      const el = turnstileRef.current;
      if (window.turnstile && el && !el.hasChildNodes()) {
        window.turnstile.render(el, { sitekey: LEAD_TURNSTILE_SITEKEY });
        done = true;
        clearInterval(id);
      }
    }, 150);
    // Give up quietly after ~10s — the form still submits (server enforces).
    const stop = setTimeout(() => !done && clearInterval(id), 10_000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    // Client-side pre-checks (mirror the server's `.refine`/consent rules) so
    // the two most common mistakes are caught without a round-trip.
    if (!email && !phone) {
      setFieldErrors({ email: t(locale, "lead.error_contact"), phone: t(locale, "lead.error_contact") });
      setError(t(locale, "lead.error_contact"));
      return;
    }
    if (data.get("consentToContact") !== "on") {
      setFieldErrors({ consentToContact: t(locale, "lead.error_consent") });
      return;
    }
    setStatus("submitting");
    const token = String(data.get("cf-turnstile-response") ?? "");
    try {
      const res = await fetch(LEAD_API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "medpass" },
        body: JSON.stringify({
          name: String(data.get("name") ?? "").trim(),
          organization: String(data.get("organization") ?? "").trim(),
          role: String(data.get("role") ?? ""),
          city: String(data.get("city") ?? "").trim(),
          email: email || undefined,
          phone: phone || undefined,
          message: String(data.get("message") ?? "").trim() || undefined,
          consentToContact: true,
          ...(token ? { turnstileToken: token } : {}),
        }),
      });
      if (res.ok) {
        form.reset();
        resetTurnstile();
        setStatus("success");
        return;
      }
      // Non-2xx: translate the server's structured ApiProblem into targeted,
      // field-level feedback instead of one opaque "something went wrong".
      const problem = (await res.json().catch(() => null)) as LeadProblem | null;
      const code = problem?.code;
      setStatus("error");

      if (code === "validation_failed" && Array.isArray(problem?.errors)) {
        const next: Record<string, string> = {};
        for (const d of problem.errors) {
          const field = String(d?.path ?? "").split(".")[0];
          if (!field) continue;
          const key = fieldMessageKey[field];
          next[field] = key ? t(locale, key) : d?.message || t(locale, "lead.error_generic");
        }
        setFieldErrors(next);
        setError(t(locale, "lead.error_fix_fields"));
        // The server validates the body BEFORE Turnstile, so the token was
        // never spent — keep it; the user can fix the field and resubmit
        // without re-solving the widget.
        return;
      }
      if (code === "turnstile_failed") {
        setError(t(locale, "lead.error_turnstile"));
        resetTurnstile(); // token spent/expired — get a fresh one
        return;
      }
      if (res.status === 429 || code === "rate_limited") {
        setError(t(locale, "lead.error_rate_limited"));
        return;
      }
      setError(t(locale, "lead.error_generic"));
      resetTurnstile();
    } catch {
      // Network/transport failure (offline, DNS, CORS) — the response was never
      // readable, so reset the widget and show the generic message.
      setStatus("error");
      setError(t(locale, "lead.error_generic"));
      resetTurnstile();
    }
  }

  if (status === "success") {
    return (
      <div role="status" style={{ background: "var(--mkt-soft)", borderRadius: "16px", padding: "28px" }}>
        <h3 style={{ color: "var(--mkt-primary)" }}>{t(locale, "lead.success_title")}</h3>
        <p style={{ marginTop: "8px" }}>{t(locale, "lead.success_body")}</p>
      </div>
    );
  }

  const errStyle: React.CSSProperties = {
    display: "block",
    color: "var(--color-danger)",
    fontSize: "0.8125rem",
    fontWeight: 600,
    marginTop: "6px",
  };
  const fieldError = (name: string) =>
    fieldErrors[name] ? (
      <span role="alert" style={errStyle}>
        {fieldErrors[name]}
      </span>
    ) : null;
  const invalid = (name: string) => (fieldErrors[name] ? true : undefined);

  return (
    <form onSubmit={onSubmit} noValidate style={{ display: "grid", gap: "16px" }}>
      <label>
        {label(locale, "lead.name", true)}
        <input name="name" required maxLength={120} autoComplete="name" aria-invalid={invalid("name")} style={field} />
        {fieldError("name")}
      </label>
      <label>
        {label(locale, "lead.organization", true)}
        <input name="organization" required maxLength={160} autoComplete="organization" aria-invalid={invalid("organization")} style={field} />
        {fieldError("organization")}
      </label>
      <label>
        {label(locale, "lead.role", true)}
        <select name="role" required defaultValue="" aria-invalid={invalid("role")} style={field}>
          <option value="" disabled>
            {t(locale, "lead.role_placeholder")}
          </option>
          {PROFESSIONAL_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(locale, roleKey[r])}
            </option>
          ))}
        </select>
        {fieldError("role")}
      </label>
      <label>
        {label(locale, "lead.city", true)}
        <input name="city" required maxLength={120} autoComplete="address-level2" aria-invalid={invalid("city")} style={field} />
        {fieldError("city")}
      </label>
      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "1fr" }}>
        <label>
          {label(locale, "lead.email")}
          <input name="email" type="email" maxLength={254} autoComplete="email" aria-invalid={invalid("email")} style={field} />
          {fieldError("email")}
        </label>
        <label>
          {label(locale, "lead.phone")}
          <input name="phone" type="tel" maxLength={20} autoComplete="tel" aria-invalid={invalid("phone")} style={field} />
          {fieldError("phone")}
        </label>
      </div>
      <p className="mkt-muted" style={{ fontSize: "0.8125rem", marginTop: "-8px" }}>
        {t(locale, "lead.contact_hint")}
      </p>
      <label>
        {label(locale, "lead.message")}
        <textarea name="message" maxLength={2000} rows={3} aria-invalid={invalid("message")} style={{ ...field, resize: "vertical" }} />
        {fieldError("message")}
        <span className="mkt-muted" style={{ display: "block", fontSize: "0.8125rem", marginTop: "6px" }}>
          {t(locale, "lead.no_patient_data")}
        </span>
      </label>
      <label style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        <input name="consentToContact" type="checkbox" required aria-invalid={invalid("consentToContact")} style={{ width: "22px", height: "22px", marginTop: "2px", flex: "none" }} />
        <span style={{ fontSize: "0.9375rem" }}>{t(locale, "lead.consent")}</span>
      </label>
      {fieldError("consentToContact")}
      {LEAD_TURNSTILE_SITEKEY ? <div ref={turnstileRef} /> : null}
      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)", fontWeight: 600, fontSize: "0.9375rem" }}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status === "submitting"}
        style={{
          background: "var(--mkt-primary)",
          color: "#fff",
          border: 0,
          borderRadius: "var(--radius)",
          minHeight: "var(--size-touch)",
          padding: "13px 22px",
          fontWeight: 700,
          fontSize: "1rem",
          cursor: status === "submitting" ? "default" : "pointer",
        }}
      >
        {status === "submitting" ? t(locale, "lead.submitting") : t(locale, "lead.submit")}
      </button>
    </form>
  );
}
