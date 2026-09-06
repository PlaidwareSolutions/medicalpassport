import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a script nonce (docs_v2/11 §9:
 * "patient-web/provider-web: CSP with nonces (Next.js middleware),
 * frame-ancestors 'none'"). Next.js reads the nonce from the request header
 * set here and stamps it on every script tag it emits; `'strict-dynamic'`
 * lets those trusted scripts load the chunks they need and nothing else
 * executes. The root layout reads `x-nonce` for the one inline style it
 * renders.
 *
 * Styles stay `'unsafe-inline'`: the design system is inline `style`
 * attributes throughout, and a style nonce would switch those off.
 */
function connectSources(): string[] {
  const sources = new Set<string>(["'self'", "https://api.medicinepassport.app"]);
  const configured = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    sources.add(new URL(configured).origin);
  } catch {
    // A malformed build-time URL falls back to 'self' only.
  }
  return [...sources];
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    // Turnstile's loader is inserted by our own (nonce-trusted) script, which
    // 'strict-dynamic' allows; its challenge runs in a frame.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Camera frames for the QR scanner are consumed in-page; nothing is uploaded.
    "media-src 'self' blob:",
    `connect-src ${connectSources().join(" ")}${dev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except static assets; prefetches carry no scripts and skip the nonce work.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
