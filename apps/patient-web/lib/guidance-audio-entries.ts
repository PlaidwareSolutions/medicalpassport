import type { MessageKey } from "@medpass/localization";

/**
 * Source of truth for pre-generated guidance audio (docs/32 TTS fallback,
 * docs/33 low-literacy support). Each entry is one spoken track: its
 * `sourceKeys` texts are joined in order and synthesized once per locale by
 * `scripts/generate-guidance-audio.mts`, because Safari (and some Android
 * browsers) ship no Telugu or Urdu voices — the two locales whose users
 * (docs/01 P1 Lakshmi, P3 Fatima) depend on read-aloud the most.
 *
 * Rules:
 * - Only static copy: a key whose text carries a `{param}` placeholder is
 *   ineligible (the generator and `guidance-audio.test.ts` both enforce it).
 *   Dynamic content (medicine names, dose summaries) goes through browser
 *   TTS as a `{ text: … }` segment instead.
 * - Until audio is generated for an entry, `lib/read-aloud.ts` falls back to
 *   browser TTS of the same joined text — adding an entry here is never a
 *   regression, only not yet an improvement.
 */
export interface GuidanceAudioEntry {
  /** Dictionary keys whose texts are joined (in order) into one spoken track. */
  readonly sourceKeys: readonly MessageKey[];
}

export const GUIDANCE_AUDIO_ENTRIES = {
  "screen.medicine_detail": { sourceKeys: ["guide.screen.medicine_detail"] },
} as const satisfies Record<string, GuidanceAudioEntry>;

export type GuidanceAudioId = keyof typeof GUIDANCE_AUDIO_ENTRIES;
