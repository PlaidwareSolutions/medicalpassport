import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomePage } from "../../../components/HomePage";
import { pageMetadata } from "../../../lib/seo";
import { t } from "../../../lib/i18n";
import { buildLocales, isMarketingLocale, nonEnglishBuildLocales, PUBLISHED_LOCALES } from "../../../lib/locales";
import type { MarketingLocale } from "../../../lib/locales";

/** Same emission rule as the layout — see buildLocales(). */
export function generateStaticParams(): { locale: string }[] {
  return nonEnglishBuildLocales().map((locale) => ({ locale }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isMarketingLocale(locale)) return {};
  const base = pageMetadata(locale, "", `${t(locale, "brand.name")} ${t(locale, "brand.endorsement")}`, t(locale, "hero.sub"));
  // Draft locales are noindexed at the page level too (belt-and-braces with the
  // staging host X-Robots-Tag); they must never be indexed until reviewed.
  return PUBLISHED_LOCALES.includes(locale) ? base : { ...base, robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isMarketingLocale(locale) || !buildLocales().includes(locale)) notFound();
  return <HomePage locale={locale as MarketingLocale} />;
}
