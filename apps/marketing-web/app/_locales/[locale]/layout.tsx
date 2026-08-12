import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { marketingStyles } from "../../../lib/marketing-styles";
import { t } from "../../../lib/i18n";
import { direction, isMarketingLocale, PUBLISHED_LOCALES } from "../../../lib/locales";
import { SiteHeader } from "../../../components/SiteHeader";
import { SiteFooter } from "../../../components/SiteFooter";
import { AnalyticsBeacon } from "../../../components/AnalyticsBeacon";

/**
 * Root layout for non-English published locales (/hi/, /te/, /ur/).
 *
 * PARKED as a Next.js private folder (`_locales` is excluded from routing)
 * because `output: "export"` rejects a dynamic route whose
 * generateStaticParams returns [] — verified empirically this session — and
 * no non-English marketing locale is published yet (OD-LP-4). The code stays
 * typechecked and review-current. ACTIVATION, when the first reviewed locale
 * ships: (1) add the reviewed dictionary to lib/i18n.ts, (2) add the locale
 * to PUBLISHED_LOCALES, (3) rename `app/_locales` → `app/(locales)`. Routes
 * then emit with correct static lang/dir, including RTL for Urdu.
 */
export function generateStaticParams(): { locale: string }[] {
  return PUBLISHED_LOCALES.filter((l) => l !== "en").map((locale) => ({ locale }));
}

export const dynamicParams = false;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isMarketingLocale(locale) || !PUBLISHED_LOCALES.includes(locale)) notFound();
  return (
    <html lang={locale} dir={direction(locale)}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: marketingStyles() }} />
      </head>
      <body>
        <a className="mkt-skip" href="#main">
          {t(locale, "nav.skip")}
        </a>
        <SiteHeader locale={locale} />
        <main id="main">{children}</main>
        <SiteFooter locale={locale} />
        <AnalyticsBeacon />
      </body>
    </html>
  );
}
