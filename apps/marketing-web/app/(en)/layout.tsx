import type { ReactNode } from "react";
import { marketingStyles } from "../../lib/marketing-styles";
import { t } from "../../lib/i18n";
import { SiteHeader } from "../../components/SiteHeader";
import { SiteFooter } from "../../components/SiteFooter";
import { AnalyticsBeacon } from "../../components/AnalyticsBeacon";

/**
 * English root layout ("/", "/privacy/", "/terms/"). Non-English published
 * locales get their own root layout under app/(locales)/ so static HTML
 * carries the correct lang/dir per route (docs/landing-page/00 §1.3).
 */
export default function EnLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <style dangerouslySetInnerHTML={{ __html: marketingStyles() }} />
      </head>
      <body>
        <a className="mkt-skip" href="#main">
          {t("en", "nav.skip")}
        </a>
        <SiteHeader locale="en" />
        <main id="main">{children}</main>
        <SiteFooter locale="en" />
        <AnalyticsBeacon />
      </body>
    </html>
  );
}
