"use client";
import type { MessageKey } from "@medpass/localization";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * One medication-history entry as a sentence the patient — or the doctor
 * they shared with — can read.
 *
 * The stored `change` is an internal code (`reconciled_continue`,
 * `dose_unit_confirmed`, …). Printing it raw is a bug, not shorthand: a
 * shared summary was reading "Metformin 500 — reconciled_continue". Both
 * the medicine history (MedicationLinksCard) and the visit summary go
 * through here so the two cannot say different things about the same event.
 *
 * `statusTo` is the status a `status_changed` entry moved to; the visit
 * summary carries only that one field of the change detail, so this
 * function is deliberately written to need nothing else.
 */
export function medicationChangeSentence(t: Translate, change: string, statusTo?: string | null): string {
  switch (change) {
    case "created":
      return t("medlinks.change.created" as never);
    case "status_changed":
      return statusTo
        ? t("medlinks.change.status_changed" as never, { status: t(`meds.status.${statusTo}` as never) })
        : t("medlinks.change.updated" as never);
    case "dose_unit_confirmed":
      return t("medlinks.change.dose_unit_confirmed" as never);
    case "refilled":
      return t("medlinks.change.refilled" as never);
    case "deleted":
      return t("medlinks.change.deleted" as never);
    case "reconciled_continue":
      return t("medlinks.change.reconciled_continue" as never);
    case "reconciled_stop":
      return t("medlinks.change.reconciled_stop" as never);
    default:
      return t("medlinks.change.updated" as never);
  }
}
