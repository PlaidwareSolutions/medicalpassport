"use client";
import type { ReactNode } from "react";
import { Card } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { actionLabelKey, useProfileAccess, type ProfileAction } from "../lib/scopes";

/**
 * The one place a screen says "this is not part of your access"
 * (docs_v2/06 P6-2). Named, not generic: a caregiver is told which patient
 * and which action, because "permission denied" teaches nobody what to ask
 * for.
 *
 * Deliberately not a disabled button. A greyed control with no explanation
 * reads as a broken app, and the elders and family members this is for
 * (docs/33) retry it. The control is removed and replaced by a sentence.
 */
export function ScopeNotice({ action }: { action: ProfileAction }) {
  const { t } = useI18n();
  const { profiles, activeProfileId } = useSession();
  const name = profiles.find((p) => p.id === activeProfileId)?.displayName ?? t("scope.this_person");

  return (
    <Card tone="info" data-testid={`scope-notice-${action}`}>
      <strong>{t("scope.missing_title")}</strong>
      <span>{t("scope.missing_body", { name, action: t(actionLabelKey(action)) })}</span>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("scope.missing_hint")}</span>
    </Card>
  );
}

/**
 * Renders the action when the caller's scopes grant it, and the explanation
 * when they do not. While the scopes are still unknown the action renders —
 * see `useProfileAccess().ready`.
 */
export function ScopeGate({ action, children, quiet }: { action: ProfileAction; children: ReactNode; quiet?: boolean }) {
  const access = useProfileAccess();
  if (access.can(action)) return <>{children}</>;
  return quiet ? null : <ScopeNotice action={action} />;
}
