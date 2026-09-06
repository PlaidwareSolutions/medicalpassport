import { z } from "zod";

export const SAFETY_FINDING_ACTION_TYPES = [
  "acknowledged",
  "note_added",
  "reviewed_with_professional",
  "resolved",
  // "Not relevant to me" — the Gate 3 false-positive signal (docs_v2/06 P9-4).
  "dismissed_not_relevant",
] as const;

export const recordFindingActionSchema = z.object({
  action: z.enum(SAFETY_FINDING_ACTION_TYPES),
  note: z.string().trim().max(500).optional(),
});
export type RecordFindingActionInput = z.infer<typeof recordFindingActionSchema>;
