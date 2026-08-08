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
  "screen.home": { sourceKeys: ["guide.screen.home"] },
  "screen.medicines": { sourceKeys: ["guide.screen.medicines"] },
  "screen.medicine_detail": { sourceKeys: ["guide.screen.medicine_detail"] },
  "screen.timeline": { sourceKeys: ["guide.screen.timeline"] },
  "screen.add": { sourceKeys: ["guide.screen.add"] },
  "screen.scan": { sourceKeys: ["guide.screen.scan"] },
  "screen.confirm_type": { sourceKeys: ["guide.screen.confirm_type"] },
  "screen.safety": { sourceKeys: ["guide.screen.safety"] },
  "screen.allergies": { sourceKeys: ["guide.screen.allergies"] },
  "screen.blood_sugar": { sourceKeys: ["guide.screen.blood_sugar"] },
  "screen.prescriptions": { sourceKeys: ["guide.screen.prescriptions"] },
  "screen.reports": { sourceKeys: ["guide.screen.reports"] },
  "screen.report_values": { sourceKeys: ["guide.screen.report_values"] },
  "screen.share": { sourceKeys: ["guide.screen.share"] },
  "screen.visit": { sourceKeys: ["guide.screen.visit"] },
  "screen.profile": { sourceKeys: ["guide.screen.profile"] },
  "screen.caregivers": { sourceKeys: ["guide.screen.caregivers"] },
  "screen.caregiver_invitations": { sourceKeys: ["guide.screen.caregiver_invitations"] },
  "screen.claim_invitations": { sourceKeys: ["guide.screen.claim_invitations"] },
  "screen.sync_conflicts": { sourceKeys: ["guide.screen.sync_conflicts"] },
  "screen.offline": { sourceKeys: ["guide.screen.offline"] },
} as const satisfies Record<string, GuidanceAudioEntry>;

export type GuidanceAudioId = keyof typeof GUIDANCE_AUDIO_ENTRIES;
