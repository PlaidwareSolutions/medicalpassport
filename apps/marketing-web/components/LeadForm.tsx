"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";
import { LEAD_API_URL, LEAD_TURNSTILE_SITEKEY } from "../lib/lead-api";

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

export function LeadForm({ locale }: { locale: MarketingLocale }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");
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
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    if (!email && !phone) {
      setError(t(locale, "lead.error_contact"));
      return;
    }
    if (data.get("consentToContact") !== "on") {
      setError(t(locale, "lead.error_consent"));
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
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      resetTurnstile();
      setStatus("success");
    } catch {
      setStatus("error");
      setError(t(locale, "lead.error_generic"));
      // A Turnstile token is single-use; after any failed submit, reset the
      // widget so the next attempt gets a fresh token instead of reusing a
      // spent/expired one.
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

  return (
    <form onSubmit={onSubmit} noValidate style={{ display: "grid", gap: "16px" }}>
      <label>
        {label(locale, "lead.name", true)}
        <input name="name" required maxLength={120} autoComplete="name" style={field} />
      </label>
      <label>
        {label(locale, "lead.organization", true)}
        <input name="organization" required maxLength={160} autoComplete="organization" style={field} />
      </label>
      <label>
        {label(locale, "lead.role", true)}
        <select name="role" required defaultValue="" style={field}>
          <option value="" disabled>
            {t(locale, "lead.role_placeholder")}
          </option>
          {PROFESSIONAL_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(locale, roleKey[r])}
            </option>
          ))}
        </select>
      </label>
      <label>
        {label(locale, "lead.city", true)}
        <input name="city" required maxLength={120} autoComplete="address-level2" style={field} />
      </label>
      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "1fr" }}>
        <label>
          {label(locale, "lead.email")}
          <input name="email" type="email" maxLength={254} autoComplete="email" style={field} />
        </label>
        <label>
          {label(locale, "lead.phone")}
          <input name="phone" type="tel" maxLength={20} autoComplete="tel" style={field} />
        </label>
      </div>
      <p className="mkt-muted" style={{ fontSize: "0.8125rem", marginTop: "-8px" }}>
        {t(locale, "lead.contact_hint")}
      </p>
      <label>
        {label(locale, "lead.message")}
        <textarea name="message" maxLength={2000} rows={3} style={{ ...field, resize: "vertical" }} />
        <span className="mkt-muted" style={{ display: "block", fontSize: "0.8125rem", marginTop: "6px" }}>
          {t(locale, "lead.no_patient_data")}
        </span>
      </label>
      <label style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        <input name="consentToContact" type="checkbox" required style={{ width: "22px", height: "22px", marginTop: "2px", flex: "none" }} />
        <span style={{ fontSize: "0.9375rem" }}>{t(locale, "lead.consent")}</span>
      </label>
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
