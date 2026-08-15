import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClinicsPage } from "../../../components/ClinicsPage";
import { t } from "../../../lib/i18n";
import { PROFESSIONAL_UNIT_ENABLED } from "../../../lib/release-flags";
import { LEAD_TURNSTILE_SITEKEY } from "../../../lib/lead-api";
import { pageMetadata, SITE_ORIGIN } from "../../../lib/seo";

/**
 * /for-clinics/ (C1–C7). Part of the professional release unit — when the
 * gate is OFF the whole route 404s (no page emitted, no reachable content),
 * matching the OD-LP-10 "clean seams" contract. English only in V1.
 */
export const metadata: Metadata = {
  ...pageMetadata("en", "", t("en", "clinics.meta_title"), t("en", "clinics.meta_description")),
  // Same production-ready canonical/OG as home; staging stays noindexed via
  // the host-scoped header + robots regardless.
  alternates: { canonical: `${SITE_ORIGIN}/for-clinics/` },
};

export default function Page() {
  if (!PROFESSIONAL_UNIT_ENABLED) notFound();
  return (
    <>
      <ClinicsPage locale="en" />
      {/* Turnstile loads ONLY on this route (not the patient homepage, §34),
          and only when a sitekey is configured. */}
      {LEAD_TURNSTILE_SITEKEY ? (
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      ) : null}
    </>
  );
}
