import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // The service worker is exercised in production builds; dev stays simple.
  disable: process.env.NODE_ENV === "development",
  // Serwist precaches all of public/ by default. The guidance audio (many
  // MP3s across 4 locales) must NOT be force-downloaded on SW install —
  // it is runtime-cached on first play instead (see app/sw.ts), so this is
  // an explicit allowlist of what install-time precache may include.
  globPublicPatterns: ["icons/**/*", "manifest.webmanifest"],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@medpass/ui-web", "@medpass/design-tokens"],
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        // The whole PWA is private/authenticated — nothing here should ever
        // be indexed. This is the confidentiality control for the public
        // share route /s/<token>: a bearer-token URL, if ever discovered by
        // a crawler, must not surface in search results (Stage-7 security
        // review). robots.txt alone is not sufficient for bearer links.
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      // App shell HTML is personalized-adjacent; never publicly cached.
      source: "/((?!_next/static|icons|audio|manifest.webmanifest).*)",
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    },
    {
      // Guidance audio is content-addressed (hash in the file name): safe to
      // cache forever, and re-downloading MP3s on every play would punish
      // exactly the data-constrained phones docs/01 describes.
      source: "/audio/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
  ],
};

export default withSerwist(nextConfig);
