"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, type PatientMedicationDto } from "@medpass/api-client";
import { DOSE_UNITS, type DoseUnit } from "@medpass/domain";
import { Banner, Button, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { MedicineGlyph, glyphForDoseUnit } from "../../../components/MedicineGlyph";
import { PageHeader } from "../../../components/PageHeader";
import { useI18n } from "../../../lib/i18n";
import { confirmDoseUnit, needsTypeConfirmation, useMedications } from "../../../lib/medications";

/**
 * Screen 9 follow-up: asks what kind of medicine each unconfirmed entry
 * actually is.
 *
 * Until 2026-07-25 the app hardcoded "tablet" on every save, so a syrup filed
 * back then still reads as a tablet. That was survivable while the unit was
 * only ever text; the medicines list now draws it as a picture, and a picture
 * is trusted by exactly the patient who can't read the line beside it.
 *
 * One medicine per screen (docs/33 "one primary action per screen"), showing
 * each option's real glyph so the answer can be given without reading — the
 * whole point of the prompt.
 */
export default function ConfirmMedicineTypePage() {
  const { t } = useI18n();
  const { items, error, reload } = useMedications();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [done, setDone] = useState<string[]>([]);

  const pending = useMemo(
    () => (items ?? []).filter((m) => needsTypeConfirmation(m) && !done.includes(m.id)),
    [items, done],
  );

  async function answer(medication: PatientMedicationDto, doseUnit: DoseUnit) {
    setBusy(true);
    setActionError(undefined);
    try {
      await confirmDoseUnit(medication.id, doseUnit);
      setDone((prev) => [...prev, medication.id]);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  if (error && !items) {
    return (
      <AppShell>
        <Banner tone="danger">{t("common.error_generic")}</Banner>
      </AppShell>
    );
  }
  if (!items) {
    return (
      <AppShell>
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  const current = pending[0];

  if (!current) {
    return (
      <AppShell>
        <PageHeader title={t("confirmtype.title")} readAloud={[{ audio: "screen.confirm_type" }]} />
        <Card tone="info">
          <strong>{t("confirmtype.all_done")}</strong>
        </Card>
        <Link href="/medicines">
          <Button fullWidth>{t("confirmtype.back_to_medicines")}</Button>
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("confirmtype.title")} readAloud={[{ audio: "screen.confirm_type" }]} />
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {t("confirmtype.remaining", { count: pending.length })}
      </span>

      <Card>
        <strong style={{ fontSize: "var(--font-large)" }}>
          {current.product?.brandName ?? current.enteredName}
        </strong>
        {current.product ? (
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {current.product.ingredients.map((i) => i.name).join(" + ")} {current.product.strengthLabel ?? ""}
          </span>
        ) : null}
      </Card>

      <SectionTitle>{t("confirmtype.question")}</SectionTitle>

      {busy ? (
        <PillSpinner label={t("common.loading")} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--size-touch-gap)" }}>
          {DOSE_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => void answer(current, u)}
              style={{
                minHeight: "var(--size-touch)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-sm)",
                // The stored unit is only ever a suggestion here — that it was
                // never chosen is the reason for this screen.
                border: `2px solid ${u === current.instruction?.doseUnit ? "var(--color-primary)" : "var(--color-border)"}`,
                background: "var(--color-bg)",
                color: "var(--color-text)",
                fontSize: "var(--font-body)",
                fontFamily: "var(--font-family)",
                textAlign: "start",
                cursor: "pointer",
              }}
            >
              <span style={{ color: "var(--color-primary)", display: "inline-flex" }}>
                <MedicineGlyph name={glyphForDoseUnit(u)} size="lg" />
              </span>
              <span>{t(`medicineType.${u}` as never)}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Link href="/medicines">
          <Button variant="ghost" fullWidth>
            {t("confirmtype.later")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
