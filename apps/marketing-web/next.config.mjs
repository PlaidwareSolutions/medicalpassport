/**
 * Static-export marketing site (docs/landing-page/05 §"Hosting", OD-LP-5).
 * No headers() here on purpose: under `output: "export"` Next.js headers()
 * does not apply to the emitted files — security/cache headers are part of
 * the Cloudflare deployment configuration (Session 6, docs/landing-page/00 §5.5).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@medpass/design-tokens"],
};

export default nextConfig;
