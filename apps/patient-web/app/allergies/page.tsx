"use client";
import { useState } from "react";
import { Banner, Button, Card, Chip, PillSpinner, TextInput } from "@medpass/ui-web";
import { ChoiceGrid } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { addAllergy, useAllergies } from "../../lib/allergies";
import { useI18n } from "../../lib/i18n";

const SEVERITIES = ["mild", "moderate", "severe", "unknown"] as const;
const SEVERITY_TONE: Record<string, "default" | "warning" | "danger"> = {
  mild: "default",
  moderate: "warning",
  severe: "danger",
  unknown: "default",
};

/** Screen 30: allergies (docs/07). Feeds the drug-allergy safety check. */
export default function AllergiesPage() {
  const { t } = useI18n();
  const { items, error, reload } = useAllergies();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("unknown");
  const [reactionNote, setReactionNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await addAllergy({ label, severity, reactionNote: reactionNote || undefined });
      setLabel("");
      setReactionNote("");
      setSeverity("unknown");
      setShowForm(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("allergy.title")} readAloud={[{ audio: "screen.allergies" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("allergy.empty")}</span>
        </Card>
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((a) => (
            <Card key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{a.label}</strong>
                <Chip tone={SEVERITY_TONE[a.severity]}>{t(`allergy.severity.${a.severity}` as never)}</Chip>
              </div>
              {a.reactionNote ? (
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{a.reactionNote}</span>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          <TextInput
            label={t("allergy.label_label")}
            placeholder={t("allergy.label_placeholder")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <ChoiceGrid
            label={t("allergy.severity_label")}
            value={severity}
            onChange={setSeverity}
            columns={2}
            choices={SEVERITIES.map((s) => ({ value: s, label: t(`allergy.severity.${s}` as never) }))}
          />
          <TextInput
            label={t("allergy.reaction_label")}
            value={reactionNote}
            onChange={(e) => setReactionNote(e.target.value)}
          />
          <Button fullWidth loading={busy} disabled={busy || label.trim().length === 0} onClick={() => void save()}>
            {t("allergy.save")}
          </Button>
        </Card>
      ) : (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("allergy.add")}
        </Button>
      )}
    </AppShell>
  );
}
