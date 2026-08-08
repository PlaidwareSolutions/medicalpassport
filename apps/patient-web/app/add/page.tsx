"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ApiError, type CatalogProduct } from "@medpass/api-client";
import { DOSE_UNITS, type DoseUnit } from "@medpass/domain";
import { defaultDoseUnitForForm } from "@medpass/medication-terminology";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { api } from "../../lib/api";
import { createMedication } from "../../lib/medications";
import { useI18n } from "../../lib/i18n";

type Frequency = "OD" | "OD_AFTERNOON" | "BD" | "TDS" | "SOS" | "HS" | "PATTERN" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
type Food = "before" | "with" | "after" | "any";

/**
 * Screens 11/12/18: add medication via search or manual entry with
 * typing-free pickers (docs/07). Scan (Stage 3/8) is shown as coming soon.
 *
 * Reading `?prescriptionId=` needs `useSearchParams`, which forces this
 * subtree to render client-side — Next requires a Suspense boundary around
 * it (see the default export below) or the whole route fails to prerender.
 */
function AddMedicationForm() {
  const { t } = useI18n();
  const router = useRouter();
  // Set when arriving from a prescription's detail screen ("add a medicine
  // from this prescription") — links the new medicine to it as evidence and
  // carries the doctor over, so neither has to be re-entered.
  const prescriptionId = useSearchParams().get("prescriptionId") ?? undefined;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProduct[] | undefined>();
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CatalogProduct | undefined>();
  const [manualName, setManualName] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const [doseUnit, setDoseUnit] = useState<DoseUnit>("tablet");
  const [doseQuantity, setDoseQuantity] = useState<string | undefined>("1");
  const [frequency, setFrequency] = useState<Frequency | undefined>();
  const [pattern, setPattern] = useState<"1-0-0" | "1-0-1" | "1-1-1" | "0-0-1" | undefined>();
  const [food, setFood] = useState<Food | undefined>("any");
  const [reason, setReason] = useState("");
  const [prescriber, setPrescriber] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [quantityOnHand, setQuantityOnHand] = useState("");
  const [criticalEscalation, setCriticalEscalation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [savedOffline, setSavedOffline] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2 || manualMode) {
      setResults(undefined);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ items: CatalogProduct[] }>(
          `/catalog/products?q=${encodeURIComponent(query.trim())}`,
        );
        setResults(res.items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, manualMode]);

  // Proposes a default dose unit from the selected product's dosage form
  // (e.g. "syrup" -> ml) — a proposal only, the picker below still lets the
  // patient see and change it.
  useEffect(() => {
    const proposed = defaultDoseUnitForForm(selected?.form);
    if (proposed) setDoseUnit(proposed);
  }, [selected]);

  const nameChosen = Boolean(selected) || (manualMode && manualName.trim().length > 0);
  const instructionReady = doseQuantity && frequency && (frequency !== "PATTERN" || pattern) && food;

  async function save() {
    if (!nameChosen || !instructionReady) return;
    setBusy(true);
    setError(undefined);
    try {
      const { queuedOffline } = await createMedication({
        ...(selected ? { productId: selected.id } : { enteredName: manualName.trim() }),
        source: selected ? "search" : "manual",
        ...(reason.trim() ? { patientReason: reason.trim() } : {}),
        ...(prescriber.trim() ? { prescriberName: prescriber.trim() } : {}),
        ...(prescriptionId ? { prescriptionId } : {}),
        ...(quantityOnHand.trim() ? { quantityOnHand: Number(quantityOnHand) } : {}),
        criticalEscalation,
        instruction: {
          doseQuantity: Number(doseQuantity),
          doseUnit,
          frequencyCode: frequency,
          ...(frequency === "PATTERN" ? { pattern } : {}),
          foodInstruction: food,
          ...(durationDays.trim() ? { durationDays: Number(durationDays) } : {}),
        },
      });
      // A page navigation while offline needs its own network round-trip
      // (docs/12 H-12: PHI screens are never cached as `no-store`, so there's
      // nothing for the browser to serve) — so an offline save stays right
      // here with an inline confirmation instead of forcing a broken
      // redirect; an online save can safely move on to the list.
      if (queuedOffline) setSavedOffline(true);
      else router.replace("/medicines");
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (savedOffline) {
    return (
      <AppShell>
        <Banner tone="info">{t("meds.saved_offline")}</Banner>
        <div style={{ marginTop: "var(--space-md)" }}>
          <Link href="/medicines">
            <Button fullWidth>{t("nav.medicines")}</Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("add.title")} readAloud={[{ audio: "screen.add" }]} />
      {prescriptionId ? <Banner tone="info">{t("add.from_prescription")}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {!selected && !manualMode ? (
        <>
          <TextInput
            label={t("add.search")}
            placeholder={t("add.search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching ? (
            <PillSpinner label={t("common.loading")} />
          ) : results !== undefined ? (
            results.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                {results.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p)}
                    style={{ textAlign: "start", border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "var(--font-family)" }}
                  >
                    <Card>
                      <strong>{p.brandName ?? p.genericName}</strong>
                      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                        {p.ingredients.map((i) => `${i.name} ${i.strength ?? ""}`).join(" + ")} · {p.form ?? ""}
                      </span>
                    </Card>
                  </button>
                ))}
              </div>
            ) : (
              <Card>
                <span style={{ color: "var(--color-text-muted)" }}>{t("add.search_empty")}</span>
              </Card>
            )
          ) : null}
          <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <Button variant="secondary" fullWidth onClick={() => setManualMode(true)}>
              {t("add.manual")}
            </Button>
            <Link href="/add/scan">
              <Button variant="ghost" fullWidth>
                📷 {t("add.scan")}
              </Button>
            </Link>
          </div>
        </>
      ) : (
        <>
          <Card>
            <strong>{selected ? (selected.brandName ?? selected.genericName) : t("add.name_label")}</strong>
            {selected ? (
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {selected.ingredients.map((i) => `${i.name} ${i.strength ?? ""}`).join(" + ")}
              </span>
            ) : (
              <TextInput label={t("add.name_label")} value={manualName} onChange={(e) => setManualName(e.target.value)} />
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setSelected(undefined);
                setManualMode(false);
              }}
            >
              {t("common.back")}
            </Button>
          </Card>

          <SectionTitle>{t("add.dose_unit_label")}</SectionTitle>
          <ChoiceGrid
            label={t("add.dose_unit_label")}
            columns={2}
            choices={DOSE_UNITS.map((u) => ({ value: u, label: t(`medicineType.${u}` as never) }))}
            value={doseUnit}
            onChange={setDoseUnit}
          />

          <SectionTitle>{t("add.dose_label")}</SectionTitle>
          {doseUnit === "tablet" || doseUnit === "capsule" ? (
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
          ) : (
            <TextInput
              label={t("add.dose_label")}
              help={t(`unit.${doseUnit}` as never)}
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0.1"
              value={doseQuantity ?? ""}
              onChange={(e) => setDoseQuantity(e.target.value)}
            />
          )}

          <SectionTitle>{t("add.frequency_label")}</SectionTitle>
          <ChoiceGrid
            label={t("add.frequency_label")}
            choices={[
              { value: "OD", label: t("frequency.od") },
              { value: "OD_AFTERNOON", label: t("frequency.od_afternoon") },
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
            <Button fullWidth loading={busy} disabled={busy || !nameChosen || !instructionReady} onClick={() => void save()}>
              {t("add.save")}
            </Button>
          </div>
        </>
      )}
    </AppShell>
  );
}

export default function AddMedicationPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <PillSpinner label="…" />
        </AppShell>
      }
    >
      <AddMedicationForm />
    </Suspense>
  );
}
