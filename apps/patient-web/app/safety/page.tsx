"use client";
import { Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { FindingCard } from "../../components/FindingCard";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { isOpenFinding, useSafetyFindings } from "../../lib/safety";

/**
 * Screen 21: safety review results (docs/07). Duplicate-ingredient,
 * therapeutic-class, and drug-allergy checks run on Railway (docs/09) —
 * this screen only renders what the server already decided.
 */
export default function SafetyPage() {
  const { t } = useI18n();
  const { items, error, reload } = useSafetyFindings();

  const open = (items ?? []).filter(isOpenFinding);
  const resolved = (items ?? []).filter((f) => !isOpenFinding(f));

  return (
    <AppShell>
      <PageHeader title={t("safety.title")} readAloud={[{ audio: "screen.safety" }]} />

      {error ? <Card tone="danger">{t("common.error_generic")}</Card> : null}
      {!items && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && open.length === 0 ? (
        // The caveat sentence is clinically load-bearing (docs/02): "none
        // found" must never read as "none exist".
        <EmptyState glyph="shield" titleKey="safety.empty_title" bodyKey="safety.empty_body" audioId="empty.safety" tone="info" />
      ) : null}

      {open.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {open.map((f) => (
            <FindingCard key={f.id} finding={f} onChanged={reload} />
          ))}
        </div>
      ) : null}

      {resolved.length > 0 ? (
        <>
          <SectionTitle>{t("safety.resolved_findings")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {resolved.map((f) => (
              <FindingCard key={f.id} finding={f} onChanged={reload} />
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
