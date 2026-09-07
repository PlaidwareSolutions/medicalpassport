"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { pluralKey } from "@medpass/localization";
import { formatDoseAmount } from "@medpass/medication-terminology";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { DocumentUploadButtons } from "../../../components/DocumentUploadButtons";
import { LinkedDocumentsSection } from "../../../components/LinkedDocumentsSection";
import { PageHeader } from "../../../components/PageHeader";
import { emptyLine, lineToInput, PrescriptionLineRow, type LineDraft } from "../../../components/PrescriptionLineEditor";
import { StartMedicineSheet } from "../../../components/StartMedicineSheet";
import { TrustBadge } from "../../../components/TrustBadge";
import { formatDateOnly } from "../../../lib/diagnostics";
import { MAX_IMAGE_BYTES, uploadDocument } from "../../../lib/document-upload";
import { useI18n } from "../../../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../../../lib/patient-time";
import { useMedications } from "../../../lib/medications";
import {
  addPrescriptionItem,
  deletePrescription,
  deletePrescriptionItem,
  documentDownloadUrl,
  linkMedicationToPrescription,
  usePrescription,
  type PrescriptionItemDto,
} from "../../../lib/prescriptions";

type Translate = (key: never, params?: Record<string, string | number>) => string;

/** The line's own dose/frequency/food as one sentence; the parts the paper didn't say are simply absent. */
function itemInstructionText(t: Translate, item: PrescriptionItemDto): string {
  const parts: string[] = [];
  if (item.doseQuantity && item.doseUnit) parts.push(`${formatDoseAmount(Number(item.doseQuantity))} ${t(`unit.${item.doseUnit}` as never)}`);
  else if (item.doseUnit) parts.push(t(`medicineType.${item.doseUnit}` as never));
  if (item.frequencyCode === "PATTERN" && item.pattern) parts.push(item.pattern);
  else if (item.frequencyCode) parts.push(t(`frequency.${item.frequencyCode.toLowerCase()}` as never));
  if (item.foodInstruction) parts.push(t(`food.${item.foodInstruction}` as never));
  if (item.durationDays) parts.push(t(pluralKey(item.durationDays, "rx.for_days_one", "rx.for_days") as never, { count: item.durationDays }));
  return parts.join(" · ");
}

/**
 * Screen 43 (docs/07) + Phase 2 (docs_v2/06 P2-5): one prescription — the
 * diagnosis, validity and follow-up as written, each line in page order
 * with "Start this medicine" for the ones not yet on the patient's list,
 * the filed pages, and the medicines it substantiates.
 */
