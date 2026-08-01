"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { DoseVisual } from "../../components/DoseVisual";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { needsTypeConfirmation, scheduleSummary, useMedications } from "../../lib/medications";

/** Screen 9/10: current passport + previous medicines (docs/07). */
export default function MedicinesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"current" | "previous">("current");
  const current = useMedications("current");
  const all = useMedications();

  const previous = (all.items ?? []).filter((m) => m.status !== "current");
  const shown = tab === "current" ? (current.items ?? []) : previous;
  const stillLoading = tab === "current" ? current.items === undefined : all.items === undefined;

  const statusTone = (status: string) =>
    status === "current" ? "success" : status === "paused" ? "warning" : "default";

  // Medicines whose type the app defaulted rather than asked about. Offered
  // once, at the top, rather than as a badge on every affected tile — 27 of
  // the pilot's 32 medicines qualify, and a nag on each would bury the list.
  const unconfirmed = (all.items ?? []).filter(needsTypeConfirmation);

  return (
    <AppShell>
      <PageHeader title={t("nav.medicines")} />
      {unconfirmed.length > 0 ? (
        <Link href="/medicines/confirm-type" style={{ textDecoration: "none" }}>
          <Card tone="info">
            <strong>{t("confirmtype.banner_title", { count: unconfirmed.length })}</strong>
            <span style={{ fontSize: "var(--font-small)" }}>{t("confirmtype.banner_body")}</span>
          </Card>
        </Link>
      ) : null}
      <div role="tablist" style={{ display: "flex", gap: "var(--size-touch-gap)", marginBottom: "var(--space-md)" }}>
        {(["current", "previous"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            style={{
              flex: 1,
              minHeight: "var(--size-touch)",
              borderRadius: "var(--radius-sm)",
              border: `2px solid ${tab === k ? "var(--color-primary)" : "var(--color-border)"}`,
              background: tab === k ? "var(--color-primary-soft)" : "var(--color-bg)",
              fontWeight: tab === k ? 700 : 400,
              fontSize: "var(--font-body)",
              fontFamily: "var(--font-family)",
              cursor: "pointer",
            }}
          >
            {k === "current" ? t("meds.current") : t("meds.previous")}
          </button>
        ))}
      </div>

      {stillLoading ? (
        <PillSpinner label={t("common.loading")} />
      ) : shown.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>{t("meds.empty")}</p>
          {tab === "current" ? (
            <Link href="/add">
              <Button fullWidth>{t("home.add_first")}</Button>
            </Link>
          ) : null}
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {shown.map((m) => (
            <Link key={m.id} href={`/medicines/${m.id}`}>
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
                  <strong style={{ fontSize: "var(--font-large)" }}>{m.product?.brandName ?? m.enteredName}</strong>
                  <Chip tone={statusTone(m.status)}>{t(`meds.status.${m.status}` as never)}</Chip>
                </div>
                {m.product ? (
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {m.product.ingredients.map((i) => i.name).join(" + ")} {m.product.strengthLabel ?? ""}
                  </span>
                ) : null}
                {/* Dose and timing as a picture first, for a patient who
                    can't read the line below it (docs/07 screen 9). */}
                <DoseVisual instruction={m.instruction} />
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {scheduleSummary(m, t as never)}
                </span>
                {/* Omitted rather than shown as "not recorded" — a medicine
                    needs no prescriber to be valid (docs/07 screen 43). */}
                {m.prescriberName ? (
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {t("meds.prescribed_by", { name: m.prescriberName })}
                  </span>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Link href="/visit">
        <Button variant="secondary" fullWidth>
          {t("visit.title")}
        </Button>
      </Link>
    </AppShell>
  );
}
