"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, ChoiceGrid, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { updateMedication, useMedication } from "../../../../lib/medications";
import { useI18n } from "../../../../lib/i18n";

type Frequency = "OD" | "BD" | "TDS" | "SOS" | "HS" | "PATTERN" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
type Food = "before" | "with" | "after" | "any";

/**
 * Edits a medicine's confirmed dose/frequency/food instruction and recorded
 * reason (docs/07 screen 19's edit path). Dose/frequency/food are the same
 * typing-free pickers as Add — never free text for a hazard-critical field.
 * Falls back to cached data (`useMedication`) so this remains usable
 * offline for anything already visited this session, not just when live.
 */
export default function EditMedicationPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { medication, error: loadError, fromCache } = useMedication(params.id);

  const [doseQuantity, setDoseQuantity] = useState<"0.5" | "1" | "2" | undefined>();
  const [frequency, setFrequency] = useState<Frequency | undefined>();
  const [pattern, setPattern] = useState<"1-0-0" | "1-0-1" | "1-1-1" | "0-0-1" | undefined>();
  const [food, setFood] = useState<Food | undefined>();
  const [reason, setReason] = useState("");
  const [prescriber, setPrescriber] = useState("");
  // The API creates a fresh Practitioner record whenever prescriberName is
  // sent at all (docs/13 "patient-scoped prescriber records" — there's no
  // dedup/reuse by name) — only send it when it actually changed, so saving
  // an unrelated field (dose, reason, etc.) doesn't spawn a duplicate row.
  const [initialPrescriber, setInitialPrescriber] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [quantityOnHand, setQuantityOnHand] = useState("");
  const [criticalEscalation, setCriticalEscalation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [savedOffline, setSavedOffline] = useState(false);

  useEffect(() => {
    if (!medication) return;
    setReason(medication.patientReason ?? "");
    setPrescriber(medication.prescriberName ?? "");
    setInitialPrescriber(medication.prescriberName ?? "");
    setQuantityOnHand(medication.quantityOnHand ?? "");
    setCriticalEscalation(medication.criticalEscalation);
    if (medication.instruction) {
      setDoseQuantity(medication.instruction.doseQuantity as "0.5" | "1" | "2");
      setFrequency(medication.instruction.frequencyCode as Frequency);
      if (medication.instruction.pattern) setPattern(medication.instruction.pattern as never);
      setFood(medication.instruction.foodInstruction as Food);
      setDurationDays(medication.instruction.durationDays != null ? String(medication.instruction.durationDays) : "");
    }
  }, [medication]);

  const instructionReady = doseQuantity && frequency && (frequency !== "PATTERN" || pattern) && food;

  async function save() {
    if (!medication || !instructionReady) return;
    setBusy(true);
    setError(undefined);
    try {
      const { queuedOffline } = await updateMedication(medication, {
        patientReason: reason.trim(),
        ...(prescriber.trim() !== initialPrescriber ? { prescriberName: prescriber.trim() } : {}),
        quantityOnHand: quantityOnHand.trim() ? Number(quantityOnHand) : null,
        criticalEscalation,
        instruction: {
          doseQuantity: Number(doseQuantity),
          doseUnit: "tablet",
          frequencyCode: frequency,
          ...(frequency === "PATTERN" ? { pattern } : {}),
          foodInstruction: food,
          ...(durationDays.trim() ? { durationDays: Number(durationDays) } : {}),
        },
      });
      // Same reasoning as Add: a fresh page navigation needs a network
      // round-trip this app deliberately never caches for PHI screens
      // (docs/12 H-12), so an offline save stays on this page with an
      // inline confirmation rather than a redirect that would just fail.
      if (queuedOffline) setSavedOffline(true);
      else router.replace(`/medicines/${medication.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !medication) {
    return (
      <AppShell>
        <Banner tone="danger">{t("common.error_generic")}</Banner>
      </AppShell>
    );
  }
  if (!medication) {
    return (
      <AppShell>
        <p style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</p>
      </AppShell>
    );
  }

  if (savedOffline) {
    return (
      <AppShell>
        <Banner tone="info">{t("meds.saved_offline")}</Banner>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("meds.edit_title")}</h1>
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <SectionTitle>{t("add.dose_label")}</SectionTitle>
      <ChoiceGrid
        label={t("add.dose_label")}
        columns={3}
        choices={[
          { value: "0.5", label: "½" },
          { value: "1", label: "1" },
          { value: "2", label: "2" },
        ]}
        value={doseQuantity}
        onChange={setDoseQuantity}
      />

      <SectionTitle>{t("add.frequency_label")}</SectionTitle>
      <ChoiceGrid
        label={t("add.frequency_label")}
        choices={[
          { value: "OD", label: t("frequency.od") },
          { value: "BD", label: t("frequency.bd") },
          { value: "TDS", label: t("frequency.tds") },
          { value: "HS", label: t("frequency.hs") },
          { value: "SOS", label: t("frequency.sos") },
          { value: "PATTERN", label: t("frequency.pattern") },
          { value: "WEEKLY", label: t("frequency.weekly") },
          { value: "FORTNIGHTLY", label: t("frequency.fortnightly") },
          { value: "MONTHLY", label: t("frequency.monthly") },
        ]}
        value={frequency}
        onChange={setFrequency}
      />
      {frequency === "PATTERN" ? (
        <ChoiceGrid
          label={t("frequency.pattern")}
          columns={4}
          choices={[
            { value: "1-0-0", label: "1-0-0" },
            { value: "1-0-1", label: "1-0-1" },
            { value: "1-1-1", label: "1-1-1" },
            { value: "0-0-1", label: "0-0-1" },
          ]}
          value={pattern}
          onChange={setPattern}
        />
      ) : null}

      <SectionTitle>{t("add.food_label")}</SectionTitle>
      <ChoiceGrid
        label={t("add.food_label")}
        columns={2}
        choices={[
          { value: "before", label: t("food.before") },
          { value: "with", label: t("food.with") },
          { value: "after", label: t("food.after") },
          { value: "any", label: t("food.any") },
        ]}
        value={food}
        onChange={setFood}
      />

      <SectionTitle>{t("add.reason_label")}</SectionTitle>
      <TextInput label={t("add.reason_label")} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div style={{ height: "var(--space-sm)" }} />
      <TextInput label={t("add.prescriber_label")} value={prescriber} onChange={(e) => setPrescriber(e.target.value)} />
      <div style={{ height: "var(--space-sm)" }} />
      <TextInput
        label={t("add.duration_label")}
        type="number"
        inputMode="numeric"
        value={durationDays}
        onChange={(e) => setDurationDays(e.target.value)}
      />
      <div style={{ height: "var(--space-sm)" }} />
      <TextInput
        label={t("add.quantity_label")}
        type="number"
        inputMode="numeric"
        value={quantityOnHand}
        onChange={(e) => setQuantityOnHand(e.target.value)}
      />

      <SectionTitle>{t("add.critical_escalation_label")}</SectionTitle>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {t("add.critical_escalation_intro")}
      </span>
      <ChoiceGrid
        label={t("add.critical_escalation_label")}
        columns={2}
        choices={[
          { value: "off", label: t("add.critical_escalation_off") },
          { value: "on", label: t("add.critical_escalation_on") },
        ]}
        value={criticalEscalation ? "on" : "off"}
        onChange={(v) => setCriticalEscalation(v === "on")}
      />

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Button fullWidth disabled={busy || !instructionReady} onClick={() => void save()}>
          {t("meds.edit_save")}
        </Button>
      </div>
    </AppShell>
  );
}
