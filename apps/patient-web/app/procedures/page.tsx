"use client";
import { useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { TrustBadge } from "../../components/TrustBadge";
import { procedures } from "../../lib/clinical-profile";
import { useI18n } from "../../lib/i18n";
import { formatCalendarDate } from "../../lib/patient-time";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Surgeries & procedures (docs_v2/06 P1-4): what was done and when — the history a new doctor always asks for first. */
export default function ProceduresPage() {
  const { t } = useI18n();
  const { items, error, reload } = procedures.useList();
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [performedOn, setPerformedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  async function save() {
    setBusy(true);
    setFormError(undefined);
    try {
      await procedures.add({ procedureText: text.trim(), performedOn, notes: notes.trim() || null });
      setShowForm(false);
      setText("");
      setNotes("");
      setPerformedOn(today());
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("procedure.delete_confirm"))) return;
    setBusy(true);
    try {
      await procedures.remove(id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("procedure.title")} readAloud={[{ audio: "screen.procedures" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <EmptyState glyph="cross" titleKey="procedure.empty_title" bodyKey="procedure.empty_body" cta={{ labelKey: "procedure.add", onClick: () => setShowForm(true) }} />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((p) => (
            <Card key={p.id}>
              <strong>{p.procedureText}</strong>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{formatCalendarDate(p.performedOn)}</span>
              {p.notes ? <span style={{ fontSize: "var(--font-small)" }}>{p.notes}</span> : null}
              <div style={{ display: "flex", gap: "var(--size-touch-gap)", alignItems: "center", flexWrap: "wrap" }}>
                <TrustBadge verification={p.verification} provenanceSource={p.provenanceSource} />
                <span style={{ flex: 1 }} />
                <Button variant="danger" disabled={busy} onClick={() => void remove(p.id)}>
                  {t("procedure.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <TextInput label={t("procedure.label_label")} placeholder={t("procedure.label_placeholder")} value={text} onChange={(e) => setText(e.target.value)} />
          <TextInput label={t("procedure.date_label")} type="date" max={today()} value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} />
          <TextInput label={t("procedure.notes_label")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button loading={busy} disabled={busy || !text.trim() || !performedOn} onClick={() => void save()}>
              {t("procedure.save")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setShowForm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : items && items.length > 0 ? (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("procedure.add")}
        </Button>
      ) : null}
    </AppShell>
  );
}
