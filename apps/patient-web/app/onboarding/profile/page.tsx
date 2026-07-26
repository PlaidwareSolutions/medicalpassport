"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, TextInput } from "@medpass/ui-web";
import { api } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import { useSession } from "../../../lib/session";

/** Screen 4: minimal profile — completable with almost no typing (docs/07). */
export default function CreateProfilePage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { refresh } = useSession();

  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/profiles", {
        displayName: name,
        ...(year ? { yearOfBirth: Number(year) } : {}),
        preferredLocale: locale,
      });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.problem.errors?.[0]?.message ?? err.problem.title)
          : t("common.error_generic"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-xl) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <h1 style={{ fontSize: "var(--font-title)" }}>{t("profile.create_title")}</h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <TextInput label={t("profile.name_label")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      <TextInput
        label={t("profile.year_of_birth")}
        type="number"
        inputMode="numeric"
        value={year}
        onChange={(e) => setYear(e.target.value)}
      />
      <Button fullWidth loading={busy} disabled={busy || name.trim().length === 0} onClick={() => void save()}>
        {t("common.continue")}
      </Button>
    </main>
  );
}
