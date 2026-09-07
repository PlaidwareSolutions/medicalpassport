"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { LegacyReportDetail } from "../../../components/LegacyReportDetail";
import { LinkedDocumentsSection } from "../../../components/LinkedDocumentsSection";
import { PageHeader } from "../../../components/PageHeader";
import { emptyResult, ResultRowEditor, resultIsComplete, resultToInput, type ResultDraft } from "../../../components/ResultRowEditor";
import { TrustBadge } from "../../../components/TrustBadge";
import {
  addDiagnosticResult,
  analyteUnitDisplay,
  deleteDiagnosticReport,
  deleteDiagnosticResult,
  formatAnalyteValue,
  formatDateOnly,
  isImagingKind,
  referenceRangeText,
  showsCanonicalTwin,
  useAnalyteTerminology,
  useDiagnosticReport,
  type AnalyteTerminologyDto,
  type DiagnosticResultDto,
} from "../../../lib/diagnostics";
import { useI18n } from "../../../lib/i18n";

/**
 * One diagnostic report (docs_v2/06 P4-4): the header facts, the imaging
 * text when there is any, and every result exactly as entered — the
 * canonical unit alongside only when the entered unit differs (H-35), the
 * lab's own flag as plain text only when the lab supplied one. Nothing is
 * coloured or badged by value (docs_v2/10 §1). A V1 report id falls back
 * to the V1 detail unchanged.
 */
export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const { report, notFound, error } = useDiagnosticReport(params.id);
  const { t } = useI18n();

  if (notFound) return <LegacyReportDetail id={params.id} />;
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
  return <DiagnosticReportDetail id={params.id} />;
}

function DiagnosticReportDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { report, reload } = useDiagnosticReport(id);
  const { analytes } = useAnalyteTerminology();
  const [draft, setDraft] = useState<ResultDraft | undefined>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  if (!report) return null;

  async function saveResult() {
    if (!draft || !resultIsComplete(draft) || !report) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await addDiagnosticResult(report.id, resultToInput(draft, report.results.length + 1));
      setDraft(undefined);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function removeResult(resultId: string) {
    if (!report || !window.confirm(t("reports.value_delete_confirm"))) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await deleteDiagnosticResult(report.id, resultId);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!report || !window.confirm(t("reports.delete_confirm"))) return;
    setBusy(true);
    try {
      await deleteDiagnosticReport(report.id);
      router.replace("/reports");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
      setBusy(false);
    }
  }

  const live = report.results.filter((r) => r.supersededById === null);
  const spoken = [report.title, report.testedAt ? formatDateOnly(report.testedAt, locale) : "", report.facilityNameText ?? ""].filter(Boolean).join(". ");

  return (
    <AppShell>
      <PageHeader title={report.title} readAloud={[{ audio: "screen.report_detail" }, { text: spoken }]} />
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      <Card>
        <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600 }}>{t(`dx.kind.${report.kind}` as never)}</span>
          <TrustBadge verification={report.verification} provenanceSource={report.provenanceSource} />
        </div>
        <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {report.testedAt ? formatDateOnly(report.testedAt, locale) : t("reports.no_date")}
          {report.reportedAt ? ` · ${t("dx.reported_on", { date: formatDateOnly(report.reportedAt, locale) })}` : ""}
        </div>
        {report.facilityNameText ? <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{report.facilityNameText}</div> : null}
        {report.orderingPractitionerName ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("reports.ordered_by", { name: report.orderingPractitionerName })}</div>
        ) : null}
        {report.reportingPractitionerName ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("dx.reported_by", { name: report.reportingPractitionerName })}</div>
        ) : null}
      </Card>

      {report.modality || report.bodySite || report.impressionText || report.findingsText ? (
        <Card data-testid="dx-imaging">
          {report.modality ? <Fact label={t("dx.modality_label")} value={t(`dx.modality.${report.modality}` as never)} /> : null}
          {report.bodySite ? <Fact label={t("dx.body_site_label")} value={report.bodySite} /> : null}
          {report.impressionText ? <Fact label={t("dx.impression_label")} value={report.impressionText} /> : null}
          {report.findingsText ? <Fact label={t("dx.findings_label")} value={report.findingsText} /> : null}
        </Card>
      ) : null}
      {report.conclusionText ? (
        <Card>
          <Fact label={t("dx.conclusion_label")} value={report.conclusionText} />
        </Card>
      ) : null}

      <SectionTitle>{t("dx.results_title")}</SectionTitle>
      {live.length === 0 && !draft ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("dx.results_empty")}</span>
        </Card>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {live.map((r) => (
          <ResultCard key={r.id} result={r} analytes={analytes} busy={busy} onDelete={() => void removeResult(r.id)} />
        ))}
        {draft ? (
          <Card>
            <ResultRowEditor draft={draft} index={live.length} analytes={analytes} onChange={setDraft} onRemove={() => setDraft(undefined)} />
            <Button fullWidth loading={busy} disabled={busy || !resultIsComplete(draft)} onClick={() => void saveResult()}>
              {t("reports.value_save")}
            </Button>
          </Card>
        ) : (
          <Button variant="secondary" fullWidth disabled={busy} onClick={() => setDraft(emptyResult())}>
            {t("dx.result_add")}
          </Button>
        )}
      </div>

      {/* Documents V2 pages this report was read from (docs_v2/09) — renders nothing for hand-typed records. */}
      <LinkedDocumentsSection diagnosticReportId={report.id} reportKind={isImagingKind(report.kind) ? "imaging_report" : "laboratory_report"} />

      <div style={{ marginTop: "var(--space-xl)" }}>
        <Button variant="danger" fullWidth disabled={busy} onClick={() => void remove()}>
          {t("reports.delete")}
        </Button>
      </div>
    </AppShell>
  );
}

