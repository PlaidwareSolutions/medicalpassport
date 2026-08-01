"use client";
import type { MedicationInstructionDto } from "@medpass/api-client";
import {
  formatDoseAmount,
  hasFixedDailySlots,
  perSlotDoses,
  planDoseGlyphs,
  proposeSlots,
  slotsAreUniform,
  type SlotDoseAmount,
} from "@medpass/medication-terminology";
import type { FrequencyCode } from "@medpass/domain";
import { MedicineGlyph, glyphForDoseUnit } from "./MedicineGlyph";
import { useI18n } from "../lib/i18n";

/**
 * "How much, and when" as a picture — for the patient who can't read the
 * instruction line (docs/01 persona P3; docs/33's unbuilt "1-0-1 grid shown
 * visually: sun/plate/moon icons + text").
 *
 * Every glyph is paired with its own visible text, so nothing here is
 * icon-only (docs/33) and the accessible name falls out of the visible
 * content rather than a hand-maintained aria-label that would silently rot.
 *
 * The rules about what may be drawn live in @medpass/medication-terminology
 * where they are unit-tested; this file only lays them out.
 */

const ROW = { display: "flex", alignItems: "center", gap: "var(--space-xs)" } as const;
const MUTED_SMALL = { color: "var(--color-text-muted)", fontSize: "var(--font-small)" } as const;

/** The repeated (or single) form glyph for one amount. */
function DoseGlyphs({ amount, doseUnit }: { amount: number; doseUnit: string }) {
  const plan = planDoseGlyphs(amount, doseUnit);
  const glyph = glyphForDoseUnit(doseUnit);
  if (plan.kind === "single") {
    return <MedicineGlyph name={glyph} size="md" />;
  }
  return (
    <span style={{ display: "inline-flex", gap: "2px" }}>
      {Array.from({ length: plan.full }, (_, i) => (
        <MedicineGlyph key={i} name={glyph} size="md" />
      ))}
      {plan.half ? <MedicineGlyph name={glyph === "tablet" ? "tablet-half" : glyph} size="md" /> : null}
    </span>
  );
}

export function DoseVisual({ instruction }: { instruction: MedicationInstructionDto | null }) {
  const { t } = useI18n();
  if (!instruction) return null;

  const quantity = Number(instruction.doseQuantity);
  const unitLabel = t(`unit.${instruction.doseUnit}` as never);
  const amountText = `${formatDoseAmount(quantity)} ${unitLabel}`;

  // Only frequencies that genuinely recur every day get a time-of-day row.
  // Anything else (as-needed, weekly, monthly, unparseable) shows no row at
  // all rather than a sun that would claim a daily morning dose.
  const slots =
    hasFixedDailySlots(instruction.frequencyCode)
      ? proposeSlots(instruction.frequencyCode as FrequencyCode, instruction.pattern ?? undefined)
      : null;
  const amounts: SlotDoseAmount[] = slots ? perSlotDoses(quantity, slots) : [];
  // When the slots differ (a pattern like 2-0-1), a single headline dose would
  // misstate at least one of them — so the amount moves into each slot instead.
  const uniform = slotsAreUniform(amounts);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      {uniform ? (
        <div style={{ ...ROW, color: "var(--color-primary)" }}>
          <DoseGlyphs amount={quantity} doseUnit={instruction.doseUnit} />
          <span style={{ color: "var(--color-text)", fontWeight: 600 }}>{amountText}</span>
        </div>
      ) : null}

      {amounts.length > 0 ? (
        <ul
          // Explicit role: removing the bullets also removes list semantics in
          // Safari/VoiceOver, and the item boundaries are what stop this
          // reading as one run-on sentence (docs/33 "navigable as lists").
          role="list"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-sm)",
            listStyle: "none",
            margin: 0,
            padding: 0,
          }}
        >
          {amounts.map((a) => (
            <li key={a.slot} style={{ ...ROW, ...MUTED_SMALL }}>
              <span style={{ color: "var(--color-primary)", display: "inline-flex" }}>
                <MedicineGlyph name={a.slot} size="sm" />
              </span>
              <span>{t(`timeline.slot.${a.slot}` as never)}</span>
              {uniform ? null : (
                <span style={{ color: "var(--color-text)", fontWeight: 600 }}>
                  {formatDoseAmount(a.amount)} {unitLabel}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
