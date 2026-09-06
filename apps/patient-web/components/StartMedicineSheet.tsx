"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, TextInput } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { patientLocalToIso, patientTodayKey, useActiveTimezone } from "../lib/patient-time";
import { startMedicationFromItem, type PrescriptionItemDto } from "../lib/prescriptions";
import { InstructionPickers, type InstructionDraft, type InstructionErrors, type InstructionField } from "./InstructionPickers";

/**
 * "Start this medicine" (docs_v2/05 §4, docs_v2/06 P2-5): turns one
 * prescription line into a medicine on the patient's list. Pre-filled from
 * the line; whatever the paper left out is chosen from the same typing-free
 * pickers as Add. The SERVER decides whether the line has a readable dose —
 * a 400 comes back with `errors[{path}]` and each message lands under its
 * field (H-02: never start on an invented dose); a 409 means the line is
 * already a live medicine, and the sheet says so and points at it.
 */
export function StartMedicineSheet({
  prescriptionId,
  item,
  onStarted,
  onClose,
}: {
  prescriptionId: string;
  item: PrescriptionItemDto;
  onStarted: (medicationId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const titleId = useId();
  const [draft, setDraft] = useState<InstructionDraft>({
    doseUnit: item.doseUnit ?? undefined,
    doseQuantity: item.doseQuantity ?? undefined,
    frequencyCode: item.frequencyCode ?? undefined,
    pattern: item.pattern ?? undefined,
    foodInstruction: item.foodInstruction ?? undefined,
  });
  const [startDate, setStartDate] = useState(() => patientTodayKey(timezone));
  const [quantityOnHand, setQuantityOnHand] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<InstructionErrors>({});

  async function start() {
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
    setConflict(false);
    try {
      const created = await startMedicationFromItem(prescriptionId, item.id, {
        ...(draft.doseQuantity ? { doseQuantity: Number(draft.doseQuantity) } : {}),
        ...(draft.doseUnit ? { doseUnit: draft.doseUnit } : {}),
        ...(draft.frequencyCode ? { frequencyCode: draft.frequencyCode } : {}),
        ...(draft.frequencyCode === "PATTERN" && draft.pattern ? { pattern: draft.pattern } : {}),
        ...(draft.foodInstruction ? { foodInstruction: draft.foodInstruction } : {}),
        // Noon in the patient's zone: a calendar date, safe from the UTC
        // day-shift a midnight instant would suffer (docs/16).
        ...(startDate ? { startDate: patientLocalToIso(`${startDate}T12:00`, timezone) } : {}),
        ...(quantityOnHand.trim() ? { quantityOnHand: Number(quantityOnHand) } : {}),
        ...(reason.trim() ? { patientReason: reason.trim() } : {}),
      });
      onStarted(created.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
      } else if (err instanceof ApiError && err.status === 400 && err.problem.errors?.length) {
        const next: InstructionErrors = {};
        for (const e of err.problem.errors) {
          const path = String(e.path ?? "") as InstructionField;
          if (path in draft || ["doseQuantity", "doseUnit", "frequencyCode", "pattern", "foodInstruction"].includes(path)) next[path] = e.message;
        }
        setFieldErrors(next);
        setError(err.problem.title);
      } else {
        setError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card role="dialog" aria-labelledby={titleId} tone="info" data-testid="start-medicine-sheet">
      <strong id={titleId} style={{ fontSize: "var(--font-large)" }}>
        {t("rx.start_title", { name: item.enteredName })}
      </strong>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("rx.start_intro")}</span>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {conflict ? (
        <Banner tone="warning">
          {t("rx.start_conflict")}{" "}
          {item.startedMedicationId ? (
            <Link href={`/medicines/${item.startedMedicationId}`} style={{ color: "var(--color-info)", textDecoration: "underline" }}>
              {t("rx.open_medicine")}
            </Link>
          ) : null}
        </Banner>
      ) : null}

      <InstructionPickers value={draft} onChange={setDraft} errors={fieldErrors} />

      <TextInput label={t("rx.start_date_label")} help={t("encounter.time_help")} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <TextInput
        label={t("add.quantity_label")}
        type="number"
        inputMode="numeric"
        min="0"
        value={quantityOnHand}
        onChange={(e) => setQuantityOnHand(e.target.value)}
      />
      <TextInput label={t("add.reason_label")} value={reason} onChange={(e) => setReason(e.target.value)} />

      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        <Button fullWidth loading={busy} disabled={busy || conflict} onClick={() => void start()} style={{ flex: "1 1 60%" }}>
          {t("rx.start_confirm")}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onClose} style={{ flex: "1 1 30%" }}>
          {t("common.cancel")}
        </Button>
      </div>
    </Card>
  );
}