export default function PrescriptionDetailPage() {
  const { t, tn } = useI18n();
  const timezone = useActiveTimezone();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { prescription, error, reload } = usePrescription(params.id);
  const { items: medications } = useMedications();
  const [actionError, setActionError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [startingItemId, setStartingItemId] = useState<string | undefined>();
  const [newLine, setNewLine] = useState<LineDraft | undefined>();
  const [startedNotice, setStartedNotice] = useState<string | undefined>();

  async function addPages(files: File[]) {
    setActionError(undefined);
    const valid = files.filter((f) => f.size <= MAX_IMAGE_BYTES || f.type === "application/pdf");
    if (valid.length < files.length) setActionError(t("scan.upload_error"));
    if (valid.length === 0) return;
    setUploading(true);
    try {
      for (const file of valid) await uploadDocument(file, { kind: "prescription", prescriptionId: params.id });
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

  async function link(medicationId: string) {
    setBusy(true);
    setActionError(undefined);
    try {
      await linkMedicationToPrescription(params.id, medicationId);
      setShowPicker(false);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function saveNewLine() {
    if (!newLine || !newLine.enteredName.trim()) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const sequence = (prescription?.items.length ?? 0) + 1;
      await addPrescriptionItem(params.id, lineToInput(newLine, sequence));
      setNewLine(undefined);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(itemId: string) {
    if (!window.confirm(t("rx.line_delete_confirm"))) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await deletePrescriptionItem(params.id, itemId);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("prescriptions.delete_confirm"))) return;
    setBusy(true);
    try {
      await deletePrescription(params.id);
      router.replace("/prescriptions");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
      setBusy(false);
    }
  }

  if (error && !prescription) {
    return (
      <AppShell>
        <Banner tone="danger">{t("common.error_generic")}</Banner>
      </AppShell>
    );
  }
  if (!prescription) {
    return (
      <AppShell>
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  const items = prescription.items ?? [];
  const startedIds = new Set(items.map((i) => i.startedMedicationId).filter((v): v is string => !!v));
  // Medicines linked the V1 way, without a line of their own (pre-backfill records).
  const looseMedicines = prescription.medications.filter((m) => !startedIds.has(m.id));
  const linkedIds = new Set(prescription.medications.map((m) => m.id));
  const linkable = (medications ?? []).filter((m) => !linkedIds.has(m.id));

  const spoken = [
    prescription.practitionerName ?? t("prescriptions.unnamed_doctor"),
    prescription.diagnosisText ?? "",
    tn(items.length, "rx.lines_count_one", "rx.lines_count"),
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <AppShell>
      <PageHeader
        title={prescription.practitionerName ?? t("prescriptions.unnamed_doctor")}
        readAloud={[{ audio: "screen.prescription_detail" }, { text: spoken }]}
      />
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {startedNotice ? (
        <Banner tone="info">
          {t("rx.started_notice")}{" "}
          <Link href={`/medicines/${startedNotice}`} style={{ color: "var(--color-info)", textDecoration: "underline" }}>
            {t("rx.open_medicine")}
          </Link>
        </Banner>
      ) : null}

      <Card>
        <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {prescription.prescribedAt ? formatDateOnly(prescription.prescribedAt) : t("prescriptions.no_date")}
        </div>
        <Fact label={t("rx.diagnosis")} value={prescription.diagnosisText} empty={t("rx.not_written")} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
          <Fact label={t("rx.valid_until")} value={prescription.validUntil ? formatDateOnly(prescription.validUntil) : null} empty={t("rx.not_written")} />
          <Fact label={t("rx.follow_up")} value={prescription.followUpOn ? formatDateOnly(prescription.followUpOn) : null} empty={t("rx.not_written")} />
        </div>
        {prescription.notes ? <div>{prescription.notes}</div> : null}
      </Card>

      <SectionTitle>{t("rx.lines_title")}</SectionTitle>
      {items.length === 0 && !newLine ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("rx.lines_empty")}</span>
        </Card>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {items.map((item, index) => {
          const instruction = itemInstructionText(t as Translate, item);
          const started = !!item.startedMedicationId;
          return (
            <Card key={item.id} data-testid="prescription-item" data-started={started ? "true" : "false"}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("rx.line_n", { n: index + 1 })}</span>
                  <div style={{ fontSize: "var(--font-large)", fontWeight: 600 }}>{item.enteredName}</div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {[item.strengthLabel, item.formText, item.routeText].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                  {started ? <Chip tone="success">{t("rx.on_your_list")}</Chip> : null}
                  <TrustBadge verification={item.verification} provenanceSource={item.provenanceSource} />
                </div>
              </div>
              <div>{instruction || <span style={{ color: "var(--color-text-muted)" }}>{t("rx.dose_not_written")}</span>}</div>
              {item.instructionsText ? <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{item.instructionsText}</div> : null}

              {started ? (
                <Link href={`/medicines/${item.startedMedicationId}`}>
                  <Button variant="secondary" fullWidth>
                    {t("rx.open_medicine")}
                  </Button>
                </Link>
              ) : startingItemId === item.id ? (
                <StartMedicineSheet
                  prescriptionId={prescription.id}
                  item={item}
                  onClose={() => setStartingItemId(undefined)}
                  onStarted={async (medicationId) => {
                    setStartingItemId(undefined);
                    setStartedNotice(medicationId);
                    await reload();
                  }}
                />
              ) : (
                <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
                  <Button fullWidth disabled={busy} onClick={() => setStartingItemId(item.id)} style={{ flex: "1 1 60%" }}>
                    {t("rx.start")}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void removeLine(item.id)} style={{ flex: "1 1 30%" }}>
                    {t("rx.line_remove")}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}

        {newLine ? (
          <>
            <PrescriptionLineRow line={newLine} index={items.length} onChange={setNewLine} onRemove={() => setNewLine(undefined)} />
            <Button fullWidth loading={busy} disabled={busy || !newLine.enteredName.trim()} onClick={() => void saveNewLine()}>
              {t("rx.line_save")}
            </Button>
          </>
        ) : (
          <Button variant="secondary" fullWidth disabled={busy} onClick={() => setNewLine(emptyLine())}>
            {t("rx.line_add")}
          </Button>
        )}
      </div>

      {looseMedicines.length > 0 ? (
        <>
          <SectionTitle>{t("prescriptions.medicines")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {looseMedicines.map((m) => (
              <Link key={m.id} href={`/medicines/${m.id}`}>
                <Card>
                  <strong>{m.enteredName}</strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t(`meds.status.${m.status}` as never)}</div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
        {linkable.length > 0 ? (
          <Button variant="secondary" fullWidth disabled={busy} onClick={() => setShowPicker((v) => !v)}>
            {t("prescriptions.link_existing")}
          </Button>
        ) : null}
      </div>
      {showPicker ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
          {linkable.map((m) => (
            <Card key={m.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
                <strong>{m.enteredName}</strong>
                <Button variant="secondary" disabled={busy} onClick={() => void link(m.id)}>
                  {t("prescriptions.link")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <SectionTitle>{t("prescriptions.documents")}</SectionTitle>
      {prescription.documents.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("prescriptions.no_documents")}</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {prescription.documents.map((d) => (
            <Card key={d.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <div>
                  <strong>{t(`scan.kind_${d.kind}` as never)}</strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{formatPatientDate(d.createdAt, timezone)}</div>
                </div>
                {d.downloadable ? (
                  <Button variant="secondary" onClick={() => void openDocument(d.id)}>
                    {t("prescriptions.view_document")}
                  </Button>
                ) : (
                  <Chip tone="warning">{t("prescriptions.document_unavailable")}</Chip>
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
            photoLabel={t("prescriptions.take_photo")}
            fileLabel={t("prescriptions.choose_file")}
            disabled={busy}
            onPick={(files) => void addPages(files)}
          />
        )}
      </div>

      {/* Documents V2 pages this prescription was read from (docs_v2/09) — renders nothing for hand-typed records. */}
      <LinkedDocumentsSection prescriptionId={prescription.id} />

      <div style={{ marginTop: "var(--space-xl)" }}>
        <Button variant="danger" fullWidth disabled={busy} onClick={() => void remove()}>
          {t("prescriptions.delete")}
        </Button>
      </div>
    </AppShell>
  );
}

function Fact({ label, value, empty }: { label: string; value: string | null | undefined; empty: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
      <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)", fontWeight: 600 }}>{label}</span>
      {value ? <span>{value}</span> : <span style={{ color: "var(--color-text-muted)" }}>{empty}</span>}
    </div>
  );
}
