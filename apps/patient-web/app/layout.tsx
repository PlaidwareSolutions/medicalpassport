import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { cssVariables } from "@medpass/design-tokens";
import { I18nProvider } from "../lib/i18n";
import { SessionProvider } from "../lib/session";

export const metadata: Metadata = {
  title: "Medicine Passport",
  description: "Keep all your medicines in one place. Not a replacement for your doctor.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MedPassport" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0f6b54",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const globalCss = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:var(--font-family);color:var(--color-text);background:var(--color-bg);font-size:var(--font-body);line-height:1.5}
a{color:inherit;text-decoration:none}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
:focus-visible{outline:3px solid var(--color-info);outline-offset:2px}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVariables() + globalCss }} />
      </head>
      <body>
        <I18nProvider>
          <SessionProvider>{children}</SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
