"use client";
import { useState } from "react";
import { ApiError } from "@medpass/api-client";
import { ORGANIZATION_KINDS, type OrganizationKind } from "@medpass/domain";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { TrustBadge } from "../../components/TrustBadge";
import { organizations, type OrganizationDto } from "../../lib/clinical-profile";
import { useI18n } from "../../lib/i18n";

/**
 * Clinics & hospitals (docs_v2/06 P1-4): the patient's own places of care —
 * the list behind the clinic picker on visits. Like "My doctors", this is
 * maintenance, not a registration step: clinics are normally added inline
 * while recording a visit.
 */
export default function OrganizationsPage() {
  const { t } = useI18n();
  const { items, error, reload } = organizations.useList();
  const [editing, setEditing] = useState<OrganizationDto | "new" | undefined>();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrganizationKind>("clinic");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  function open(target: OrganizationDto | "new") {
    setEditing(target);
    setFormError(undefined);
    if (target === "new") {
      setName("");
      setKind("clinic");
      setCity("");
      setPhone("");
    } else {
      setName(target.displayName);
      setKind(target.kind);
      setCity(target.city ?? "");
      setPhone(target.phone ?? "");
    }
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setFormError(undefined);
    try {
      const input = { displayName: name.trim(), kind, city: city.trim() || null, phone: phone.replace(/[\s-]/g, "") || null };
      if (editing === "new") await organizations.add(input);
      else await organizations.update(editing.id, input);
      setEditing(undefined);
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("clinic.delete_confirm"))) return;
    setBusy(true);
    try {
      await organizations.remove(id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("clinic.title")} readAloud={[{ audio: "screen.organizations" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !editing ? (
        <EmptyState glyph="hospital" titleKey="clinic.empty_title" bodyKey="clinic.empty_body" cta={{ labelKey: "clinic.add", onClick: () => open("new") }} />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((o) => (
            <Card key={o.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <strong>{o.displayName}</strong>
                <Chip>{t(`clinic.kind.${o.kind}` as never)}</Chip>
              </div>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {[o.city, o.phone].filter(Boolean).join(" · ")}
              </span>
              <div style={{ display: "flex", gap: "var(--size-touch-gap)", alignItems: "center", flexWrap: "wrap" }}>
                <TrustBadge verification={o.verification} />
                <span style={{ flex: 1 }} />
                <Button variant="secondary" onClick={() => open(o)}>
                  {t("clinic.edit")}
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void remove(o.id)}>
                  {t("clinic.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {editing ? (
        <Card>
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <TextInput label={t("clinic.name_label")} placeholder={t("clinic.name_placeholder")} value={name} onChange={(e) => setName(e.target.value)} />
          <ChoiceGrid
            label={t("clinic.kind_label")}
            columns={2}
            choices={ORGANIZATION_KINDS.map((k) => ({ value: k, label: t(`clinic.kind.${k}` as never) }))}
            value={kind}
            onChange={setKind}
          />
          <TextInput label={t("clinic.city_label")} value={city} onChange={(e) => setCity(e.target.value)} />
          <TextInput label={t("clinic.phone_label")} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button loading={busy} disabled={busy || !name.trim()} onClick={() => void save()}>
              {t("common.save")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(undefined)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : items && items.length > 0 ? (
        <Button fullWidth onClick={() => open("new")}>
          {t("clinic.add")}
        </Button>
      ) : null}
    </AppShell>
  );
}
