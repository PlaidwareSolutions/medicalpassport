"use client";
import { useId, useMemo, useState } from "react";
import Link from "next/link";
import type { PrescriptionDto } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { formatCalendarDate } from "../../lib/patient-time";
import { usePrescriptions } from "../../lib/prescriptions";

/**
 * Screen 43 (docs/07): the standing archive of prescriptions, grouped by
 * doctor — "everything Dr. X prescribed" is the question this screen
 * answers now that doctors are shared records. Groups collapse to one row
 * per doctor (name + how many prescriptions), expanding on tap — a patient
 * with years of visits scans a short list of doctors, not a wall of dates.
 * Groups are ordered by their most recent visit (the API list is already
 * newest-first, so first appearance is recency); prescriptions with no
 * doctor recorded gather in one group at the end.
 */
export default function PrescriptionsPage() {
  const { t } = useI18n();
  const { items, error } = usePrescriptions();

  const groups = useMemo(() => {
    const byDoctor = new Map<string, { name: string | null; prescriptions: PrescriptionDto[] }>();
    for (const p of items ?? []) {
      const key = p.practitionerName ?? "";
      const group = byDoctor.get(key) ?? { name: p.practitionerName, prescriptions: [] };
      group.prescriptions.push(p);
      byDoctor.set(key, group);
    }
    const all = [...byDoctor.values()];
    return [...all.filter((g) => g.name !== null), ...all.filter((g) => g.name === null)];
  }, [items]);

  return (
    <AppShell>
      <PageHeader title={t("prescriptions.title")} readAloud={[{ audio: "screen.prescriptions" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      <Link href="/prescriptions/new">
        <Button fullWidth>{t("prescriptions.add")}</Button>
      </Link>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState
          glyph="prescription"
          titleKey="prescriptions.empty_title"
          bodyKey="prescriptions.empty_body"
          audioId="empty.prescriptions"
          cta={{ labelKey: "prescriptions.add", href: "/prescriptions/new" }}
        />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {groups.map((group) => (
            <DoctorGroup
              key={group.name ?? "__unnamed__"}
              name={group.name ?? t("prescriptions.unnamed_doctor")}
              prescriptions={group.prescriptions}
            />
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}

function DoctorGroup({ name, prescriptions }: { name: string; prescriptions: PrescriptionDto[] }) {
  const { t } = useI18n();
  const regionId = useId();
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <Card>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setExpanded((v) => !v)}
          style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", alignItems: "center", gap: "var(--space-sm)" }}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          <strong style={{ flex: 1 }}>{name}</strong>
          <Chip>{t("prescriptions.count", { count: prescriptions.length })}</Chip>
        </button>
      </Card>
      {expanded ? (
        <div
          id={regionId}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)", marginInlineStart: "var(--space-md)" }}
        >
          {prescriptions.map((p) => (
            <Link key={p.id} href={`/prescriptions/${p.id}`}>
              <Card>
                <strong>{p.prescribedAt ? formatCalendarDate(p.prescribedAt) : t("prescriptions.no_date")}</strong>
                <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-xs)", flexWrap: "wrap" }}>
                  <Chip>{t("prescriptions.document_count", { count: p.documentCount })}</Chip>
                  <Chip>{t("prescriptions.medication_count", { count: p.medicationCount })}</Chip>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
