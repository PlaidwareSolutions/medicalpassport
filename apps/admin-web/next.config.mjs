/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@medpass/design-tokens", "@medpass/ui-web"],
  // SEC-2 (Session 15): suppress the framework-identifying X-Powered-By header.
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        // Admin portal is never publicly cached (docs/26).
        { key: "Cache-Control", value: "private, no-store" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
};

export default nextConfig;
