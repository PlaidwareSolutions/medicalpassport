"use client";
import { useState } from "react";
import { ORGANIZATION_KINDS, type OrganizationKind } from "@medpass/domain";
import { ChoiceGrid, TextInput } from "@medpass/ui-web";
import { organizations, type OrganizationDto } from "../lib/clinical-profile";
import { useI18n } from "../lib/i18n";

const NEW_CLINIC = "__new__";
const NONE = "__none__";

/**
 * The clinic/hospital counterpart of DoctorPicker (docs_v2/06 P1-4): the
 * patient's own organizations one tap away, a new one typed inline —
 * nobody is sent to the "Clinics & hospitals" screen mid-flow. Reports the
 * chosen organization id upward; a typed-in clinic is created only when
 * the parent form submits (`ensureOrganization`), so an abandoned form
 * leaves no orphan.
 */
export interface ClinicSelection {
  organizationId?: string;
  newClinic?: { displayName: string; kind: OrganizationKind };
}

export function ClinicPicker({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: OrganizationDto[] | undefined;
  value: ClinicSelection;
  onChange: (next: ClinicSelection) => void;
}) {
  const { t } = useI18n();
  const [typingNew, setTypingNew] = useState(false);
  const clinics = items ?? [];
  const showInputs = typingNew || !!value.newClinic;
  const kind = value.newClinic?.kind ?? "clinic";
  const name = value.newClinic?.displayName ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <ChoiceGrid
        label={label}
        columns={1}
        choices={[
          { value: NONE, label: t("clinic.none_choice") },
          ...clinics.map((c) => ({ value: c.id, label: c.displayName, description: t(`clinic.kind.${c.kind}` as never) })),
          { value: NEW_CLINIC, label: t("clinic.new_choice") },
        ]}
        value={showInputs ? NEW_CLINIC : (value.organizationId ?? NONE)}
        onChange={(picked) => {
          if (picked === NEW_CLINIC) {
            setTypingNew(true);
            onChange({ newClinic: { displayName: name, kind } });
            return;
          }
          setTypingNew(false);
          onChange(picked === NONE ? {} : { organizationId: picked });
        }}
      />
      {showInputs ? (
        <>
          <TextInput
            label={t("clinic.name_label")}
            placeholder={t("clinic.name_placeholder")}
            value={name}
            onChange={(e) => onChange({ newClinic: { displayName: e.target.value, kind } })}
          />
          <ChoiceGrid
            label={t("clinic.kind_label")}
            columns={2}
            choices={ORGANIZATION_KINDS.map((k) => ({ value: k, label: t(`clinic.kind.${k}` as never) }))}
            value={kind}
            onChange={(k) => onChange({ newClinic: { displayName: name, kind: k } })}
          />
        </>
      ) : null}
    </div>
  );
}

/** Called by the parent just before submit: resolves the selection to an organization id, creating a typed-in clinic. */
export async function ensureOrganization(selection: ClinicSelection): Promise<string | undefined> {
  if (selection.organizationId) return selection.organizationId;
  const name = selection.newClinic?.displayName.trim();
  if (!name) return undefined;
  const created = await organizations.add({ displayName: name, kind: selection.newClinic!.kind });
  return created.id;
}
