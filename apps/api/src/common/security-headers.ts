import type { NextFunction, Request, Response } from "express";

/**
 * Origin-side security headers (docs_v2/11 §9, Phase 0 ticket 0.19). Cloudflare
 * sets HSTS at the edge for the public hostnames; the API repeats the
 * defensive set so a direct-to-origin or misconfigured-zone request is no
 * weaker. The API only ever serves JSON (and streamed PDFs), so the CSP can
 * be maximally strict: nothing may load, and nothing may frame a response.
 * No dependency on helmet — a handful of static headers is the whole job.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "strict-transport-security": "max-age=15552000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site",
});

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  next();
}
