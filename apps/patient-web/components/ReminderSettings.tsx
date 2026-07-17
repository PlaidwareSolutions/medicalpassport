"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, ChoiceGrid, SectionTitle } from "@medpass/ui-web";
import { disablePush, enablePush, getPreferences, pushSupported, savePreferences } from "../lib/push";
import { useI18n } from "../lib/i18n";

/**
 * Screen 33 (docs/07): opt-in web push + privacy wording. Push is always
 * off by default and the notification never names the medicine unless the
 * patient explicitly picks that here (docs/16 privacy default).
 */
export function ReminderSettings() {
  const { t } = useI18n();
  const [supported] = useState(pushSupported());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<"generic" | "full_name">("generic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!supported) return;
    getPreferences()
      .then((prefs) => {
        setPushEnabled(prefs.pushEnabled);
        setPrivacyMode(prefs.privacyMode);
      })
      .catch(() => {});
  }, [supported]);

  async function toggle() {
    setBusy(true);
    setError(undefined);
    try {
      if (pushEnabled) {
        await disablePush();
        await savePreferences({ pushEnabled: false, privacyMode });
        setPushEnabled(false);
      } else {
        await enablePush();
        await savePreferences({ pushEnabled: true, privacyMode });
        setPushEnabled(true);
      }
    } catch (err) {
      const key = err instanceof Error ? err.message : "";
      setError(
        key === "permission_denied"
          ? t("reminders.permission_denied")
          : key === "not_configured"
            ? t("reminders.not_configured")
            : err instanceof ApiError
              ? err.problem.title
              : t("reminders.error_generic"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function changePrivacyMode(mode: "generic" | "full_name") {
    setPrivacyMode(mode);
    if (!pushEnabled) return;
    try {
      await savePreferences({ pushEnabled, privacyMode: mode });
    } catch {
      setError(t("reminders.error_generic"));
    }
  }

  return (
    <>
      <SectionTitle>{t("reminders.title")}</SectionTitle>
      <Card>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {!supported ? (
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {t("reminders.unsupported")}
          </span>
        ) : (
          <>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {pushEnabled ? t("reminders.enabled") : t("reminders.push_intro")}
            </span>
            <div style={{ marginTop: "var(--space-sm)" }}>
              <Button variant={pushEnabled ? "secondary" : "primary"} disabled={busy} onClick={() => void toggle()}>
                {pushEnabled ? t("reminders.disable") : t("reminders.enable")}
              </Button>
            </div>
            <div style={{ marginTop: "var(--space-md)" }}>
              <ChoiceGrid
                label={t("reminders.privacy_label")}
                columns={1}
                choices={[
                  { value: "generic", label: t("reminders.privacy_generic") },
                  { value: "full_name", label: t("reminders.privacy_full_name") },
                ]}
                value={privacyMode}
                onChange={(v) => void changePrivacyMode(v)}
              />
            </div>
          </>
        )}
      </Card>
    </>
  );
}
