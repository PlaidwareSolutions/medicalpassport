"use client";
import Link from "next/link";
import { Card, Chip, SectionTitle } from "@medpass/ui-web";
import { kindGlyph, kindLabelKey, useLinkedDocuments } from "../lib/documents";
import { useI18n } from "../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../lib/patient-time";
import { GuideGlyph } from "./GuideGlyph";

/**
 * The V2 documents a prescription or report was read from (docs_v2/09 §1
 * rule 2 — every record walks back to its pages). Renders nothing when
 * there are none, so the V1 detail screens it is appended to look exactly
 * as before for records that were typed in by hand.
 */
export function LinkedDocumentsSection(props: { prescriptionId: string } | { diagnosticReportId: string }) {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items } = useLinkedDocuments(props);
  if (!items || items.length === 0) return null;

  return (
    <section aria-label={t("documents.linked_title")} data-testid="linked-documents">
      <SectionTitle>{t("documents.linked_title")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {items.map((d) => (
          <Link key={d.id} href={`/documents/${d.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                <span style={{ color: "var(--color-primary)" }}>
                  <GuideGlyph name={kindGlyph(d.kind)} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{d.title ?? t(kindLabelKey(d.kind))}</strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {t("documents.pages_count", { n: d.pageCount })} · {formatPatientDate(d.createdAt, timezone)}
                  </div>
                </div>
                <Chip>{t("documents.open")}</Chip>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
