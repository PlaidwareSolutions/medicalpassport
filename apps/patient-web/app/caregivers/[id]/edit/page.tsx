"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Banner, Button, Card, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { PageHeader } from "../../../../components/PageHeader";
import { ScopePicker, scopeStateFrom, selectedScopes, type ScopeState } from "../../../../components/ScopePicker";
import { isStepUpRequired } from "../../../../lib/api";
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
  const [scopes, setScopes] = useState<ScopeState | undefined>();
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
      setScopes(scopeStateFrom(item.scopes));
      setLabel(item.label ?? "");
    }
  }, [item]);

  async function save() {
    if (!scopes) return;
    const selected = selectedScopes(scopes);
    if (selected.length === 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      await updateCaregiverScopes(params.id, selected, label.trim() ? label.trim() : undefined);
      router.replace("/caregivers");
    } catch (err) {
      // Step-up guarded (ADR-V2-012): a cancelled re-verify means nothing changed.
      setSaveError(isStepUpRequired(err) ? t("stepup.not_confirmed") : t("common.error_generic"));
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

  const selectedCount = scopes ? selectedScopes(scopes).length : 0;

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

          <ScopePicker value={scopes} onChange={setScopes} />

          <div style={{ marginTop: "var(--space-lg)" }}>
            <Button fullWidth loading={busy} disabled={busy || selectedCount === 0} onClick={() => void save()}>
              {t("caregiver.edit_save")}
            </Button>
          </div>
        </>
      ) : (
        <PillSpinner label={t("common.loading")} />
      )}
    </AppShell>
  );
}
