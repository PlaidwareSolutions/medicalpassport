import type { ReactNode } from "react";
import { marketingStyles } from "../../lib/marketing-styles";
import { t } from "../../lib/i18n";
import { buildLocales } from "../../lib/locales";
import { SiteHeader } from "../../components/SiteHeader";
import { SiteFooter } from "../../components/SiteFooter";
import { AnalyticsBeacon } from "../../components/AnalyticsBeacon";

/**
 * English root layout ("/", "/privacy/", "/terms/"). Non-English locales get
 * their own root layout under app/(locales)/[locale] with correct static
 * lang/dir. The language switcher lists whichever locales this build emits
 * (buildLocales(): production = published only; staging = drafts too).
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
        <SiteHeader locale="en" availableLocales={buildLocales()} />
        <main id="main">{children}</main>
        <SiteFooter locale="en" />
        <AnalyticsBeacon />
      </body>
    </html>
  );
}
