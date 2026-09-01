"use client";

/**
 * The API origin must be SAME-SITE with the page or the httpOnly session
 * cookies (SameSite=Lax, docs/18) never stick: a patient on
 * app.medicinepassport.app calling api.medidocs.app is cross-site — the
 * browser drops the cookie, OTP verify "succeeds" and login loops back to
 * the phone screen. Found in production 2026-09-01: one user completed
 * four voice-OTP cycles in four minutes, four live sessions server-side,
 * and never got past /login.
 *
 * So the base URL is derived from where the app is actually running:
 * *.medicinepassport.app pages talk to api.medicinepassport.app (the same
 * Railway api service behind an additional hostname); everything else —
 * app.medidocs.app, staging, localhost — keeps the build-time env value.
 */
export function apiBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".medicinepassport.app")) {
    return "https://api.medicinepassport.app";
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}
