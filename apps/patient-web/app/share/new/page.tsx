"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Banner, Button, Card, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { useI18n } from "../../../lib/i18n";
import { createShare, shareUrl, shareVisitSummaryViaWhatsApp } from "../../../lib/sharing";

const SECTION_KEYS = ["medications", "allergies", "conditions", "recentChanges", "concerns"] as const;
const EXPIRY_OPTIONS = [
  { hours: 1, key: "share.expiry.1h" },
  { hours: 24, key: "share.expiry.24h" },
  { hours: 24 * 7, key: "share.expiry.7d" },
] as const;

/** Screen 29: create a share — selective sections, expiry, QR + copyable link. */
export default function CreateSharePage() {
  const { t } = useI18n();
  const [sections, setSections] = useState<Record<string, boolean>>(
    Object.fromEntries(SECTION_KEYS.map((k) => [k, true])),
  );
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string } | undefined>();
  const [copied, setCopied] = useState(false);
  const [whatsAppBusy, setWhatsAppBusy] = useState(false);
  const [whatsAppError, setWhatsAppError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (result && canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, result.url, { width: 220, margin: 1 });
    }
  }, [result]);

  async function create() {
    setBusy(true);
    try {
      const res = await createShare({ sections, expiresInHours, kind: "qr" });
      setResult({ url: shareUrl(res.token) });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareViaWhatsApp() {
    setWhatsAppBusy(true);
    setWhatsAppError(false);
    try {
      await shareVisitSummaryViaWhatsApp(sections);
    } catch {
      setWhatsAppError(true);
    } finally {
      setWhatsAppBusy(false);
    }
  }

  if (result) {
    return (
      <AppShell>
        <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("share.ready_title")}</h1>
        <Card>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <canvas ref={canvasRef} role="img" aria-label={t("share.qr_code_alt")} />
          </div>
          <div
            style={{
              wordBreak: "break-all",
              fontSize: "var(--font-small)",
              color: "var(--color-text-muted)",
              textAlign: "center",
            }}
          >
            {result.url}
          </div>
          <Button fullWidth onClick={() => void copy()}>
            {copied ? t("share.copied") : t("share.copy_link")}
          </Button>
        </Card>
        <Banner tone="info">{t("share.revocable_note")}</Banner>
        <Link href="/share">
          <Button variant="secondary" fullWidth>
            {t("share.view_all")}
          </Button>
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("share.new_title")}</h1>

      <SectionTitle>{t("share.sections_label")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {SECTION_KEYS.map((key) => (
          <label
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              minHeight: "var(--size-touch)",
              padding: "var(--space-sm)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={sections[key]}
              onChange={(e) => setSections((s) => ({ ...s, [key]: e.target.checked }))}
              style={{ width: 24, height: 24 }}
            />
            {t(`share.section.${key}` as never)}
          </label>
        ))}
      </div>

      <SectionTitle>{t("share.expiry_label")}</SectionTitle>
      <div style={{ display: "flex", gap: "var(--size-touch-gap)" }}>
        {EXPIRY_OPTIONS.map((opt) => (
          <Button
            key={opt.hours}
            variant={expiresInHours === opt.hours ? "primary" : "secondary"}
            onClick={() => setExpiresInHours(opt.hours)}
          >
            {t(opt.key as never)}
          </Button>
        ))}
      </div>

      <Button fullWidth disabled={busy} onClick={() => void create()}>
        {t("share.create")}
      </Button>

      <div style={{ height: "var(--space-md)" }} />
      {whatsAppError ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      <Button variant="secondary" fullWidth disabled={whatsAppBusy} onClick={() => void shareViaWhatsApp()}>
        {t("share.whatsapp_button")}
      </Button>
    </AppShell>
  );
}
