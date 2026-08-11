import type { Metadata } from "next";
import { t } from "../../../lib/i18n";
import { pageMetadata } from "../../../lib/seo";

/**
 * Structural placeholder (SPEC §28). Real policy text is drafted for legal
 * review in Session 12 and published only with OD-LP-6 approval — this stub
 * is explicitly not policy and stays noindexed until then.
 */
export const metadata: Metadata = {
  ...pageMetadata("en", "privacy", "Privacy policy | Medicine Passport", "Privacy policy for Medicine Passport by MediDocs."),
  robots: { index: false },
};

export default function Page() {
  return (
    <section className="mkt-section">
      <div className="mkt-container-text">
        <h1>{t("en", "placeholder.privacy.title")}</h1>
        <p className="mkt-muted" style={{ marginTop: "16px" }}>
          {t("en", "placeholder.legal.body")}
        </p>
      </div>
    </section>
  );
}
