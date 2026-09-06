import type { ReactNode } from "react";
import { headers } from "next/headers";
import { cssVariables } from "@medpass/design-tokens";
import { ProviderSessionProvider } from "../lib/session";

export const metadata = {
  title: "Medicine Passport — Clinic",
  robots: { index: false, follow: false },
};

/**
 * Reading the request headers here (for the CSP nonce, middleware.ts) also
 * makes every route render per request — required for the nonce to reach
 * the script tags; nothing on this portal is cacheable anyway.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <head>
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: cssVariables() }} />
      </head>
      <body style={{ fontFamily: "var(--font-family)", margin: 0, background: "var(--color-bg)", color: "var(--color-text)" }}>
        <ProviderSessionProvider>{children}</ProviderSessionProvider>
      </body>
    </html>
  );
}
