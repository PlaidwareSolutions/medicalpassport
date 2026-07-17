"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, type CatalogProduct } from "@medpass/api-client";
import { Banner, Button, Card, ChoiceGrid, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { api, getActiveProfileId, newIdempotencyKey } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

type Frequency = "OD" | "BD" | "TDS" | "SOS" | "HS" | "PATTERN";
type Food = "before" | "with" | "after" | "any";

/**
 * Screens 11/12/18: add medication via search or manual entry with
 * typing-free pickers (docs/07). Scan (Stage 3/8) is shown as coming soon.
 */
export default function AddMedicationPage() {
  const { t } = useI18n();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProduct[] | undefined>();
  const [selected, setSelected] = useState<CatalogProduct | undefined>();
  const [manualName, setManualName] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const [doseQuantity, setDoseQuantity] = useState<"0.5" | "1" | "2" | undefined>("1");
  const [frequency, setFrequency] = useState<Frequency | undefined>();
  const [pattern, setPattern] = useState<"1-0-0" | "1-0-1" | "1-1-1" | "0-0-1" | undefined>();
  const [food, setFood] = useState<Food | undefined>("any");
  const [reason, setReason] = useState("");
  const [prescriber, setPrescriber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (query.trim().length < 2 || manualMode) {
      setResults(undefined);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ items: CatalogProduct[] }>(
          `/catalog/products?q=${encodeURIComponent(query.trim())}`,
        );
        setResults(res.items);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, manualMode]);

  const nameChosen = Boolean(selected) || (manualMode && manualName.trim().length > 0);
  const instructionReady = doseQuantity && frequency && (frequency !== "PATTERN" || pattern) && food;

  async function save() {
    if (!nameChosen || !instructionReady) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post(
        "/profiles/current/medications",
        {
          ...(selected ? { productId: selected.id } : { enteredName: manualName.trim() }),
          source: selected ? "search" : "manual",
          ...(reason.trim() ? { patientReason: reason.trim() } : {}),
          ...(prescriber.trim() ? { prescriberName: prescriber.trim() } : {}),
          instruction: {
            doseQuantity: Number(doseQuantity),
            doseUnit: "tablet",
            frequencyCode: frequency,
            ...(frequency === "PATTERN" ? { pattern } : {}),
            foodInstruction: food,
          },
        },
        { idempotencyKey: newIdempotencyKey(), profileId: getActiveProfileId() },
      );
      router.replace("/medicines");
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("add.title")}</h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {!selected && !manualMode ? (
        <>
          <TextInput
            label={t("add.search")}
            placeholder={t("add.search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results !== undefined ? (
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

          <div style={{ marginTop: "var(--space-lg)" }}>
            <Button fullWidth disabled={busy || !nameChosen || !instructionReady} onClick={() => void save()}>
              {t("add.save")}
            </Button>
          </div>
        </>
      )}
    </AppShell>
  );
}
