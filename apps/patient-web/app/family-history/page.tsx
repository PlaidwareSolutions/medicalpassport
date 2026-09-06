"use client";
import { useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { TrustBadge } from "../../components/TrustBadge";
import { familyHistory } from "../../lib/clinical-profile";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";

const RELATIONSHIPS = ["mother", "father", "sister", "brother", "grandparent", "child", "other"] as const;
type Relationship = (typeof RELATIONSHIPS)[number];

/**
 * Family history (docs_v2/06 P1-4, docs_v2/10 H-32): illnesses that run in
 * the family. The banner names the profile this is being recorded for —
 * a caregiver managing two parents must never file a mother's history
 * under the father's profile.
 */
export default function FamilyHistoryPage() {
  const { t } = useI18n();
  const { profiles, activeProfileId } = useSession();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const { items, error, reload } = familyHistory.useList();
  const [showForm, setShowForm] = useState(false);
  const [relationship, setRelationship] = useState<Relationship>("mother");
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  async function save() {
    setBusy(true);
    setFormError(undefined);
    try {
      await familyHistory.add({ relationship, conditionText: condition.trim(), notes: notes.trim() || null });
      setShowForm(false);
      setCondition("");
      setNotes("");
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("family.delete_confirm"))) return;
    setBusy(true);
    try {
      await familyHistory.remove(id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function relationshipLabel(value: string): string {
    return (RELATIONSHIPS as readonly string[]).includes(value) ? t(`family.relationship.${value}` as never) : value;
  }

  return (
    <AppShell>
      <PageHeader title={t("family.title")} readAloud={[{ text: t("guide.screen.family_history") }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {activeProfile && profiles.length > 1 ? <Banner tone="info">{t("family.for_profile", { name: activeProfile.displayName })}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <EmptyState glyph="family" titleKey="family.empty_title" bodyKey="family.empty_body" cta={{ labelKey: "family.add", onClick: () => setShowForm(true) }} />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((f) => (
            <Card key={f.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <strong>{f.conditionText}</strong>
                <Chip>{relationshipLabel(f.relationship)}</Chip>
              </div>
              {f.notes ? <span style={{ fontSize: "var(--font-small)" }}>{f.notes}</span> : null}
              <div style={{ display: "flex", gap: "var(--size-touch-gap)", alignItems: "center", flexWrap: "wrap" }}>
                <TrustBadge verification={f.verification} provenanceSource={f.provenanceSource} />
                <span style={{ flex: 1 }} />
                <Button variant="danger" disabled={busy} onClick={() => void remove(f.id)}>
                  {t("family.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <ChoiceGrid
            label={t("family.relationship_label")}
            columns={2}
            choices={RELATIONSHIPS.map((r) => ({ value: r, label: t(`family.relationship.${r}` as never) }))}
            value={relationship}
            onChange={setRelationship}
          />
          <TextInput label={t("family.condition_label")} placeholder={t("family.condition_placeholder")} value={condition} onChange={(e) => setCondition(e.target.value)} />
          <TextInput label={t("family.notes_label")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button loading={busy} disabled={busy || !condition.trim()} onClick={() => void save()}>
              {t("family.save")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setShowForm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : items && items.length > 0 ? (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("family.add")}
        </Button>
      ) : null}
    </AppShell>
  );
}
