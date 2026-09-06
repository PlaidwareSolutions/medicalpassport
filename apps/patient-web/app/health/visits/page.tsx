"use client";
import Link from "next/link";
import { Banner, Button, Card, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { GuideGlyph } from "../../../components/GuideGlyph";
import { PageHeader } from "../../../components/PageHeader";
import { TrustBadge } from "../../../components/TrustBadge";
import { encounterDoctor, encounterPlace, useEncounters } from "../../../lib/encounters";
import { useI18n } from "../../../lib/i18n";
import { formatPatientDateTime, useActiveTimezone } from "../../../lib/patient-time";

/** Visits & admissions (docs_v2/06 P1-4): the encounter list, newest first. */
export default function VisitsPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items, error, fromCache } = useEncounters();

  return (
    <AppShell>
      <PageHeader title={t("encounter.title")} readAloud={[{ audio: "screen.visits" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}

      <Link href="/health/visits/new">
        <Button fullWidth>{t("encounter.add")}</Button>
      </Link>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState glyph="hospital" titleKey="encounter.empty_title" bodyKey="encounter.empty_body" />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((e) => (
            <Link key={e.id} href={`/health/visits/${e.id}`}>
              <Card style={{ flexDirection: "row", alignItems: "flex-start", gap: "var(--space-md)" }}>
                <span style={{ color: "var(--color-primary)", flexShrink: 0, marginTop: "0.2em" }}>
                  <GuideGlyph name="hospital" size="md" />
                </span>
                <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                  <strong>{t(`encounter.kind.${e.kind}` as never)}</strong>
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {formatPatientDateTime(e.startedAt, timezone)}
                    {encounterPlace(e) ? ` · ${encounterPlace(e)}` : ""}
                    {encounterDoctor(e) ? ` · ${encounterDoctor(e)}` : ""}
                  </span>
                  {e.reasonText ? <span>{e.reasonText}</span> : null}
                  <span style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                    <TrustBadge verification={e.verification} provenanceSource={e.provenanceSource} />
                  </span>
                </span>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
