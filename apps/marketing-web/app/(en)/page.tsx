import type { Metadata } from "next";
import { HomePage } from "../../components/HomePage";
import { en } from "../../lib/dictionaries/en";
import { FAQ_ITEMS } from "../../lib/faq-items";
import { OG_IMAGE_URL } from "../../lib/published-media";
import { pageMetadata, SITE_ORIGIN } from "../../lib/seo";

const base = pageMetadata(
  "en",
  "",
  "Medicine Passport — your medicines, one place, in your language | by MediDocs",
  "A free, patient-held medicine record that works from any mobile browser. Keep track of what you take, why, and when — and show your doctor, wherever you go.",
);

/** OG image: published hashed asset (Session 4 ruling — lockup + authentic
 *  product UI; the MP monogram stays a favicon, never the social identity). */
export const metadata: Metadata = {
  ...base,
  openGraph: {
    ...base.openGraph,
    ...(OG_IMAGE_URL ? { images: [{ url: OG_IMAGE_URL, width: 1200, height: 630 }] } : {}),
  },
};

/**
 * Structured data (03 §7): WebSite + Organization + FAQPage only — no
 * medical/efficacy schema (MKT-092). FAQPage is generated from the exact
 * FAQ_ITEMS the page renders, so it can never advertise gated/omitted
 * answers. Emitted as an inline JSON-LD script (covered by the CSP's
 * script-src 'unsafe-inline', already required by Next's own bootstrap).
 */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "MediDocs",
      url: SITE_ORIGIN,
    },
    {
      "@type": "WebSite",
      name: "Medicine Passport by MediDocs",
      url: SITE_ORIGIN,
      inLanguage: "en",
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
        "@type": "Question",
        name: en[q],
        acceptedAnswer: { "@type": "Answer", text: en[a] },
      })),
    },
  ],
};

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <HomePage locale="en" />
    </>
  );
}
