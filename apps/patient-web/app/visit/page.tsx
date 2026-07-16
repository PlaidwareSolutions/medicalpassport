"use client";
import Link from "next/link";
import { Banner, Button, Card, Chip, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { useI18n } from "../../lib/i18n";
import { useVisitSummary } from "../../lib/sharing";

const SEVERITY_TONE: Record<string, "default" | "warning" | "danger"> = {
  info: "default",
  low: "default",
  moderate: "warning",
  high: "danger",
};

/**
 * Screen 28: doctor-visit mode (docs/07). Dense but readable, designed to
 * work offline (cached) and be read at arm's length in a clinic.
 */
export default function VisitModePage() {
  const { t } = useI18n();
  const { data, error } = useVisitSummary();

  if (error) {
    return (
      <AppShell>
        <Banner tone="danger">{t("common.error_generic")}</Banner>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell>
        <p style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-xs)" }}>{data.profile.displayName}</h1>
      <p style={{ margin: "0 0 var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {t("visit.generated_at", { time: new Date(data.generatedAt).toLocaleString() })}
      </p>

      <Link href="/share/new">
        <Button fullWidth>{t("visit.share_button")}</Button>
      </Link>

      {data.allergies && data.allergies.length > 0 ? (
        <>
          <SectionTitle>{t("profile.allergies")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {data.allergies.map((a, i) => (
              <Card key={i} tone={a.severity === "severe" ? "danger" : "default"}>
                <strong>{a.label}</strong> <Chip>{t(`allergy.severity.${a.severity}` as never)}</Chip>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.conditions && data.conditions.length > 0 ? (
        <>
          <SectionTitle>{t("profile.conditions")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {data.conditions.map((c, i) => (
              <Card key={i}>
                <strong>{c.label}</strong>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.currentMedications && data.currentMedications.length > 0 ? (
        <>
          <SectionTitle>{t("meds.current")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {data.currentMedications.map((m) => (
              <Card key={m.id}>
                <strong style={{ fontSize: "var(--font-large)" }}>{m.name}</strong>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {m.ingredients.join(" + ")} {m.strengthLabel ?? ""}
                </span>
                <span style={{ fontSize: "var(--font-small)" }}>{m.instructionSummary}</span>
                {m.prescriberName ? (
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {t("meds.prescribed_by", { name: m.prescriberName })}
                  </span>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.unresolvedConcerns && data.unresolvedConcerns.length > 0 ? (
        <>
          <SectionTitle>{t("home.concerns")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {data.unresolvedConcerns.map((c, i) => (
              <Card key={i} tone={SEVERITY_TONE[c.severity]}>
                <strong>{t(`safety.finding.${c.category}` as never)}</strong>
                <span style={{ fontSize: "var(--font-small)" }}>{c.summary}</span>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {data.recentChanges && data.recentChanges.length > 0 ? (
        <>
          <SectionTitle>{t("visit.recent_changes")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {data.recentChanges.slice(0, 5).map((c, i) => (
              <Card key={i}>
                <span style={{ fontSize: "var(--font-small)" }}>
                  {c.medicationName} — {c.change} ({new Date(c.occurredAt).toLocaleDateString()})
                </span>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
