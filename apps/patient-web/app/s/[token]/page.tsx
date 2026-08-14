"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, type VisitSummaryDto } from "@medpass/api-client";
import { PillSpinner } from "@medpass/ui-web";
import { VisitSummarySections } from "../../../components/VisitSummarySections";
import { api } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import { formatPatientDateTime } from "../../../lib/patient-time";

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
        <PillSpinner label={t("common.loading")} />
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
        {t("visit.generated_at", { time: formatPatientDateTime(data.generatedAt, data.profile.timezone) })}
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

      {/* Concern severity is shown without a color tone here — the public
          view is read by a clinician, who reads the finding itself rather
          than needing the patient-facing urgency cue. */}
      <VisitSummarySections data={data} concernTones={false} />
    </main>
  );
}
