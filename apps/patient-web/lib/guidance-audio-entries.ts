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
  "empty.home": { sourceKeys: ["home.empty_title", "home.empty_body"] },
  "empty.meds": { sourceKeys: ["meds.empty_title", "meds.empty_body"] },
  "empty.timeline": { sourceKeys: ["timeline.empty_title", "timeline.empty_body"] },
  "empty.safety": { sourceKeys: ["safety.empty_title", "safety.empty_body"] },
  "empty.allergies": { sourceKeys: ["allergy.empty_title", "allergy.empty_body"] },
  "empty.prescriptions": { sourceKeys: ["prescriptions.empty_title", "prescriptions.empty_body"] },
  "empty.reports": { sourceKeys: ["reports.empty_title", "reports.empty_body"] },
  "empty.report_history": { sourceKeys: ["reports.history_empty_title", "reports.history_empty_body"] },
  "empty.report_values": { sourceKeys: ["reports.values_empty_title", "reports.values_empty_body"] },
  "empty.share": { sourceKeys: ["share.empty_title", "share.empty_body"] },
  "empty.caregivers": { sourceKeys: ["caregiver.list_empty_title", "caregiver.list_empty_body"] },
  "empty.caregiver_invitations": { sourceKeys: ["caregiver.invitations_empty_title", "caregiver.invitations_empty_body"] },
  "empty.claim_invitations": { sourceKeys: ["caregiver.claim_invitations_empty_title", "caregiver.claim_invitations_empty_body"] },
  "empty.bloodsugar_readings": { sourceKeys: ["bloodsugar.readings_empty_title", "bloodsugar.readings_empty_body"] },
  "empty.bloodsugar_checkups": { sourceKeys: ["bloodsugar.checkups_empty_title", "bloodsugar.checkups_empty_body"] },
  "empty.sync_conflicts": { sourceKeys: ["sync.conflicts_empty_title", "sync.conflicts_empty_body"] },
  "perm.notifications": {
    sourceKeys: ["guide.perm.notif_title", "guide.perm.notif_why", "guide.perm.notif_denied", "guide.perm.notif_change_later"],
  },
  "install.education": { sourceKeys: ["guide.install.title", "guide.install.body"] },
  "install.ios_steps": {
    sourceKeys: ["guide.install.ios_title", "guide.install.ios_step1", "guide.install.ios_step2", "guide.install.ios_step3"],
  },
  "tour.1": { sourceKeys: ["tour.card1_title", "tour.card1_body"] },
  "tour.2": { sourceKeys: ["tour.card2_title", "tour.card2_body"] },
  "tour.3": { sourceKeys: ["tour.card3_title", "tour.card3_body"] },
} as const satisfies Record<string, GuidanceAudioEntry>;

export type GuidanceAudioId = keyof typeof GUIDANCE_AUDIO_ENTRIES;
