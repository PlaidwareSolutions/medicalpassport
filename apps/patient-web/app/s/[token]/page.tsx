"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, type VisitSummaryDto } from "@medpass/api-client";
import { Card, Chip, SectionTitle } from "@medpass/ui-web";
import { api } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";

/**
 * Public share view (docs/07 screen: doctor scans QR / opens link). No
 * authentication, no AppShell — this is what a doctor or pharmacist sees.
 * Never cached (docs/26): the API sets Cache-Control: private, no-store.
 */
export default function PublicSharePage() {
  const { t } = useI18n();
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<VisitSummaryDto | undefined>();
  const [notAvailable, setNotAvailable] = useState(false);

  useEffect(() => {
    api
      .get<VisitSummaryDto>(`/public/shares/${params.token}`)
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotAvailable(true);
      });
  }, [params.token]);

  if (notAvailable) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-xl) var(--space-md)", textAlign: "center" }}>
        <h1 style={{ fontSize: "var(--font-title)" }}>{t("share.not_available_title")}</h1>
        <p style={{ color: "var(--color-text-muted)" }}>{t("share.not_available_body")}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-xl) var(--space-md)" }}>
        <p style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "var(--space-md)" }}>
      <div style={{ background: "var(--color-primary-soft)", padding: "var(--space-sm)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-md)" }}>
        <strong>{t("app.name")}</strong> — {t("share.shared_summary_label")}
      </div>

      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-xs)" }}>{data.profile.displayName}</h1>
      <p style={{ margin: "0 0 var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {t("visit.generated_at", { time: new Date(data.generatedAt).toLocaleString() })}
      </p>
      <a
        href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/public/shares/${params.token}/pdf`}
        style={{
          display: "inline-block",
          marginBottom: "var(--space-md)",
          color: "var(--color-primary)",
          fontSize: "var(--font-small)",
          fontWeight: 600,
        }}
      >
        {t("share.download_pdf")}
      </a>

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
              <Card key={i}>
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
    </main>
  );
}
