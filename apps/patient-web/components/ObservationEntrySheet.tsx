"use client";
import { useId, useState } from "react";
import { ApiError } from "@medpass/api-client";
import type { ObservationContext } from "@medpass/domain";
import { Banner, Button, Card, ChoiceGrid, TextInput } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import type { VoiceObservationCandidate } from "../lib/voice/parse-observation";
import { VoiceEntryButton } from "./VoiceEntryButton";
import { BP_CONTEXTS, createObservation, GLUCOSE_CONTEXTS, useObservationConcepts, type HubConcept } from "../lib/observations";
import { patientLocalToIso, patientNowLocal, useActiveTimezone } from "../lib/patient-time";

const NO_CONTEXT = "__none__";
const PAIN = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;

/**
 * The add-a-reading sheet (docs_v2/06 P5-3), one shape per concept: BP asks
 * systolic / diastolic / pulse, glucose a value and when it was taken,
 * temperature a value with °C or °F, pain a 0–10 tap. The time is entered
 * on the PATIENT's clock (docs/16). The value is sent exactly as typed
 * with its unit; the server converts to the canonical unit and checks
 * plausibility only (`observation_out_of_range`) — nothing here judges it.
 */
export function ObservationEntrySheet({
  concept,
  onSaved,
  onClose,
}: {
  concept: HubConcept;
  /** `queuedOffline` is true when the reading was saved on the phone for later sync (docs_v2/05 §14) rather than sent. */
  onSaved: (result: { queuedOffline: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const titleId = useId();
  const { concepts } = useObservationConcepts();
  const meta = concepts?.find((c) => c.key === concept);
  const units = meta?.allowedEnteredUnits ?? [];
  const canonical = meta?.canonicalUnitDisplay ?? meta?.canonicalUnit ?? "";

  const [measuredAt, setMeasuredAt] = useState(() => patientNowLocal(timezone));
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [pulse, setPulse] = useState("");
  const [unit, setUnit] = useState<string | undefined>();
  const [context, setContext] = useState<ObservationContext | undefined>();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Set when the fields were filled from speech (P16): the sheet says so
  // until the patient edits or saves, because a mis-heard number must be
  // seen as "heard", not typed.
  const [fromVoice, setFromVoice] = useState(false);

  const isBp = concept === "blood_pressure";
  const isPain = concept === "pain_score";
  const contexts = concept === "blood_glucose" ? GLUCOSE_CONTEXTS : isBp || concept === "heart_rate" ? BP_CONTEXTS : [];
  const chosenUnit = unit ?? units.find((u) => u.isCanonical)?.unit ?? meta?.canonicalUnit ?? undefined;
  const ready = isBp ? value.trim() !== "" && value2.trim() !== "" : value.trim() !== "";

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      // Offline, or a request that never got an answer, queues the reading
      // for sync instead of failing (docs_v2/05 §14) — the sheet closes the
      // same way; the page says it was saved on the phone.
      const { queuedOffline } = await createObservation({
        concept,
        measuredAt: patientLocalToIso(measuredAt, timezone),
        valueNumeric: Number(value),
        ...(isBp ? { valueNumeric2: Number(value2) } : {}),
        ...(isBp && pulse.trim() ? { pulseBpm: Number(pulse) } : {}),
        ...(chosenUnit && !isPain ? { enteredUnit: chosenUnit } : {}),
        enteredValueText: isBp ? `${value.trim()}/${value2.trim()}` : value.trim(),
        ...(context ? { context } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      await onSaved({ queuedOffline });
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === "observation_out_of_range") {
        setError(err.problem.errors?.[0]?.message ?? t("measure.error_out_of_range"));
      } else {
        setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
      }
      setBusy(false);
    }
  }

  const unitLabel = (u: string | undefined) => units.find((x) => x.unit === u)?.display ?? u ?? canonical;

  return (
    <Card role="dialog" aria-labelledby={titleId} data-testid="observation-sheet">
      <strong id={titleId} style={{ fontSize: "var(--font-large)" }}>
        {t("measure.add_title", { name: t(`measure.concept.${concept}` as never) })}
      </strong>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <VoiceEntryButton
        concept={concept}
        onCandidate={(candidate: VoiceObservationCandidate) => {
          // Pre-fill only; the unit is applied only when this concept allows it.
          if (candidate.value !== undefined) setValue(candidate.value);
          if (isBp && candidate.value2 !== undefined) setValue2(candidate.value2);
          if (isBp && candidate.pulse !== undefined) setPulse(candidate.pulse);
          if (candidate.unit && units.some((u) => u.unit === candidate.unit)) setUnit(candidate.unit);
          setFromVoice(true);
        }}
      />
      {fromVoice ? (
        <Banner tone="info">
          <span data-testid="voice-entry-filled">{t("voice.filled")}</span>
        </Banner>
      ) : null}

      <TextInput label={t("bp.measured_at_label")} help={t("encounter.time_help")} type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />

      {isBp ? (
        <>
          <TextInput label={t("bp.systolic_label")} type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          <TextInput label={t("bp.diastolic_label")} type="number" inputMode="numeric" value={value2} onChange={(e) => setValue2(e.target.value)} />
          <TextInput label={t("bp.pulse_label")} type="number" inputMode="numeric" value={pulse} onChange={(e) => setPulse(e.target.value)} />
        </>
      ) : isPain ? (
        <ChoiceGrid
          label={t("measure.pain_label")}
          columns={4}
          choices={PAIN.map((p) => ({
            value: p,
            label: p,
            description: p === "0" ? t("measure.pain_none") : p === "5" ? t("measure.pain_moderate") : p === "10" ? t("measure.pain_worst") : undefined,
          }))}
          value={value as (typeof PAIN)[number] | undefined}
          onChange={setValue}
        />
      ) : (
        <TextInput
          label={t("measure.value_label", { unit: unitLabel(chosenUnit) })}
          type="number"
          inputMode="decimal"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      )}

      {!isPain && units.length > 1 ? (
        <ChoiceGrid
          label={t("measure.unit_label")}
          columns={units.length > 2 ? 2 : units.length}
          choices={units.map((u) => ({ value: u.unit, label: u.display }))}
          value={chosenUnit}
          onChange={setUnit}
        />
      ) : null}

      {contexts.length > 0 ? (
        <ChoiceGrid
          label={t("measure.context_label")}
          columns={2}
          choices={[{ value: NO_CONTEXT, label: t("measure.context_none") }, ...contexts.map((c) => ({ value: c as string, label: t(`measure.context.${c}` as never) }))]}
          value={context ?? NO_CONTEXT}
          onChange={(c) => setContext(c === NO_CONTEXT ? undefined : (c as ObservationContext))}
        />
      ) : null}

      <TextInput label={t("bp.note_label")} value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        <Button fullWidth loading={busy} disabled={busy || !ready} onClick={() => void save()} style={{ flex: "1 1 60%" }}>
          {t("bp.save_reading")}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onClose} style={{ flex: "1 1 30%" }}>
          {t("common.cancel")}
        </Button>
      </div>
    </Card>
  );
}
