import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { marketingStyles } from "../../../lib/marketing-styles";
import { t } from "../../../lib/i18n";
import { buildLocales, direction, isMarketingLocale, nonEnglishBuildLocales, PUBLISHED_LOCALES } from "../../../lib/locales";
import { SiteHeader } from "../../../components/SiteHeader";
import { SiteFooter } from "../../../components/SiteFooter";
import { AnalyticsBeacon } from "../../../components/AnalyticsBeacon";
import { ReviewBanner } from "../../../components/ReviewBanner";

/**
 * Root layout for non-English locale routes (/hi/, /te/, /ur/), emitting
 * correct static `lang`/`dir` per locale (RTL for Urdu). Session 13.
 *
 * Publication gate: production emits only PUBLISHED_LOCALES; staging emits the
 * draft candidates too (buildLocales()). A draft (not-yet-reviewed) locale
 * shows a review banner and is never produced by a production build.
 */
export function generateStaticParams(): { locale: string }[] {
  return nonEnglishBuildLocales().map((locale) => ({ locale }));
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
  if (!isMarketingLocale(locale) || !buildLocales().includes(locale)) notFound();
  const isDraft = !PUBLISHED_LOCALES.includes(locale);
  return (
    <html lang={locale} dir={direction(locale)}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: marketingStyles() }} />
      </head>
      <body>
        <a className="mkt-skip" href="#main">
          {t(locale, "nav.skip")}
        </a>
        {isDraft ? <ReviewBanner locale={locale} /> : null}
        <SiteHeader locale={locale} availableLocales={buildLocales()} />
        <main id="main">{children}</main>
        <SiteFooter locale={locale} />
        <AnalyticsBeacon />
      </body>
    </html>
  );
}