/**
 * One result, as entered. The entered text + entered unit is the value;
 * "= X canonical" appears only when the unit differs; the reference range
 * is text the lab printed; the flag line exists only when the lab set one.
 */
function ResultCard({
  result,
  analytes,
  busy,
  onDelete,
}: {
  result: DiagnosticResultDto;
  analytes: AnalyteTerminologyDto[] | undefined;
  busy: boolean;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const range = referenceRangeText(result);
  const enteredUnit = analyteUnitDisplay(analytes, result.analyteKey, result.enteredUnit ?? result.unit);
  return (
    <Card data-testid="dx-result" data-analyte={result.analyteKey}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <strong>{result.label}</strong>
          <div style={{ fontSize: "var(--font-large)" }} data-testid="dx-result-value">
            {result.comparator ? `${result.comparator} ` : ""}
            {result.enteredValueText}
            {enteredUnit ? ` ${enteredUnit}` : ""}
          </div>
          {showsCanonicalTwin(result) ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t("dx.canonical_twin", { value: formatAnalyteValue(result.valueNumeric, result.analyteKey), unit: analyteUnitDisplay(analytes, result.analyteKey, result.unit) })}
            </div>
          ) : null}
          {range ? <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("reports.reference_prefix", { range })}</div> : null}
          {result.interpretation ? (
            <div style={{ fontSize: "var(--font-small)" }} data-testid="dx-lab-flag">
              {t("dx.lab_flag", { flag: t(`dx.interpretation.${result.interpretation}` as never) })}
            </div>
          ) : null}
          <div style={{ marginTop: "var(--space-xs)" }}>
            <TrustBadge verification={result.verification} provenanceSource={result.provenanceSource} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          {result.analyteKey !== "other" ? (
            <Link href={`/reports/trends/${result.analyteKey}`}>
              <Button variant="secondary">{t("dx.see_trend")}</Button>
            </Link>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={onDelete} aria-label={t("reports.value_delete")}>
            {t("reports.value_delete")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)", fontWeight: 600 }}>{label}</span>
      <span style={{ whiteSpace: "pre-wrap" }}>{value}</span>
    </div>
  );
}
