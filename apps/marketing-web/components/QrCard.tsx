import QRCode from "qrcode";
import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";
import { appCtaUrl } from "./CtaLink";

/**
 * Desktop QR card (S1/S14). Generated at BUILD time by an async server
 * component — deterministic static SVG in the export, zero client JS, zero
 * runtime work. Uses the workspace's existing `qrcode` package (same version
 * patient-web already depends on — no new external dependency). Target is
 * exactly the approved attribution URL. Hidden below 900px via the
 * mkt-desktop-only pattern (mobile users tap the CTA instead).
 */
export async function QrCard({ locale }: { locale: MarketingLocale }) {
  const svg = await QRCode.toString(appCtaUrl(locale), {
    type: "svg",
    margin: 0,
    color: { dark: "#1a1f1d", light: "#ffffff" },
  });
  return (
    <div
      className="mkt-desktop-flex"
      style={{
        background: "var(--mkt-surface)",
        border: "1px solid var(--mkt-hairline)",
        borderRadius: "14px",
        padding: "12px",
        gap: "12px",
        alignItems: "center",
        maxWidth: "250px",
      }}
    >
      <div style={{ width: "64px", height: "64px", flex: "none" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
      <a
        href={appCtaUrl(locale)}
        className="mkt-muted"
        style={{ fontSize: "0.8125rem", fontWeight: 500, textDecoration: "none", lineHeight: 1.4 }}
      >
        {t(locale, "final.qr")}
      </a>
    </div>
  );
}
