"use client";
import Link from "next/link";
import type { MessageKey } from "@medpass/localization";
import { Button, Card, SectionTitle } from "@medpass/ui-web";
import { InstallEducationCard } from "../../components/InstallEducationCard";
import { ReadAloud } from "../../components/ReadAloud";
import type { GuidanceAudioId } from "../../lib/guidance-audio-entries";
import { useI18n } from "../../lib/i18n";

/**
 * Screen 41 (docs/07): Help — the docs/01 "20 core patient questions" as a
 * plain-language FAQ, each answer speakable, plus the tour replay, the
 * install topic, and the emergency boundary. Public and standalone (no
 * AppShell): docs/07's shared defaults exempt Help from auth, and a scared
 * or signed-out user must still reach it. Every answer is app navigation,
 * never medical advice (docs/02) — the two clinically-adjacent answers
 * (interactions, warning signs) restate the "confirm with a professional"
 * boundary in their own words.
 */
const FAQ_SECTIONS: ReadonlyArray<{
  titleKey: MessageKey;
  items: ReadonlyArray<{ q: MessageKey; a: MessageKey; audio: GuidanceAudioId }>;
}> = [
  {
    titleKey: "help.sec_meds",
    items: [
      { q: "help.q_current_meds", a: "help.a_current_meds", audio: "faq.current_meds" },
      { q: "help.q_names", a: "help.a_names", audio: "faq.names" },
      { q: "help.q_ingredients", a: "help.a_ingredients", audio: "faq.ingredients" },
      { q: "help.q_why_prescribed", a: "help.a_why_prescribed", audio: "faq.why_prescribed" },
      { q: "help.q_common_uses", a: "help.a_common_uses", audio: "faq.common_uses" },
      { q: "help.q_same_ingredient", a: "help.a_same_ingredient", audio: "faq.same_ingredient" },
      { q: "help.q_which_doctor", a: "help.a_which_doctor", audio: "faq.which_doctor" },
    ],
  },
  {
    titleKey: "help.sec_timing",
    items: [
      { q: "help.q_how_much", a: "help.a_how_much", audio: "faq.how_much" },
      { q: "help.q_when", a: "help.a_when", audio: "faq.when" },
      { q: "help.q_food", a: "help.a_food", audio: "faq.food" },
      { q: "help.q_how_long", a: "help.a_how_long", audio: "faq.how_long" },
      { q: "help.q_due_now", a: "help.a_due_now", audio: "faq.due_now" },
      { q: "help.q_missed", a: "help.a_missed", audio: "faq.missed" },
      { q: "help.q_running_out", a: "help.a_running_out", audio: "faq.running_out" },
    ],
  },
  {
    titleKey: "help.sec_safety",
    items: [
      { q: "help.q_side_effects", a: "help.a_side_effects", audio: "faq.side_effects" },
      { q: "help.q_warning_signs", a: "help.a_warning_signs", audio: "faq.warning_signs" },
      { q: "help.q_interactions", a: "help.a_interactions", audio: "faq.interactions" },
      { q: "help.q_concerns", a: "help.a_concerns", audio: "faq.concerns" },
    ],
  },
  {
    titleKey: "help.sec_sharing",
    items: [
      { q: "help.q_show_doctor", a: "help.a_show_doctor", audio: "faq.show_doctor" },
      { q: "help.q_caregiver_access", a: "help.a_caregiver_access", audio: "faq.caregiver_access" },
    ],
  },
];

export default function HelpPage() {
  const { t } = useI18n();
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-xl) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>{t("help.title")}</h1>
        <ReadAloud size="md" segments={[{ audio: "screen.help" }]} />
      </div>

      <Card>
        <p style={{ margin: 0 }}>{t("help.intro")}</p>
        <p style={{ margin: "var(--space-sm) 0 0", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {t("app.not_a_doctor")}
        </p>
        <div style={{ marginTop: "var(--space-sm)" }}>
          <ReadAloud segments={[{ audio: "help.intro" }]} />
        </div>
      </Card>

      <Link href="/tour">
        <Card>
          <strong>{t("help.replay_tour")}</strong>
        </Card>
      </Link>

      <InstallEducationCard context="help" />

      {FAQ_SECTIONS.map((section) => (
        <div key={section.titleKey}>
          <SectionTitle>{t(section.titleKey)}</SectionTitle>
          <Card>
            {section.items.map((item) => (
              // Native disclosure: free keyboard/screen-reader semantics and
              // correct RTL marker placement, no JS state to get wrong.
              <details key={item.q} style={{ padding: "var(--space-sm) 0" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: "var(--size-touch)", display: "flex", alignItems: "center" }}>
                  {t(item.q)}
                </summary>
                <p style={{ margin: "var(--space-sm) 0" }}>{t(item.a)}</p>
                <ReadAloud segments={[{ audio: item.audio }]} />
              </details>
            ))}
          </Card>
        </div>
      ))}

      <Card tone="danger">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <strong style={{ fontSize: "var(--font-large)" }}>{t("help.emergency_title")}</strong>
          <p style={{ margin: 0 }}>{t("help.emergency_body")}</p>
          <ReadAloud segments={[{ audio: "help.emergency" }]} />
        </div>
      </Card>

      <Link href="/">
        <Button variant="secondary" fullWidth>
          {t("common.back")}
        </Button>
      </Link>
    </main>
  );
}
