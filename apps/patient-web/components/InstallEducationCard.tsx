"use client";
import { useState } from "react";
import { Button, Card } from "@medpass/ui-web";
import { useInstallPrompt } from "../lib/install-prompt";
import { useI18n } from "../lib/i18n";
import { GuideGlyph } from "./GuideGlyph";
import { ReadAloud } from "./ReadAloud";

const DISMISS_KEY = "medpass_a2hs_dismissed";

/**
 * Screen 37 (docs/07): add-to-home-screen education — shown on Home only
 * after the patient has something worth coming back to (the caller gates on
 * ≥1 medicine), dismissible forever, never a nag. Android gets the real
 * install prompt; iOS gets the manual Safari steps (no API exists there).
 * The same content stays reachable later from the Help screen.
 */
export function InstallEducationCard() {
  const { t } = useI18n();
  const { availability, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [showIosSteps, setShowIosSteps] = useState(false);

  if (dismissed || availability === "none") return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode: the card returns next session, which is acceptable.
    }
    // TODO(analytics): a2hs_dismissed (packages/domain has the event name).
    setDismissed(true);
  }

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-sm)", textAlign: "center", padding: "var(--space-sm) 0" }}>
        <span style={{ color: "var(--color-primary)" }}>
          <GuideGlyph name="install" size="lg" />
        </span>
        <strong style={{ fontSize: "var(--font-large)" }}>{t("guide.install.title")}</strong>
        <p style={{ margin: 0 }}>{t("guide.install.body")}</p>
        <ReadAloud segments={[{ audio: "install.education" }]} />
        {availability === "native" ? (
          <Button
            fullWidth
            onClick={() => {
              // TODO(analytics): a2hs_accepted / a2hs_dismissed from the outcome.
              void promptInstall();
            }}
          >
            {t("guide.install.android_button")}
          </Button>
        ) : showIosSteps ? (
          <ol style={{ margin: 0, paddingInlineStart: "1.4em", textAlign: "start", alignSelf: "stretch" }}>
            <li>{t("guide.install.ios_step1")}</li>
            <li>{t("guide.install.ios_step2")}</li>
            <li>{t("guide.install.ios_step3")}</li>
          </ol>
        ) : (
          <Button fullWidth onClick={() => setShowIosSteps(true)}>
            {t("guide.install.android_button")}
          </Button>
        )}
        {showIosSteps ? <ReadAloud segments={[{ audio: "install.ios_steps" }]} /> : null}
        <Button fullWidth variant="secondary" onClick={dismiss}>
          {t("guide.install.dismiss")}
        </Button>
      </div>
    </Card>
  );
}
