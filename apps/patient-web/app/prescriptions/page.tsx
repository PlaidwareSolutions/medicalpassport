"use client";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { usePrescriptions } from "../../lib/prescriptions";

/** Screen 43 (docs/07): the standing archive of prescriptions, newest visit first. */
export default function PrescriptionsPage() {
  const { t } = useI18n();
  const { items, error } = usePrescriptions();

  return (
    <AppShell>
      <PageHeader title={t("prescriptions.title")} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      <Link href="/prescriptions/new">
        <Button fullWidth>{t("prescriptions.add")}</Button>
      </Link>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("prescriptions.empty")}</span>
        </Card>
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((p) => (
            <Link key={p.id} href={`/prescriptions/${p.id}`}>
              <Card>
                <strong>{p.practitionerName ?? t("prescriptions.unnamed_doctor")}</strong>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {p.prescribedAt
                    ? new Date(p.prescribedAt).toLocaleDateString()
                    : t("prescriptions.no_date")}
                </div>
                <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-xs)", flexWrap: "wrap" }}>
                  <Chip>{t("prescriptions.document_count", { count: p.documentCount })}</Chip>
                  <Chip>{t("prescriptions.medication_count", { count: p.medicationCount })}</Chip>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
