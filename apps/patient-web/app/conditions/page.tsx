"use client";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "@medpass/api-client";
import { CONDITION_CLINICAL_STATUSES, type ConditionClinicalStatus } from "@medpass/domain";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { TrustBadge } from "../../components/TrustBadge";
import { conditions, type ConditionDto } from "../../lib/clinical-profile";
import { useI18n } from "../../lib/i18n";
import { formatCalendarDate } from "../../lib/patient-time";

const STATUS_TONE: Record<ConditionClinicalStatus, "default" | "success" | "warning"> = {
  active: "warning",
  remission: "default",
  resolved: "success",
  inactive: "default",
  unknown: "default",
};

/**
 * Conditions (docs_v2/06 P1-4): what the patient has been told they have,
 * with a status picker and onset/resolved dates. Status is the patient's
 * (or clinic's) word, labelled by provenance — never inferred here.
 */
export default function ConditionsPage() {
  const { t } = useI18n();
  const { items, error, reload } = conditions.useList();
  const [editing, setEditing] = useState<ConditionDto | "new" | undefined>();
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<ConditionClinicalStatus>("active");
  const [onset, setOnset] = useState("");
  const [abatement, setAbatement] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  function open(target: ConditionDto | "new") {
    setEditing(target);
    setFormError(undefined);
    if (target === "new") {
      setLabel("");
      setStatus("active");
      setOnset("");
      setAbatement("");
      setNote("");
    } else {
      setLabel(target.label);
      setStatus(target.clinicalStatus ?? "unknown");
      setOnset(target.onsetDate?.slice(0, 10) ?? "");
      setAbatement(target.abatementDate?.slice(0, 10) ?? "");
      setNote(target.note ?? "");
    }
  }

  const resolvedLike = status === "resolved" || status === "inactive" || status === "remission";

  async function save() {
    if (!editing) return;
    setBusy(true);
    setFormError(undefined);
    try {
      const input = {
        label: label.trim(),
        clinicalStatus: status,
        onsetDate: onset || null,
        abatementDate: resolvedLike && abatement ? abatement : null,
        note: note.trim() || null,
      };
      if (editing === "new") await conditions.add(input);
      else await conditions.update(editing.id, input);
      setEditing(undefined);
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("condition.delete_confirm"))) return;
    setBusy(true);
    try {
      await conditions.remove(id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("condition.title")} readAloud={[{ audio: "screen.conditions" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !editing ? (
        <EmptyState glyph="pulse" titleKey="condition.empty_title" bodyKey="condition.empty_body" cta={{ labelKey: "condition.add", onClick: () => open("new") }} />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((c) => (
            <Card key={c.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <strong>{c.label}</strong>
                {c.clinicalStatus ? <Chip tone={STATUS_TONE[c.clinicalStatus]}>{t(`condition.status.${c.clinicalStatus}` as never)}</Chip> : null}
              </div>
              <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {c.onsetDate ? t("condition.since", { date: formatCalendarDate(c.onsetDate) }) : null}
                {c.onsetDate && c.abatementDate ? " · " : null}
                {c.abatementDate ? t("condition.until", { date: formatCalendarDate(c.abatementDate) }) : null}
              </div>
              {c.note ? <span style={{ fontSize: "var(--font-small)" }}>{c.note}</span> : null}
              <div style={{ display: "flex", gap: "var(--size-touch-gap)", alignItems: "center", flexWrap: "wrap" }}>
                <TrustBadge verification={c.verification} provenanceSource={c.provenanceSource} />
                <span style={{ flex: 1 }} />
                {/* The condition hub (docs_v2/06 P10): what happened around this
                    condition, side by side, never one causing the other. */}
                <Link href={`/conditions/${encodeURIComponent(c.id)}`} data-testid="condition-open-hub">
                  <Button>{t("condition.open_hub")}</Button>
                </Link>
                <Button variant="secondary" onClick={() => open(c)}>
                  {t("condition.edit")}
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void remove(c.id)}>
                  {t("condition.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {editing ? (
        <Card>
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <TextInput label={t("condition.label_label")} placeholder={t("condition.label_placeholder")} value={label} onChange={(e) => setLabel(e.target.value)} />
          <ChoiceGrid
            label={t("condition.status_label")}
            columns={2}
            choices={CONDITION_CLINICAL_STATUSES.map((s) => ({ value: s, label: t(`condition.status.${s}` as never) }))}
            value={status}
            onChange={setStatus}
          />
          <TextInput label={t("condition.onset_label")} type="date" value={onset} onChange={(e) => setOnset(e.target.value)} />
          {resolvedLike ? (
            <TextInput label={t("condition.abatement_label")} type="date" min={onset || undefined} value={abatement} onChange={(e) => setAbatement(e.target.value)} />
          ) : null}
          <TextInput label={t("condition.note_label")} value={note} onChange={(e) => setNote(e.target.value)} />
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button loading={busy} disabled={busy || !label.trim()} onClick={() => void save()}>
              {t("condition.save")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(undefined)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : items && items.length > 0 ? (
        <Button fullWidth onClick={() => open("new")}>
          {t("condition.add")}
        </Button>
      ) : null}
    </AppShell>
  );
}
