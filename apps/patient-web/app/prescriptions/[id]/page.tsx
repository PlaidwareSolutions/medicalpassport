"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { useI18n } from "../../../lib/i18n";
import { formatCalendarDate, formatPatientDate, useActiveTimezone } from "../../../lib/patient-time";
import { useMedications } from "../../../lib/medications";
import { deletePrescription, documentDownloadUrl, linkMedicationToPrescription, usePrescription } from "../../../lib/prescriptions";

/** Screen 43 (docs/07): one prescription — its documents and the medicines it substantiates. */
export default function PrescriptionDetailPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { prescription, error, reload } = usePrescription(params.id);
  const { items: medications } = useMedications();
  const [actionError, setActionError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

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

  const linkedIds = new Set(prescription.medications.map((m) => m.id));
  const linkable = (medications ?? []).filter((m) => !linkedIds.has(m.id));

  return (
    <AppShell>
      <PageHeader title={prescription.practitionerName ?? t("prescriptions.unnamed_doctor")} />
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      <Card>
        <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {prescription.prescribedAt ? formatCalendarDate(prescription.prescribedAt) : t("prescriptions.no_date")}
        </div>
        {prescription.notes ? <div style={{ marginTop: "var(--space-xs)" }}>{prescription.notes}</div> : null}
      </Card>

      <SectionTitle>{t("prescriptions.documents")}</SectionTitle>
      {prescription.documents.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("prescriptions.no_documents")}</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {prescription.documents.map((d) => (
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

      <SectionTitle>{t("prescriptions.medicines")}</SectionTitle>
      {prescription.medications.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("prescriptions.no_medicines")}</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {prescription.medications.map((m) => (
            <Link key={m.id} href={`/medicines/${m.id}`}>
              <Card>
                <strong>{m.enteredName}</strong>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t(`meds.status.${m.status}` as never)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
        <Link href={`/add?prescriptionId=${prescription.id}`}>
          <Button fullWidth>{t("prescriptions.add_medicine")}</Button>
        </Link>
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

      <div style={{ marginTop: "var(--space-xl)" }}>
        <Button variant="danger" fullWidth disabled={busy} onClick={() => void remove()}>
          {t("prescriptions.delete")}
        </Button>
      </div>
    </AppShell>
  );
}
