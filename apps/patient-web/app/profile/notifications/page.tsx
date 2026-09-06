"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NOTIFICATION_FREQUENCIES, type NotificationChannel, type NotificationFrequency, type NotificationKind } from "@medpass/domain";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { ScopeNotice } from "../../../components/ScopeGate";
import { useI18n } from "../../../lib/i18n";
import {
  DEFAULT_ENTRY,
  NEVER_MUTED_KINDS,
  NOTIFICATION_GROUPS,
  OFFERED_CHANNELS,
  entryFor,
  saveNotificationPreferences,
  useNotificationPreferences,
  type ChannelFrequencyEntry,
  type NotificationPreferencesDto,
} from "../../../lib/notification-preferences";
import { useProfileAccess } from "../../../lib/scopes";

/**
 * Per-kind notification settings (docs_v2/06 P6-4).
 *
 * The screen exists because of hazard H-48: people who get too many
 * messages mute the app, and then miss the one message that mattered. So
 * the fix is to let them turn down the noise per kind — and to make the two
 * kinds that must always arrive visibly, permanently exempt.
 *
 * Those two are rendered as a plain "Always on" statement with the reason,
 * not as a switch that is greyed out. A disabled switch reads as a bug and
 * gets retried; a sentence reads as a decision and gets understood.
 */
export default function NotificationSettingsPage() {
  const { t } = useI18n();
  const access = useProfileAccess();
  const { prefs, error, mutate } = useNotificationPreferences();
  const [draft, setDraft] = useState<NotificationPreferencesDto | undefined>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (prefs && !draft) setDraft(prefs);
  }, [prefs, draft]);

  if (access.ready && !access.can("manage_reminders")) {
    return (
      <AppShell>
        <PageHeader title={t("notify.title")} />
        <ScopeNotice action="manage_reminders" />
      </AppShell>
    );
  }

  function updateKind(kind: NotificationKind, next: ChannelFrequencyEntry) {
    setDraft((d) => (d ? { ...d, channelFrequency: { ...(d.channelFrequency ?? {}), [kind]: next } } : d));
    setSaved(false);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setSaveError(false);
    try {
      const res = await saveNotificationPreferences(draft);
      mutate(res);
      setDraft(res);
      setSaved(true);
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("notify.title")} readAloud={[{ text: t("notify.read_aloud") }]} />

      {error && !prefs ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {saveError ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {saved ? <Banner tone="info">{t("notify.saved")}</Banner> : null}
      {!prefs && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {/* The exempt kinds, stated before anything the patient can change —
          so "why is that not in the list" never has to be asked. */}
      <SectionTitle>{t("notify.always_on_title")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {NEVER_MUTED_KINDS.map((kind) => (
          <Card key={kind} data-testid={`notify-always-on-${kind}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
              <strong style={{ minWidth: 0, overflowWrap: "anywhere" }}>{t(`notify.kind.${kind}` as never)}</strong>
              <Chip tone="success">{t("notify.always_on")}</Chip>
            </div>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t(`notify.always_on_reason.${kind}` as never)}
            </span>
          </Card>
        ))}
      </div>

      {draft
        ? NOTIFICATION_GROUPS.map((group) => (
            <section key={group.id}>
              <SectionTitle>{t(`notify.group.${group.id}` as never)}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {group.kinds.map((kind) => (
                  <KindRow key={kind} kind={kind} entry={entryFor(draft, kind)} onChange={(next) => updateKind(kind, next)} />
                ))}
              </div>
            </section>
          ))
        : null}

      {draft ? (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <Button fullWidth loading={busy} disabled={busy} onClick={() => void save()}>
            {t("notify.save")}
          </Button>
        </div>
      ) : null}

      <div style={{ marginTop: "var(--space-md)" }}>
        <Link href="/profile">
          <Button variant="secondary" fullWidth>
            {t("notify.back_to_settings")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}

function KindRow({ kind, entry, onChange }: { kind: NotificationKind; entry: ChannelFrequencyEntry; onChange: (next: ChannelFrequencyEntry) => void }) {
  const { t } = useI18n();
  const off = entry.frequency === "off";

  function toggleChannel(channel: NotificationChannel, on: boolean) {
    const channels = on ? [...new Set([...entry.channels, channel])] : entry.channels.filter((c) => c !== channel);
    onChange({ ...entry, channels });
  }

  function setFrequency(frequency: NotificationFrequency) {
    // Turning a kind back on with no channel left would look enabled and
    // send nothing — restore the default channel rather than lie.
    const channels = frequency !== "off" && entry.channels.length === 0 ? DEFAULT_ENTRY.channels : entry.channels;
    onChange({ frequency, channels });
  }

  return (
    <Card data-testid={`notify-kind-${kind}`}>
      <strong style={{ overflowWrap: "anywhere" }}>{t(`notify.kind.${kind}` as never)}</strong>

      <div role="group" aria-label={t("notify.how_often")} style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        {NOTIFICATION_FREQUENCIES.map((frequency) => (
          <Button
            key={frequency}
            variant={entry.frequency === frequency ? "primary" : "secondary"}
            aria-pressed={entry.frequency === frequency}
            data-testid={`notify-${kind}-${frequency}`}
            onClick={() => setFrequency(frequency)}
            style={{ flex: "1 1 auto" }}
          >
            {t(`notify.frequency.${frequency}` as never)}
          </Button>
        ))}
      </div>

      {off ? (
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("notify.off_note")}</span>
      ) : (
        <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          {OFFERED_CHANNELS.map((channel) => (
            <label
              key={channel}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                minHeight: "var(--size-touch)",
                padding: "0 var(--space-sm)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={entry.channels.includes(channel)}
                onChange={(e) => toggleChannel(channel, e.target.checked)}
                style={{ width: 24, height: 24 }}
              />
              {t(`notify.channel.${channel}` as never)}
            </label>
          ))}
        </div>
      )}

      {!off && entry.channels.length === 0 ? (
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("notify.no_channel_note")}</span>
      ) : null}
    </Card>
  );
}
