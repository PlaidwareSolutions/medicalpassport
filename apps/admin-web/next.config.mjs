/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@medpass/design-tokens"],
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
