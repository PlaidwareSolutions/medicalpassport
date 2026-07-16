"use client";
import { Card } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { useI18n } from "../../lib/i18n";

/**
 * Screen 21: safety review results (docs/07). The deterministic safety engine
 * ships in Stage 6 — until then this surface is honest about its status and
 * never implies "no concerns" means safety is guaranteed.
 */
export default function SafetyPage() {
  const { t } = useI18n();
  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("safety.title")}</h1>
      <Card tone="info">
        <span>{t("safety.coming")}</span>
      </Card>
      <Card>
        <span style={{ color: "var(--color-text-muted)" }}>{t("safety.empty")}</span>
      </Card>
    </AppShell>
  );
}
