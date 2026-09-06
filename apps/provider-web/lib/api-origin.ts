"use client";

/**
 * The API origin must be SAME-SITE with the page or the httpOnly provider
 * session cookie (SameSite=Lax) never sticks — the same production lesson
 * patient-web learned on 2026-09-01. clinic.medicinepassport.app talks to
 * api.medicinepassport.app; everything else (staging, localhost, the e2e
 * suite on :3102 → :4102) keeps the build-time env value.
 */
export function apiBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".medicinepassport.app")) {
    return "https://api.medicinepassport.app";
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}
