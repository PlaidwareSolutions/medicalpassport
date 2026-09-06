"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { BLOOD_GROUPS, type BloodGroup } from "@medpass/domain";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { emergencyContacts, heightAsNumber, updateHealthDetails, useProfileDetails, type EmergencyContactDto } from "../../../lib/clinical-profile";
import { useI18n } from "../../../lib/i18n";

const BLOOD_GROUP_LABEL: Record<BloodGroup, string> = {
  a_pos: "A+",
  a_neg: "A−",
  b_pos: "B+",
  b_neg: "B−",
  ab_pos: "AB+",
  ab_neg: "AB−",
  o_pos: "O+",
  o_neg: "O−",
  unknown: "?",
};

/**
 * Health details (docs_v2/06 P1-4): blood group (a picker — no typing),
 * height with its unit shown, and the people to call in an emergency.
 * Never a clinical threshold: the height bound is plausibility only.
 */
export default function HealthDetailsPage() {
  const { t } = useI18n();
  const { profile, error, reload } = useProfileDetails();
  const [bloodGroup, setBloodGroup] = useState<BloodGroup | undefined>();
  const [height, setHeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  useEffect(() => {
    if (!profile) return;
    setBloodGroup(profile.bloodGroup ?? undefined);
    const h = heightAsNumber(profile.heightCm);
    setHeight(h !== undefined ? String(h) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill once per loaded row version
  }, [profile?.id, profile?.rowVersion]);

  async function save() {
    if (!profile) return;
    setBusy(true);
    setSaved(false);
    setSaveError(undefined);
    try {
      await updateHealthDetails(profile.rowVersion, {
        bloodGroup: bloodGroup ?? null,
        heightCm: height.trim() ? Number(height) : null,
      });
      await reload();
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("health_details.title")} readAloud={[{ text: t("guide.screen.health_details") }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {!profile && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {profile ? (
        <Card>
          {saveError ? <Banner tone="danger">{saveError}</Banner> : null}
          <ChoiceGrid
            label={t("health_details.blood_group_label")}
            columns={3}
            choices={BLOOD_GROUPS.map((g) => ({
              value: g,
              label: g === "unknown" ? t("health_details.blood_group_unknown") : BLOOD_GROUP_LABEL[g],
            }))}
            value={bloodGroup}
            onChange={(g) => {
              setBloodGroup(g);
              setSaved(false);
            }}
          />
          <TextInput
            label={t("health_details.height_label")}
            help={t("health_details.height_help")}
            type="number"
            inputMode="decimal"
            min={30}
            max={250}
            value={height}
            onChange={(e) => {
              setHeight(e.target.value);
              setSaved(false);
            }}
          />
          <Button loading={busy} disabled={busy} onClick={() => void save()}>
            {saved ? t("profile.details_saved") : t("common.save")}
          </Button>
        </Card>
      ) : null}

      <EmergencyContactsSection />
    </AppShell>
  );
}

const RELATIONSHIPS = ["spouse", "child", "parent", "sibling", "friend", "neighbour", "other"] as const;

function EmergencyContactsSection() {
  const { t } = useI18n();
  const { items, error, reload } = emergencyContacts.useList();
  const [editing, setEditing] = useState<EmergencyContactDto | "new" | undefined>();
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<(typeof RELATIONSHIPS)[number]>("child");
  const [phone, setPhone] = useState("+91");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  function open(target: EmergencyContactDto | "new") {
    setEditing(target);
    setFormError(undefined);
    if (target === "new") {
      setName("");
      setRelationship("child");
      setPhone("+91");
    } else {
      setName(target.name);
      setRelationship((RELATIONSHIPS as readonly string[]).includes(target.relationship ?? "") ? (target.relationship as (typeof RELATIONSHIPS)[number]) : "other");
      setPhone(target.phone);
    }
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setFormError(undefined);
    try {
      const input = { name: name.trim(), relationship, phone: phone.replace(/[\s-]/g, "") };
      if (editing === "new") await emergencyContacts.add({ ...input, priority: (items?.length ?? 0) + 1 });
      else await emergencyContacts.update(editing.id, input);
      setEditing(undefined);
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("health_details.contact_delete_confirm"))) return;
    setBusy(true);
    try {
      await emergencyContacts.remove(id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...(items ?? [])].sort((a, b) => a.priority - b.priority);

  return (
    <>
      <SectionTitle>{t("health_details.contacts_title")}</SectionTitle>
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !editing ? (
        <EmptyState
          glyph="phone"
          titleKey="health_details.contacts_empty_title"
          bodyKey="health_details.contacts_empty_body"
          cta={{ labelKey: "health_details.contact_add", onClick: () => open("new") }}
        />
      ) : null}

      {sorted.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {sorted.map((c) => (
            <Card key={c.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{c.name}</strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {c.relationship ? `${t(`health_details.relationship.${c.relationship}` as never)} · ` : ""}
                    <a href={`tel:${c.phone}`} style={{ textDecoration: "underline" }}>
                      {c.phone}
                    </a>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "var(--size-touch-gap)" }}>
                  <Button variant="secondary" onClick={() => open(c)}>
                    {t("health_details.contact_edit")}
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => void remove(c.id)}>
                    {t("health_details.contact_delete")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {editing ? (
        <Card>
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <TextInput label={t("health_details.contact_name_label")} value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          <ChoiceGrid
            label={t("health_details.contact_relationship_label")}
            columns={2}
            choices={RELATIONSHIPS.map((r) => ({ value: r, label: t(`health_details.relationship.${r}` as never) }))}
            value={relationship}
            onChange={setRelationship}
          />
          <TextInput
            label={t("health_details.contact_phone_label")}
            help={t("health_details.contact_phone_help")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button loading={busy} disabled={busy || !name.trim() || phone.replace(/\D/g, "").length < 8} onClick={() => void save()}>
              {t("common.save")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(undefined)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : items && items.length > 0 ? (
        <Button fullWidth onClick={() => open("new")}>
          {t("health_details.contact_add")}
        </Button>
      ) : null}
    </>
  );
}
