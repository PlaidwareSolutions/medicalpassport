import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // The service worker is exercised in production builds; dev stays simple.
  disable: process.env.NODE_ENV === "development",
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
      ],
    },
    {
      // App shell HTML is personalized-adjacent; never publicly cached.
      source: "/((?!_next/static|icons|manifest.webmanifest).*)",
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    },
  ],
};

export default withSerwist(nextConfig);
