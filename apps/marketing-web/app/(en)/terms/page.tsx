import type { Metadata } from "next";
import { t } from "../../../lib/i18n";
import { pageMetadata } from "../../../lib/seo";

/** Structural placeholder — see privacy/page.tsx; same OD-LP-6 gate. */
export const metadata: Metadata = {
  ...pageMetadata("en", "terms", "Terms of use | Medicine Passport", "Terms of use for Medicine Passport by MediDocs."),
  robots: { index: false },
};

export default function Page() {
  return (
    <section className="mkt-section">
      <div className="mkt-container-text">
        <h1>{t("en", "placeholder.terms.title")}</h1>
        <p className="mkt-muted" style={{ marginTop: "16px" }}>
          {t("en", "placeholder.legal.body")}
        </p>
      </div>
    </section>
  );
}
