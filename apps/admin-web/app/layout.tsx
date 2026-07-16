import type { ReactNode } from "react";
import { cssVariables } from "@medpass/design-tokens";

export const metadata = {
  title: "Medicine Passport — Clinical Administration",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVariables() }} />
      </head>
      <body style={{ fontFamily: "var(--font-family)", margin: 0, background: "var(--color-surface)" }}>{children}</body>
    </html>
  );
}
