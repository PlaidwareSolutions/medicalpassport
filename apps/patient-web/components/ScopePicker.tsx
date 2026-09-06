"use client";
import { Banner, Card, SectionTitle } from "@medpass/ui-web";
import { CAREGIVER_SCOPES, type CaregiverScope } from "@medpass/domain";
import { useI18n } from "../lib/i18n";

/**
 * The permission picker shared by the invite and the edit-access screens
 * (docs_v2/06 P6-1/P6-2, docs_v2/04 §2.2 — seventeen scopes now).
 *
 * Grouped by what the person would be able to *do*, in the patient's words,
 * because that is the only question being answered here. Seeing a result
 * and adding one are separate lines on purpose: they are separate powers,
 * and a flat list of seventeen checkboxes hides that a "help me with my
 * reports" grant can also mean "write in my reports".
 */

const GROUPS: ReadonlyArray<{ id: string; scopes: readonly CaregiverScope[] }> = [
  { id: "medicines", scopes: ["view_medications", "view_schedule", "record_doses", "add_medications", "edit_medications", "manage_reminders"] },
  { id: "tests", scopes: ["view_tests", "upload_tests"] },
  { id: "measurements", scopes: ["view_measurements", "add_measurements"] },
  { id: "documents", scopes: ["view_documents", "upload_documents"] },
  { id: "safety", scopes: ["review_concerns", "share_records"] },
  { id: "profile", scopes: ["manage_profile", "full_management", "manage_caregivers"] },
];

/**
 * Scopes `full_management` already carries. `manage_caregivers` is
 * deliberately absent: it is the one power full management does not include
 * (packages/authorization), so the picker must never imply it does.
 */
const IMPLIED_BY_FULL: readonly CaregiverScope[] = CAREGIVER_SCOPES.filter(
  (s) => s !== "full_management" && s !== "manage_caregivers",
);

export type ScopeState = Record<CaregiverScope, boolean>;

export function emptyScopeState(): ScopeState {
  return Object.fromEntries(CAREGIVER_SCOPES.map((s) => [s, false])) as ScopeState;
}

export function scopeStateFrom(scopes: readonly CaregiverScope[]): ScopeState {
  return Object.fromEntries(CAREGIVER_SCOPES.map((s) => [s, scopes.includes(s)])) as ScopeState;
}

/** What is actually sent: the boxes the patient ticked, nothing inferred. */
export function selectedScopes(state: ScopeState): CaregiverScope[] {
  return CAREGIVER_SCOPES.filter((s) => state[s]);
}

export function ScopePicker({ value, onChange }: { value: ScopeState; onChange: (next: ScopeState) => void }) {
  const { t } = useI18n();
  const full = value.full_management;

  function toggle(scope: CaregiverScope, checked: boolean) {
    onChange({ ...value, [scope]: checked });
  }

  return (
    <div>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("caregiver.scopes_help")}</span>

      {value.manage_caregivers ? (
        // Said at the moment it becomes true, not buried in the list: this is
        // the one permission that changes who else can read the record.
        <div style={{ margin: "var(--space-sm) 0" }}>
          <Banner tone="warning">{t("caregiver.scope_warning.manage_caregivers")}</Banner>
        </div>
      ) : null}

      {GROUPS.map((group) => (
        <section key={group.id}>
          <SectionTitle>{t(`caregiver.scope_group.${group.id}` as never)}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {group.scopes.map((scope) => {
              const impliedOn = full && IMPLIED_BY_FULL.includes(scope);
              const note =
                scope === "full_management"
                  ? t("caregiver.scope_note.full_management")
                  : scope === "manage_caregivers"
                    ? t("caregiver.scope_note.manage_caregivers")
                    : impliedOn
                      ? t("caregiver.scope_note.included_in_full")
                      : undefined;
              return (
                <label
                  key={scope}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--space-sm)",
                    minHeight: "var(--size-touch)",
                    padding: "var(--space-sm)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    cursor: impliedOn ? "default" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid={`scope-${scope}`}
                    /* Shown ticked and locked while full management is on: the
                       person genuinely has it, so an empty box would lie. */
                    checked={impliedOn || value[scope]}
                    disabled={impliedOn}
                    onChange={(e) => toggle(scope, e.target.checked)}
                    style={{ width: 24, height: 24, flexShrink: 0, marginTop: 2 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ overflowWrap: "anywhere" }}>{t(`caregiver.scope.${scope}` as never)}</span>
                    {note ? (
                      <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{note}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}

      {selectedScopes(value).length === 0 ? (
        <Card tone="info">
          <span>{t("caregiver.scopes_required_error")}</span>
        </Card>
      ) : null}
    </div>
  );
}
