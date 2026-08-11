import type { MarketingLocale } from "../lib/locales";
import { PROFESSIONAL_UNIT_ENABLED } from "../lib/release-flags";
import {
  Hero,
  Problem,
  Reveal,
  Know,
  Remember,
  Accessible,
  Offline,
  Caregiving,
  Share,
  Free,
  Trust,
  ProfessionalBridge,
  Faq,
  FinalCta,
} from "./sections";

/**
 * Homepage narrative S1–S14 (docs/landing-page/04-content-spec.md).
 *
 * Gated composition (OD-LP-10 + Session 3 addendum): S9 (Share) and S12
 * (professional bridge) belong to the professional release unit and are not
 * imported/rendered while lib/release-flags.ts PROFESSIONAL_UNIT_ENABLED is
 * false — the page seams S8 → S10 and S11 → S13 by design, with no
 * placeholders. When Stage 7 security review clears the unit, the Share and
 * Bridge sections are added to ./sections and composed here behind the flag.
 */
export function HomePage({ locale }: { locale: MarketingLocale }) {
  return (
    <>
      <Hero locale={locale} />
      <Problem locale={locale} />
      <Reveal locale={locale} />
      <Know locale={locale} />
      <Remember locale={locale} />
      <Accessible locale={locale} />
      <Offline locale={locale} />
      <Caregiving locale={locale} />
      {PROFESSIONAL_UNIT_ENABLED ? <Share locale={locale} /> : null}
      <Free locale={locale} />
      <Trust locale={locale} />
      {PROFESSIONAL_UNIT_ENABLED ? <ProfessionalBridge locale={locale} /> : null}
      <Faq locale={locale} />
      <FinalCta locale={locale} />
    </>
  );
}
