"use client";
import { useEffect, useState } from "react";
import { ApiError, type ConsentDto } from "@medpass/api-client";
import { Banner, Button, Card, ChoiceGrid, SectionTitle, TextInput } from "@medpass/ui-web";
import { disablePush, enablePush, getPreferences, pushSupported, savePreferences } from "../lib/push";
import { grantConsent, listConsents, revokeConsent } from "../lib/consents";
import { useI18n } from "../lib/i18n";

const SMS_CONSENT_PURPOSE = "Send a text message reminder when a scheduled dose is due, or when a refill/course reminder fires.";

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
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [quietHoursStart, setQuietHoursStart] = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("07:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [smsConsent, setSmsConsent] = useState<ConsentDto | undefined>();
  const [smsBusy, setSmsBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    getPreferences()
      .then((prefs) => {
        setPushEnabled(prefs.pushEnabled);
        setPrivacyMode(prefs.privacyMode);
        setQuietHoursEnabled(prefs.quietHoursEnabled);
        setQuietHoursStart(prefs.quietHoursStart);
        setQuietHoursEnd(prefs.quietHoursEnd);
      })
      .catch(() => {});
  }, [supported]);

  useEffect(() => {
    void reloadSmsConsent();
  }, []);

  async function reloadSmsConsent() {
    try {
      const items = await listConsents();
      setSmsConsent(items.find((c) => c.type === "sms_reminders" && c.status === "active"));
    } catch {
      // Non-fatal — the SMS section just shows as off.
    }
  }

  async function toggleSms() {
    setSmsBusy(true);
    setError(undefined);
    try {
      if (smsConsent) {
        await revokeConsent(smsConsent.id);
      } else {
        await grantConsent("sms_reminders", SMS_CONSENT_PURPOSE);
      }
      await reloadSmsConsent();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t("reminders.error_generic"));
    } finally {
      setSmsBusy(false);
    }
  }

  function currentPrefs(overrides: Partial<ReturnType<typeof snapshot>> = {}) {
    return { ...snapshot(), ...overrides };
  }
  function snapshot() {
    return { pushEnabled, privacyMode, quietHoursEnabled, quietHoursStart, quietHoursEnd };
  }

  async function toggle() {
    setBusy(true);
    setError(undefined);
    try {
      if (pushEnabled) {
        await disablePush();
        await savePreferences(currentPrefs({ pushEnabled: false }));
        setPushEnabled(false);
      } else {
        await enablePush();
        await savePreferences(currentPrefs({ pushEnabled: true }));
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

  async function saveIfEnabled(overrides: Partial<ReturnType<typeof snapshot>>) {
    if (!pushEnabled) return;
    try {
      await savePreferences(currentPrefs(overrides));
    } catch {
      setError(t("reminders.error_generic"));
    }
  }

  async function changePrivacyMode(mode: "generic" | "full_name") {
    setPrivacyMode(mode);
    await saveIfEnabled({ privacyMode: mode });
  }

  async function changeQuietHours(overrides: Partial<ReturnType<typeof snapshot>>) {
    if (overrides.quietHoursEnabled !== undefined) setQuietHoursEnabled(overrides.quietHoursEnabled);
    if (overrides.quietHoursStart !== undefined) setQuietHoursStart(overrides.quietHoursStart);
    if (overrides.quietHoursEnd !== undefined) setQuietHoursEnd(overrides.quietHoursEnd);
    await saveIfEnabled(overrides);
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

            <div style={{ marginTop: "var(--space-md)" }}>
              <ChoiceGrid
                label={t("reminders.quiet_hours_title")}
                columns={2}
                choices={[
                  { value: "on", label: t("reminders.quiet_hours_on") },
                  { value: "off", label: t("reminders.quiet_hours_off") },
                ]}
                value={quietHoursEnabled ? "on" : "off"}
                onChange={(v) => void changeQuietHours({ quietHoursEnabled: v === "on" })}
              />
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {t("reminders.quiet_hours_intro")}
              </span>
              {quietHoursEnabled ? (
                <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                  <TextInput
                    label={t("reminders.quiet_hours_start")}
                    type="time"
                    value={quietHoursStart}
                    onChange={(e) => void changeQuietHours({ quietHoursStart: e.target.value })}
                  />
                  <TextInput
                    label={t("reminders.quiet_hours_end")}
                    type="time"
                    value={quietHoursEnd}
                    onChange={(e) => void changeQuietHours({ quietHoursEnd: e.target.value })}
                  />
                </div>
              ) : null}
            </div>

            <span style={{ display: "block", marginTop: "var(--space-md)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t("reminders.caregiver_note")}
            </span>
          </>
        )}
      </Card>

      <SectionTitle>{t("reminders.sms_title")}</SectionTitle>
      <Card>
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {smsConsent ? t("reminders.sms_enabled") : t("reminders.sms_intro")}
        </span>
        <div style={{ marginTop: "var(--space-sm)" }}>
          <Button variant={smsConsent ? "secondary" : "primary"} disabled={smsBusy} onClick={() => void toggleSms()}>
            {smsConsent ? t("reminders.sms_disable") : t("reminders.sms_enable")}
          </Button>
        </div>
      </Card>
    </>
  );
}
