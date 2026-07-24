"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CAREGIVER_SCOPES, type CaregiverScope } from "@medpass/domain";
import { Banner, Button, Card, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { PageHeader } from "../../../../components/PageHeader";
import { useI18n } from "../../../../lib/i18n";
import { updateCaregiverScopes, useCaregivers } from "../../../../lib/caregivers";
import { useSession } from "../../../../lib/session";

/**
 * Screen 6 (edit scopes part). No single-item GET endpoint exists for a
 * caregiver relationship — derives its item from the list instead.
 */
export default function EditCaregiverPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { profiles, activeProfileId } = useSession();
  const { items, error } = useCaregivers();
  const [scopes, setScopes] = useState<Record<CaregiverScope, boolean> | undefined>();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const item = items?.find((i) => i.id === params.id);

  useEffect(() => {
    if (activeProfile && activeProfile.relationship === "caregiver") router.replace("/profile");
  }, [activeProfile, router]);

  useEffect(() => {
    if (item) {
      setScopes(Object.fromEntries(CAREGIVER_SCOPES.map((s) => [s, item.scopes.includes(s)])) as Record<CaregiverScope, boolean>);
      setLabel(item.label ?? "");
    }
  }, [item]);

  async function save() {
    if (!scopes) return;
    const selected = CAREGIVER_SCOPES.filter((s) => scopes[s]);
    if (selected.length === 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      await updateCaregiverScopes(params.id, selected, label.trim() ? label.trim() : undefined);
      router.replace("/caregivers");
    } catch {
      setSaveError(t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  if (items && !item) {
    return (
      <AppShell>
        <PageHeader title={t("caregiver.not_found_title")} />
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("caregiver.not_found_body")}</span>
        </Card>
      </AppShell>
    );
  }

  const selectedCount = scopes ? CAREGIVER_SCOPES.filter((s) => scopes[s]).length : 0;

  return (
    <AppShell>
      <PageHeader title={t("caregiver.edit_title")} />
      {error || saveError ? <Banner tone="danger">{saveError ?? t("common.error_generic")}</Banner> : null}

      {scopes ? (
        <>
          <TextInput
            label={t("caregiver.label_field")}
            help={t("caregiver.label_help")}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />

          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("caregiver.scopes_help")}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
            {CAREGIVER_SCOPES.map((scope) => (
              <label
                key={scope}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  minHeight: "var(--size-touch)",
                  padding: "var(--space-sm)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={scopes[scope]}
                  onChange={(e) => setScopes((s) => (s ? { ...s, [scope]: e.target.checked } : s))}
                  style={{ width: 24, height: 24 }}
                />
                {t(`caregiver.scope.${scope}` as never)}
              </label>
            ))}
          </div>

          <div style={{ marginTop: "var(--space-lg)" }}>
            <Button fullWidth disabled={busy || selectedCount === 0} onClick={() => void save()}>
              {t("caregiver.edit_save")}
            </Button>
          </div>
        </>
      ) : (
        <p style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</p>
      )}
    </AppShell>
  );
}
