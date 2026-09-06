/** @type {import('next').NextConfig} */
const nextConfig = {
  // A second instance (the e2e suite's own `next build`/`start` on :3102
  // while a developer's `next dev` keeps :3002) must not share `.next/`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@medpass/design-tokens", "@medpass/ui-web"],
  // SEC-2: suppress the framework-identifying X-Powered-By header.
  poweredByHeader: false,
  // Content-Security-Policy is per-request (nonce) and lives in middleware.ts.
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Camera for the QR onboarding scanner only; nothing else.
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        // The whole portal is authenticated clinical tooling — never indexed.
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      // App shell HTML is session-personalized; never publicly cached (docs_v2/11 §9).
      source: "/((?!_next/static).*)",
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    },
  ],
};

export default nextConfig;
