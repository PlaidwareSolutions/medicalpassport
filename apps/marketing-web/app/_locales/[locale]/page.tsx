import { notFound } from "next/navigation";
import { HomePage } from "../../../components/HomePage";
import { isMarketingLocale, PUBLISHED_LOCALES } from "../../../lib/locales";

/** Same emission rule as the layout: published non-English locales only. */
export function generateStaticParams(): { locale: string }[] {
  return PUBLISHED_LOCALES.filter((l) => l !== "en").map((locale) => ({ locale }));
}

export const dynamicParams = false;

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isMarketingLocale(locale) || !PUBLISHED_LOCALES.includes(locale)) notFound();
  return <HomePage locale={locale} />;
}
