"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@medpass/localization";
import { Button, Card, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { ReminderSettings } from "../../components/ReminderSettings";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";

interface SessionItem {
  id: string;
  device: { kind: string; label: string | null };
  createdAt: string;
  current: boolean;
}

/** Screens 2/35 + profile hub (docs/07): language, profiles, sessions, sign out. */
export default function ProfilePage() {
  const { t, locale, setLocale } = useI18n();
  const { profiles, activeProfileId, signOut } = useSession();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  useEffect(() => {
    api
      .get<{ items: SessionItem[] }>("/auth/sessions")
      .then((res) => setSessions(res.items))
      .catch(() => setSessions([]));
  }, []);

  async function revoke(id: string) {
    await api.delete(`/auth/sessions/${id}`);
    setSessions((s) => s.filter((x) => x.id !== id));
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("profile.title")}</h1>

      <Link href="/allergies">
        <Card>
          <strong>{t("profile.allergies")}</strong>
        </Card>
      </Link>

      {activeProfile?.relationship !== "caregiver" ? (
        <Link href="/caregivers">
          <Card>
            <strong>{t("profile.caregivers")}</strong>
          </Card>
        </Link>
      ) : null}

      <Link href="/profile/dependents/new">
        <Card>
          <strong>{t("profile.add_dependent")}</strong>
        </Card>
      </Link>

      <ReminderSettings />

      <SectionTitle>{t("profile.language")}</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--size-touch-gap)" }}>
        {SUPPORTED_LOCALES.map((l) => (
          <Button key={l} variant={l === locale ? "primary" : "secondary"} onClick={() => setLocale(l)}>
            {LOCALE_NAMES[l]}
          </Button>
        ))}
      </div>

      <SectionTitle>{t("profile.sessions")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {sessions.map((s) => (
          <Card key={s.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
              <div>
                <strong>{s.device.label ?? s.device.kind}</strong>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {new Date(s.createdAt).toLocaleString()}
                  {s.current ? " · ✓" : ""}
                </div>
              </div>
              {!s.current ? (
                <Button variant="danger" onClick={() => void revoke(s.id)}>
                  ✕
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-xl)" }}>
        <Button variant="secondary" fullWidth onClick={() => void signOut()}>
          {t("auth.sign_out")}
        </Button>
      </div>
    </AppShell>
  );
}
