"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, SectionTitle, TextInput } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { updateProfile } from "../lib/profiles";
import { useSession } from "../lib/session";

/** Edits the currently active profile's own name/year of birth (docs/07 screen 2/35). */
export function ProfileDetailsSettings() {
  const { t } = useI18n();
  const { profiles, activeProfileId, refresh } = useSession();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  // Keyed on the id, not the activeProfile object itself: `refresh()` after a
  // successful save replaces the whole `profiles` array with fresh objects,
  // which would otherwise re-trigger this on every save and immediately
  // reset `saved` back to false right after save() sets it to true.
  useEffect(() => {
    if (activeProfile) {
      setName(activeProfile.displayName);
      setYear(activeProfile.yearOfBirth != null ? String(activeProfile.yearOfBirth) : "");
      setSaved(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId]);

  async function save() {
    if (!activeProfile || name.trim().length === 0) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await updateProfile(activeProfile.rowVersion, {
        displayName: name.trim(),
        ...(year.trim() ? { yearOfBirth: Number(year) } : {}),
      });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!activeProfile) return null;

  return (
    <>
      <SectionTitle>{t("profile.details_title")}</SectionTitle>
      <Card>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <TextInput
          label={t("profile.name_label")}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          autoComplete="name"
        />
        <div style={{ height: "var(--space-sm)" }} />
        <TextInput
          label={t("profile.year_of_birth")}
          type="number"
          inputMode="numeric"
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            setSaved(false);
          }}
        />
        <div style={{ marginTop: "var(--space-md)" }}>
          <Button loading={busy} disabled={busy || name.trim().length === 0} onClick={() => void save()}>
            {saved ? t("profile.details_saved") : t("common.save")}
          </Button>
        </div>
      </Card>
    </>
  );
}
