"use client";
import { useState } from "react";
import { Button, Card, TextInput } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import type { PrescriptionItemInput } from "../lib/prescriptions";
import { draftToItemFields, InstructionPickers, type InstructionDraft } from "./InstructionPickers";

/**
 * One prescription line as the patient reads it off the paper (docs_v2/04
 * §4.1 PrescriptionItem): only the name is required — the dose pickers are
 * optional and each can honestly say "not written". Typing is limited to
 * the name and the strength as printed; everything else is a tap.
 */
export interface LineDraft {
  key: string;
  enteredName: string;
  strengthLabel: string;
  durationDays: string;
  instructionsText: string;
  instruction: InstructionDraft;
}

let counter = 0;
export function emptyLine(): LineDraft {
  counter += 1;
  return { key: `line-${counter}`, enteredName: "", strengthLabel: "", durationDays: "", instructionsText: "", instruction: {} };
}

export function lineToInput(line: LineDraft, sequence: number): PrescriptionItemInput {
  return {
    enteredName: line.enteredName.trim(),
    sequence,
    strengthLabel: line.strengthLabel.trim() || null,
    durationDays: line.durationDays.trim() ? Number(line.durationDays) : null,
    instructionsText: line.instructionsText.trim() || null,
    ...draftToItemFields(line.instruction),
  };
}

export function PrescriptionLineRow({
  line,
  index,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  index: number;
  onChange: (next: LineDraft) => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  return (
    <Card data-testid="prescription-line">
      <strong>{t("rx.line_n", { n: index + 1 })}</strong>
      <TextInput
        label={t("rx.line_name_label")}
        placeholder={t("rx.line_name_placeholder")}
        value={line.enteredName}
        onChange={(e) => onChange({ ...line, enteredName: e.target.value })}
      />
      <TextInput
        label={t("rx.line_strength_label")}
        placeholder={t("rx.line_strength_placeholder")}
        value={line.strengthLabel}
        onChange={(e) => onChange({ ...line, strengthLabel: e.target.value })}
      />
      {showDetails ? (
        <>
          <InstructionPickers optional value={line.instruction} onChange={(instruction) => onChange({ ...line, instruction })} />
          <TextInput
            label={t("add.duration_label")}
            type="number"
            inputMode="numeric"
            min="1"
            value={line.durationDays}
            onChange={(e) => onChange({ ...line, durationDays: e.target.value })}
          />
          <TextInput
            label={t("rx.line_instructions_label")}
            placeholder={t("rx.line_instructions_placeholder")}
            value={line.instructionsText}
            onChange={(e) => onChange({ ...line, instructionsText: e.target.value })}
          />
        </>
      ) : (
        <Button variant="secondary" fullWidth onClick={() => setShowDetails(true)}>
          {t("rx.line_add_details")}
        </Button>
      )}
      {onRemove ? (
        <Button variant="ghost" fullWidth onClick={onRemove}>
          {t("rx.line_remove")}
        </Button>
      ) : null}
    </Card>
  );
}
