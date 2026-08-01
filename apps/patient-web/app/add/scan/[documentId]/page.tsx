"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { MessageKey } from "@medpass/localization";
import { ApiError, type DocumentExtractionDto, type ExtractionCandidateDto } from "@medpass/api-client";
import { DOSE_UNITS, type DoseUnit } from "@medpass/domain";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { PageHeader } from "../../../../components/PageHeader";
import { api, getActiveProfileId, newIdempotencyKey } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";

type FieldName = ExtractionCandidateDto["field"];
type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

function frequencyLabel(value: string, t: Translate): string {
  if (value.startsWith("PATTERN:")) return value.slice("PATTERN:".length);
  return t(`frequency.${value.toLowerCase()}` as MessageKey);
}

function foodLabel(value: string, t: Translate): string {
  return t(`food.${value}` as MessageKey);
}

const POLL_INTERVAL_MS = 1500;

function displayLabel(candidate: ExtractionCandidateDto, t: Translate): string {
  if (!candidate.proposedValue) return "";
  if (candidate.field === "brand_name") return candidate.proposedLabel ?? candidate.proposedValue;
  if (candidate.field === "frequency") return frequencyLabel(candidate.proposedValue, t);
  return foodLabel(candidate.proposedValue, t);
}

/**
 * Screen (Stage 3/8): every OCR candidate is shown next to the exact line it
 * came from and requires an explicit yes/no — nothing here is treated as
 * fact until the patient confirms it (docs/09 §6). Dose amount is never
 * read from the photo; it's always a typed pick, same as manual entry.
 */
