"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, ChoiceGrid, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { api } from "../../../../lib/api";
import { useI18n } from "../../../../lib/i18n";
import { useSession } from "../../../../lib/session";

type Relationship = "parent" | "child" | "spouse" | "sibling" | "other";
const RELATIONSHIPS: Relationship[] = ["parent", "child", "spouse", "sibling", "other"];

/** Screen 5: caregiver creates a managed profile (docs/07). */
export default function AddDependentPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { refresh, selectProfile } = useSession();

  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [relationship, setRelationship] = useState<Relationship | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function save() {
    if (!relationship) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.post<{ id: string }>("/profiles/dependents", {
        displayName: name,
        ...(year ? { yearOfBirth: Number(year) } : {}),
        preferredLocale: locale,
        relationship,
      });
      await refresh();
      selectProfile(res.id);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("caregiver.dependent_add_title")}</h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <span style={{ color: "var(--color-text-muted)" }}>{t("caregiver.dependent_intro")}</span>

      <TextInput
        label={t("caregiver.dependent_name_label")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
      />
      <TextInput
        label={t("caregiver.dependent_year_label")}
        type="number"
        inputMode="numeric"
        value={year}
        onChange={(e) => setYear(e.target.value)}
      />

      <SectionTitle>{t("caregiver.dependent_relationship_label")}</SectionTitle>
      <ChoiceGrid
        label={t("caregiver.dependent_relationship_label")}
        columns={3}
        choices={RELATIONSHIPS.map((r) => ({ value: r, label: t(`caregiver.relationship.${r}` as never) }))}
        value={relationship}
        onChange={setRelationship}
      />

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Button fullWidth disabled={busy || name.trim().length === 0 || !relationship} onClick={() => void save()}>
          {t("caregiver.dependent_create")}
        </Button>
      </div>
    </AppShell>
  );
}
