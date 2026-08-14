"use client";
import { useState } from "react";
import { ApiError } from "@medpass/api-client";
import { DEFAULT_TIMEZONE } from "@medpass/domain";
import { Banner, Button, Card, ChoiceGrid, SectionTitle } from "@medpass/ui-web";
import { deviceTimeZone } from "../lib/patient-time";
import { useI18n } from "../lib/i18n";
import { updateProfile } from "../lib/profiles";
import { useSession } from "../lib/session";
import { GuideGlyph } from "./GuideGlyph";
import { ReadAloud } from "./ReadAloud";

/**
 * The profile's timezone — where the medicines physically live (docs/16).
 * Default is India and needs no setup; the picker leads with the device's
 * own zone rather than a cold 400-entry list, because the phone usually
 * already knows the answer. A change re-anchors future reminders server-
 * side, so it goes through an explicit confirmation carrying the docs/10
 * H-28 boundary: dose spacing across a move is a doctor's question, never
 * this app's.
 */
export function TimezoneSettings() {
  const { t } = useI18n();
  const { profiles, activeProfileId, refresh } = useSession();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  const [showOther, setShowOther] = useState(false);
  const [pendingZone, setPendingZone] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!activeProfile) return null;
  const current = activeProfile.timezone;
  const deviceZone = deviceTimeZone();

  const choices = [
    { value: DEFAULT_TIMEZONE, label: t("tz.option_india") },
    ...(deviceZone && deviceZone !== DEFAULT_TIMEZONE
      ? [{ value: deviceZone, label: t("tz.option_device", { zone: deviceZone }) }]
      : []),
    { value: "__other__", label: t("tz.option_other") },
  ];

  function requestChange(zone: string) {
    if (zone === "__other__") {
      setShowOther(true);
      return;
    }
    setShowOther(false);
    if (zone !== current) setPendingZone(zone);
  }

  async function confirmChange() {
    if (!pendingZone || !activeProfile) return;
    setBusy(true);
    setError(undefined);
    try {
      await updateProfile(activeProfile.rowVersion, { timezone: pendingZone });
      await refresh();
      setPendingZone(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>{t("tz.section_title")}</SectionTitle>
      <Card>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {t("tz.current", { zone: current })}
        </span>

        {pendingZone ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-sm)", textAlign: "center", padding: "var(--space-sm) 0" }}>
            <span style={{ color: "var(--color-primary)" }}>
              <GuideGlyph name="bell" size="lg" />
            </span>
            <strong style={{ fontSize: "var(--font-large)" }}>{t("tz.confirm_title")}</strong>
            <p style={{ margin: 0 }}>{t("tz.confirm_body")}</p>
            <ReadAloud segments={[{ audio: "tz.confirm" }]} />
            <Button fullWidth loading={busy} disabled={busy} onClick={() => void confirmChange()}>
              {t("common.continue")}
            </Button>
            <Button fullWidth variant="secondary" disabled={busy} onClick={() => setPendingZone(undefined)}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <div style={{ marginTop: "var(--space-sm)" }}>
            <ChoiceGrid
              label={t("tz.select_label")}
              columns={1}
              choices={choices}
              value={showOther ? "__other__" : current}
              onChange={requestChange}
            />
            {showOther ? (
              <div style={{ marginTop: "var(--space-sm)" }}>
                <label style={{ display: "block", fontSize: "var(--font-small)", marginBottom: "var(--space-xs)" }}>
                  {t("tz.select_label")}
                  <select
                    value={current}
                    onChange={(e) => requestChange(e.target.value)}
                    style={{
                      display: "block",
                      width: "100%",
                      minHeight: "var(--size-touch)",
                      marginTop: "var(--space-xs)",
                      fontSize: "var(--font-body)",
                      fontFamily: "var(--font-family)",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                      padding: "0 var(--space-sm)",
                    }}
                  >
                    {Intl.supportedValuesOf("timeZone").map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </>
  );
}
