"use client";
import Link from "next/link";
import { Button, ChoiceGrid } from "@medpass/ui-web";
import { conditions } from "../lib/clinical-profile";
import { useI18n } from "../lib/i18n";

const NONE = "__none__";

/**
 * "Why am I taking it" as a link to one of the patient's own conditions
 * (docs_v2/04 §4.1), one tap each — the sibling of DoctorPicker. Adding a
 * condition is a separate, deliberate screen, so this only offers the ones
 * already recorded plus the way there.
 */
export function ConditionPicker({ label, value, onChange }: { label: string; value: string | null; onChange: (conditionId: string | null) => void }) {
  const { t } = useI18n();
  const { items } = conditions.useList();
  const list = (items ?? []).filter((c) => c.active || c.id === value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <ChoiceGrid
        label={label}
        columns={1}
        choices={[
          { value: NONE, label: t("medlinks.condition_none") },
          ...list.map((c) => ({
            value: c.id,
            label: c.label,
            description: c.clinicalStatus ? t(`condition.status.${c.clinicalStatus}` as never) : undefined,
          })),
        ]}
        value={value ?? NONE}
        onChange={(picked) => onChange(picked === NONE ? null : picked)}
      />
      <Link href="/conditions">
        <Button variant="ghost" fullWidth>
          {t("medlinks.condition_add")}
        </Button>
      </Link>
    </div>
  );
}
