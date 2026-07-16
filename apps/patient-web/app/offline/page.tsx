"use client";
import { Button } from "@medpass/ui-web";
import { useI18n } from "../../lib/i18n";

/** Offline navigation fallback served by the service worker (docs/07 shared defaults). */
export default function OfflinePage() {
  const { t } = useI18n();
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-xl) var(--space-md)", textAlign: "center", display: "flex", flexDirection: "column", gap: "var(--space-lg)", minHeight: "100dvh", justifyContent: "center" }}>
      <div aria-hidden="true" style={{ fontSize: "3rem" }}>📴</div>
      <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>{t("offline.title")}</h1>
      <p style={{ color: "var(--color-text-muted)", margin: 0 }}>{t("offline.body")}</p>
      <Button fullWidth onClick={() => window.location.reload()}>
        {t("common.retry")}
      </Button>
    </main>
  );
}
