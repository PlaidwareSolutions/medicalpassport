"use client";
import { Button, Card } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { GuideGlyph } from "./GuideGlyph";
import { ReadAloud } from "./ReadAloud";

/**
 * Screen 38 (docs/07): the friendly explainer that must come BEFORE any OS
 * permission prompt. The raw browser dialog is the single most common place
 * an elder taps "Don't allow" — which is nearly unrecoverable — so the app
 * explains in its own words first, and the OS prompt can only ever fire
 * after Continue. "Not now" is equally prominent: declining must never feel
 * like breaking something (the copy promises the SMS fallback, which
 * ReminderSettings genuinely offers).
 */
export function PermissionEducation({
  permission,
  onContinue,
  onDismiss,
}: {
  permission: "notifications"; // widened when other prompts (camera) get education
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  void permission;
  return (
    <Card tone="info">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-sm)", textAlign: "center", padding: "var(--space-sm) 0" }}>
        <span style={{ color: "var(--color-primary)" }}>
          <GuideGlyph name="bell" size="lg" />
        </span>
        <strong style={{ fontSize: "var(--font-large)" }}>{t("guide.perm.notif_title")}</strong>
        <p style={{ margin: 0 }}>{t("guide.perm.notif_why")}</p>
        <p style={{ margin: 0 }}>{t("guide.perm.notif_denied")}</p>
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {t("guide.perm.notif_change_later")}
        </span>
        <ReadAloud segments={[{ audio: "perm.notifications" }]} />
        <Button fullWidth onClick={onContinue}>
          {t("common.continue")}
        </Button>
        <Button fullWidth variant="secondary" onClick={onDismiss}>
          {t("guide.perm.not_now")}
        </Button>
      </div>
    </Card>
  );
}
