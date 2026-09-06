"use client";
import { useState } from "react";
import { ApiError } from "@medpass/api-client";
import { ALLERGY_CATEGORIES, ALLERGY_CRITICALITIES, type AllergyCategory, type AllergyCriticality } from "@medpass/domain";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { TrustBadge } from "../../components/TrustBadge";
import { addAllergy, deleteAllergy, useAllergies } from "../../lib/allergies";
import { useI18n } from "../../lib/i18n";
import { formatCalendarDate } from "../../lib/patient-time";

const SEVERITIES = ["mild", "moderate", "severe", "unknown"] as const;
const SEVERITY_TONE: Record<string, "default" | "warning" | "danger"> = {
  mild: "default",
  moderate: "warning",
  severe: "danger",
  unknown: "default",
};
const CRITICALITY_TONE: Record<AllergyCriticality, "default" | "warning" | "danger"> = {
  low: "default",
  high: "danger",
  unable_to_assess: "default",
};

/**
 * Screen 30: allergies (docs/07). Feeds the drug-allergy safety check.
 * Phase 1 (docs_v2/06 P1-4) adds what kind of allergy it is and how
 * dangerous a reaction could be — both pickers, no typing.
 */
export default function AllergiesPage() {
  const { t } = useI18n();
  const { items, error, reload } = useAllergies();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<AllergyCategory>("medication");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("unknown");
  const [criticality, setCriticality] = useState<AllergyCriticality>("unable_to_assess");
  const [onsetDate, setOnsetDate] = useState("");
  const [reactionNote, setReactionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  async function save() {
    setBusy(true);
    setFormError(undefined);
    try {
      await addAllergy({
        label: label.trim(),
        severity,
        category,
        criticality,
        onsetDate: onsetDate || null,
        reactionNote: reactionNote.trim() || undefined,
      });
      setLabel("");
      setReactionNote("");
      setOnsetDate("");
      setSeverity("unknown");
      setCategory("medication");
      setCriticality("unable_to_assess");
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("allergy.delete_confirm"))) return;
    setBusy(true);
    try {
      await deleteAllergy(id);
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
        <EmptyState glyph="shield" titleKey="allergy.empty_title" bodyKey="allergy.empty_body" audioId="empty.allergies" />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((a) => (
            <Card key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <strong>{a.label}</strong>
                <Chip tone={SEVERITY_TONE[a.severity]}>{t(`allergy.severity.${a.severity}` as never)}</Chip>
              </div>
              <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                {a.category ? <Chip>{t(`allergy.category.${a.category}` as never)}</Chip> : null}
                {a.criticality && a.criticality !== "unable_to_assess" ? (
                  <Chip tone={CRITICALITY_TONE[a.criticality]}>{t(`allergy.criticality.${a.criticality}` as never)}</Chip>
                ) : null}
                <TrustBadge verification={a.verification} provenanceSource={a.provenanceSource} />
              </div>
              {a.onsetDate ? (
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t("allergy.since", { date: formatCalendarDate(a.onsetDate) })}
                </span>
              ) : null}
              {a.reactionNote ? (
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{a.reactionNote}</span>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="danger" disabled={busy} onClick={() => void remove(a.id)}>
                  {t("allergy.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <TextInput
            label={t("allergy.label_label")}
            placeholder={t("allergy.label_placeholder")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <ChoiceGrid
            label={t("allergy.category_label")}
            value={category}
            onChange={setCategory}
            columns={2}
            choices={ALLERGY_CATEGORIES.map((c) => ({ value: c, label: t(`allergy.category.${c}` as never) }))}
          />
          <ChoiceGrid
            label={t("allergy.severity_label")}
            value={severity}
            onChange={setSeverity}
            columns={2}
            choices={SEVERITIES.map((s) => ({ value: s, label: t(`allergy.severity.${s}` as never) }))}
          />
          <ChoiceGrid
            label={t("allergy.criticality_label")}
            value={criticality}
            onChange={setCriticality}
            columns={1}
            choices={ALLERGY_CRITICALITIES.map((c) => ({
              value: c,
              label: t(`allergy.criticality.${c}` as never),
              description: t(`allergy.criticality_help.${c}` as never),
            }))}
          />
          <TextInput label={t("allergy.onset_label")} type="date" value={onsetDate} onChange={(e) => setOnsetDate(e.target.value)} />
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
