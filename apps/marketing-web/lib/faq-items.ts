import type { MessageKey } from "./i18n";

/**
 * Rendered FAQ items (S13) — single source of truth shared by the FAQ
 * section and the FAQPage JSON-LD so structured data always mirrors what is
 * actually on the page. Q5 (doctor account — security-gated) is absent;
 * Q6's answer is the honest negative only (capability sentence
 * clinical-gated); Q9/Q10 use caregiver framing because sharing claims are
 * security-gated (docs/landing-page/02, OD-LP-10).
 */
export const FAQ_ITEMS: { q: MessageKey; a: MessageKey }[] = [
  { q: "faq.q1", a: "faq.a1" },
  { q: "faq.q2", a: "faq.a2" },
  { q: "faq.q3", a: "faq.a3" },
  { q: "faq.q4", a: "faq.a4" },
  { q: "faq.q6", a: "faq.a6" },
  { q: "faq.q7", a: "faq.a7" },
  { q: "faq.q8", a: "faq.a8" },
  { q: "faq.q9", a: "faq.a9" },
  { q: "faq.q10", a: "faq.a10" },
];
