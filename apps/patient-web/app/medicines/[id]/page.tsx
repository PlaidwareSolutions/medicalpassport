"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { api, getActiveProfileId } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import { instructionSummary, useMedication } from "../../../lib/medications";

/**
 * Screen 19: medication detail (docs/07). "Commonly used for" and "Your
 * recorded reason" are separate labeled blocks; approved clinical content
 * arrives with Stage 6 — until then the mandated no-data fallback is shown.
 */
export default function MedicineDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const { medication, error, fromCache, reload } = useMedication(params.id);
  const [actionError, setActionError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function changeStatus(status: "paused" | "current" | "stopped") {
    if (!medication) return;
    // Safety interstitial (docs/07 screen 19): confirm professional guidance.
    if ((status === "paused" || status === "stopped") && !window.confirm(t("meds.pause_confirm"))) return;
    setBusy(true);
    try {
      await api.post(`/medications/${medication.id}/status`, { rowVersion: medication.rowVersion, status }, {
        profileId: getActiveProfileId(),
      });
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  function speak() {
    if (!medication || !("speechSynthesis" in window)) return;
    const text = [
      medication.product?.brandName ?? medication.enteredName,
      medication.product?.ingredients.map((i) => i.name).join(", "),
      instructionSummary(medication, t as never),
      medication.patientReason ?? "",
    ]
      .filter(Boolean)
      .join(". ");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  if (error && !medication) {
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

  const statusTone =
    medication.status === "current" ? "success" : medication.status === "paused" ? "warning" : "default";

  return (
    <AppShell>
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "var(--space-sm)" }}>
        <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>
          {medication.product?.brandName ?? medication.enteredName}
        </h1>
        <Chip tone={statusTone}>{t(`meds.status.${medication.status}` as never)}</Chip>
      </div>
      <Link href={`/medicines/${medication.id}/edit`}>
        <Button variant="secondary" fullWidth>
          {t("meds.edit")}
        </Button>
      </Link>

      {medication.product ? (
        <Card>
          <strong>{t("meds.ingredients")}</strong>
          {medication.product.ingredients.map((i) => (
            <div key={i.name}>
              {i.name} {i.strength ?? ""}
            </div>
          ))}
        </Card>
      ) : null}

      <SectionTitle>{t("meds.instruction")}</SectionTitle>
      <Card>
        <div style={{ fontSize: "var(--font-large)" }}>{instructionSummary(medication, t as never)}</div>
        {medication.prescriberName ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {t("meds.prescribed_by", { name: medication.prescriberName })}
          </div>
        ) : null}
        {medication.quantityOnHand != null ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {t("meds.quantity_remaining", { count: medication.quantityOnHand, unit: medication.instruction?.doseUnit ?? "" })}
          </div>
        ) : null}
        {"speechSynthesis" in globalThis ? (
          <Button variant="secondary" onClick={speak}>
            🔊 {t("meds.instruction")}
          </Button>
        ) : null}
      </Card>

      {/* The two "used for" blocks are always separate (docs/02 principle 3). */}
      <SectionTitle>{t("meds.your_reason")}</SectionTitle>
      <Card>
        {medication.patientReason ? (
          <span>{medication.patientReason}</span>
        ) : (
          <span style={{ color: "var(--color-text-muted)" }}>{t("meds.your_reason_empty")}</span>
        )}
      </Card>

      <SectionTitle>{t("meds.common_uses")}</SectionTitle>
      <Card tone="info">
        {/* Approved clinical content ships with Stage 6; never fabricate. */}
        <span>{t("meds.no_content")}</span>
      </Card>

      <SectionTitle>{t("meds.history")}</SectionTitle>
      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        {medication.status === "current" ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => void changeStatus("paused")}>
              {t("meds.status.paused")}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void changeStatus("stopped")}>
              {t("meds.status.stopped")}
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => void changeStatus("current")}>
            {t("meds.status.current")}
          </Button>
        )}
      </div>
    </AppShell>
  );
}