export default function ReviewExtractionPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ documentId: string }>();
  const documentId = params.documentId;

  const [data, setData] = useState<DocumentExtractionDto | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [busyCandidateId, setBusyCandidateId] = useState<string | undefined>();
  const [doseQuantity, setDoseQuantity] = useState<string | undefined>("1");
  const [doseUnit, setDoseUnit] = useState<DoseUnit>("tablet");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  async function load() {
    try {
      const res = await api.get<DocumentExtractionDto>(`/documents/${documentId}/extraction`, {
        profileId: getActiveProfileId(),
      });
      setData(res);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    if (data?.status !== "processing") return;
    const timer = setTimeout(() => void load(), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function confirm(candidate: ExtractionCandidateDto) {
    if (!candidate.proposedValue) return;
    setBusyCandidateId(candidate.id);
    try {
      await api.post(
        `/extraction-candidates/${candidate.id}/confirm`,
        { confirmedValue: candidate.proposedValue },
        { profileId: getActiveProfileId() },
      );
      await load();
    } finally {
      setBusyCandidateId(undefined);
    }
  }

  async function reject(candidate: ExtractionCandidateDto) {
    setBusyCandidateId(candidate.id);
    try {
      await api.post(`/extraction-candidates/${candidate.id}/reject`, undefined, {
        profileId: getActiveProfileId(),
      });
      await load();
    } finally {
      setBusyCandidateId(undefined);
    }
  }

  async function submit() {
    if (!doseQuantity) return;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await api.post(
        `/extractions/${data!.extraction!.id}/create-medication`,
        { doseQuantity: Number(doseQuantity), doseUnit },
        { idempotencyKey: newIdempotencyKey(), profileId: getActiveProfileId() },
      );
      router.replace("/medicines");
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <AppShell>
        <Banner tone="danger">{loadError}</Banner>
        <Link href="/add">{t("scan.add_manually")}</Link>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell>
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  if (data.status === "processing") {
    return (
      <AppShell>
        <Card>
          <strong>{t("scan.processing")}</strong>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {t("scan.processing_hint")}
          </span>
        </Card>
      </AppShell>
    );
  }

  if (data.status === "failed" || !data.extraction || data.extraction.status === "failed") {
    return (
      <AppShell>
        <Banner tone="danger">{t("scan.process_error")}</Banner>
        <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <Link href="/add/scan">
            <Button fullWidth>{t("scan.try_again")}</Button>
          </Link>
          <Link href="/add">
            <Button variant="ghost" fullWidth>
              {t("scan.add_manually")}
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const byField = new Map(data.extraction.candidates.map((c) => [c.field, c]));
  const brand = byField.get("brand_name");
  const frequency = byField.get("frequency");

  const brandReady = brand?.status === "confirmed";
  const frequencyReady = frequency?.status === "confirmed";
  const canSubmit = brandReady && frequencyReady && Number(doseQuantity) > 0 && !submitting;

  const fieldMeta: Array<{ field: FieldName; label: string; noMatchKey: MessageKey }> = [
    { field: "brand_name", label: t("review.field_brand_name"), noMatchKey: "review.no_brand_match" },
    { field: "frequency", label: t("review.field_frequency"), noMatchKey: "review.no_candidate" },
    { field: "food_instruction", label: t("review.field_food_instruction"), noMatchKey: "review.no_candidate" },
  ];

  return (
    <AppShell>
      <PageHeader title={t("review.title")} style={{ margin: "0 0 var(--space-xs)" }} />
      <p style={{ color: "var(--color-text-muted)", marginBottom: "var(--space-md)" }}>{t("review.subtitle")}</p>

      {submitError ? <Banner tone="danger">{submitError}</Banner> : null}

      {fieldMeta.map(({ field, label, noMatchKey }) => {
        const candidate = byField.get(field);
        return (
          <Card key={field}>
            <strong>{label}</strong>
            {candidate ? (
              <>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t("review.detected", { text: candidate.detectedText })}
                </span>
                <div style={{ margin: "var(--space-xs) 0", fontSize: "var(--font-body)" }}>
                  {displayLabel(candidate, t)}
                </div>
                {candidate.status === "confirmed" ? (
                  <Chip tone="success">{t("review.confirmed")}</Chip>
                ) : candidate.status === "rejected" ? (
                  <Chip tone="warning">{t("review.rejected")}</Chip>
                ) : (
                  <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                    <Button
                      variant="secondary"
                      disabled={busyCandidateId === candidate.id}
                      onClick={() => void confirm(candidate)}
                    >
                      {t("review.confirm")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busyCandidateId === candidate.id}
                      onClick={() => void reject(candidate)}
                    >
                      {t("review.reject")}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t(noMatchKey)}</span>
            )}
          </Card>
        );
      })}

      {!brandReady ? <Banner tone="warning">{t("review.need_brand")}</Banner> : null}
      {brandReady && !frequencyReady ? <Banner tone="warning">{t("review.need_frequency")}</Banner> : null}

      {brandReady && frequencyReady ? (
        <>
          <div style={{ height: "var(--space-md)" }} />
          {/* The unit used to be hardcoded to "tablet" here, so a scanned
              syrup was filed as a tablet — the same bug 10afc28 fixed for the
              add/edit screens but missed on this path. It matters more now
              that the medicines list draws the unit as a picture. */}
          <ChoiceGrid
            label={t("add.dose_unit_label")}
            columns={2}
            choices={DOSE_UNITS.map((u) => ({ value: u, label: t(`medicineType.${u}` as MessageKey) }))}
            value={doseUnit}
            onChange={setDoseUnit}
          />
          <div style={{ height: "var(--space-md)" }} />
          {/* Same countable/measured split as the add screen: the ½/1/2 tiles
              only make sense for things you can halve. */}
          {doseUnit === "tablet" || doseUnit === "capsule" ? (
            <ChoiceGrid
              label={t("review.dose_prompt")}
              columns={3}
              choices={[
                { value: "0.5", label: "½" },
                { value: "1", label: "1" },
                { value: "2", label: "2" },
              ]}
              value={doseQuantity}
              onChange={setDoseQuantity}
            />
          ) : (
            <TextInput
              label={t("review.dose_prompt")}
              help={t(`unit.${doseUnit}` as MessageKey)}
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0.1"
              value={doseQuantity ?? ""}
              onChange={(e) => setDoseQuantity(e.target.value)}
            />
          )}
          <div style={{ marginTop: "var(--space-lg)" }}>
            <Button fullWidth disabled={!canSubmit} onClick={() => void submit()}>
              {t("review.submit")}
            </Button>
          </div>
        </>
      ) : (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <Link href="/add">
            <Button variant="ghost" fullWidth>
              {t("review.add_manually")}
            </Button>
          </Link>
        </div>
      )}
    </AppShell>
  );
}
