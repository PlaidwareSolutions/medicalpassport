"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { DocumentUploadButtons } from "../../../components/DocumentUploadButtons";
import { PageHeader } from "../../../components/PageHeader";
import { documentKindFor, MAX_IMAGE_BYTES, uploadDocument } from "../../../lib/document-upload";
import { useI18n } from "../../../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../../../lib/patient-time";
import { documentDownloadUrl } from "../../../lib/prescriptions";
import { addReportValue, deleteReport, deleteReportValue, useReport } from "../../../lib/reports";
import { ReportValuesSection } from "../../../components/ReportValuesSection";

/** Screen 44 (docs/07): one test report — its details and the filed documents. */
export default function ReportDetailPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { report, error, reload } = useReport(params.id);
  const [actionError, setActionError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // A report is routinely several pages; more can be added any time after
  // filing (docs/07 §44) — same authorize→PUT→complete path the new-report
  // flow uses, appended to this record.
  async function addPages(files: File[]) {
    if (!report) return;
    setActionError(undefined);
    const valid = files.filter((f) => f.size <= MAX_IMAGE_BYTES || f.type === "application/pdf");
    if (valid.length < files.length) setActionError(t("scan.upload_error"));
    if (valid.length === 0) return;
    setUploading(true);
    try {
      for (const file of valid) await uploadDocument(file, { kind: documentKindFor(report.kind), reportId: report.id });
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("scan.upload_error"));
    } finally {
      setUploading(false);
    }
  }

  async function openDocument(documentId: string) {
    setActionError(undefined);
    try {
      window.open(await documentDownloadUrl(documentId), "_blank", "noopener");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    }
  }

  async function remove() {
    if (!window.confirm(t("reports.delete_confirm"))) return;
    setBusy(true);
    try {
      await deleteReport(params.id);
      router.replace("/reports");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
      setBusy(false);
    }
  }

  if (error && !report) {
    return (
      <AppShell>
        <Banner tone="danger">{t("common.error_generic")}</Banner>
      </AppShell>
    );
  }
  if (!report) {
    return (
      <AppShell>
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t(`reports.kind.${report.kind}` as never)} />
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      <Card>
        {report.label ? <strong>{report.label}</strong> : null}
        <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {report.testedAt ? new Date(report.testedAt).toLocaleDateString() : t("reports.no_date")}
        </div>
        {report.facilityName ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{report.facilityName}</div>
        ) : null}
        {report.practitionerName ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {t("reports.ordered_by", { name: report.practitionerName })}
          </div>
        ) : null}
        {report.notes ? <div style={{ marginTop: "var(--space-xs)" }}>{report.notes}</div> : null}
      </Card>

      <ReportValuesSection
        values={report.values}
        onAdd={async (input) => {
          await addReportValue(report.id, input);
          await reload();
        }}
        onDelete={async (id) => {
          await deleteReportValue(id);
          await reload();
        }}
      />

      <SectionTitle>{t("reports.documents")}</SectionTitle>
      {report.documents.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("reports.no_documents")}</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {report.documents.map((d) => (
            <Card key={d.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
                <div>
                  <strong>{t(`scan.kind_${d.kind}` as never)}</strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {formatPatientDate(d.createdAt, timezone)}
                  </div>
                </div>
                {d.downloadable ? (
                  <Button variant="secondary" onClick={() => void openDocument(d.id)}>
                    {t("reports.view_document")}
                  </Button>
                ) : (
                  <Chip tone="warning">{t("reports.document_unavailable")}</Chip>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ marginTop: "var(--space-sm)" }}>
        {uploading ? (
          <Card>
            <PillSpinner label={t("scan.uploading")} />
          </Card>
        ) : (
          <DocumentUploadButtons
            photoLabel={t("reports.take_photo")}
            fileLabel={t("reports.choose_file")}
            disabled={busy}
            onPick={(files) => void addPages(files)}
          />
        )}
      </div>

      <div style={{ marginTop: "var(--space-xl)" }}>
        <Button variant="danger" fullWidth disabled={busy || uploading} onClick={() => void remove()}>
          {t("reports.delete")}
        </Button>
      </div>
    </AppShell>
  );
}
