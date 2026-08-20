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
  "screen.blood_pressure": { sourceKeys: ["guide.screen.blood_pressure"] },
  "screen.body_weight": { sourceKeys: ["guide.screen.body_weight"] },
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
  "empty.blood_pressure": { sourceKeys: ["bp.empty_title", "bp.empty_body"] },
  "empty.body_weight": { sourceKeys: ["weight.empty_title", "weight.empty_body"] },
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
  "screen.help": { sourceKeys: ["guide.screen.help"] },
  "help.intro": { sourceKeys: ["help.intro", "app.not_a_doctor"] },
  "help.emergency": { sourceKeys: ["help.emergency_title", "help.emergency_body"] },
  "faq.current_meds": { sourceKeys: ["help.q_current_meds", "help.a_current_meds"] },
  "faq.names": { sourceKeys: ["help.q_names", "help.a_names"] },
  "faq.ingredients": { sourceKeys: ["help.q_ingredients", "help.a_ingredients"] },
  "faq.why_prescribed": { sourceKeys: ["help.q_why_prescribed", "help.a_why_prescribed"] },
  "faq.common_uses": { sourceKeys: ["help.q_common_uses", "help.a_common_uses"] },
  "faq.same_ingredient": { sourceKeys: ["help.q_same_ingredient", "help.a_same_ingredient"] },
  "faq.which_doctor": { sourceKeys: ["help.q_which_doctor", "help.a_which_doctor"] },
  "faq.how_much": { sourceKeys: ["help.q_how_much", "help.a_how_much"] },
  "faq.when": { sourceKeys: ["help.q_when", "help.a_when"] },
  "faq.food": { sourceKeys: ["help.q_food", "help.a_food"] },
  "faq.how_long": { sourceKeys: ["help.q_how_long", "help.a_how_long"] },
  "faq.due_now": { sourceKeys: ["help.q_due_now", "help.a_due_now"] },
  "faq.missed": { sourceKeys: ["help.q_missed", "help.a_missed"] },
  "faq.running_out": { sourceKeys: ["help.q_running_out", "help.a_running_out"] },
  "faq.side_effects": { sourceKeys: ["help.q_side_effects", "help.a_side_effects"] },
  "faq.warning_signs": { sourceKeys: ["help.q_warning_signs", "help.a_warning_signs"] },
  "faq.interactions": { sourceKeys: ["help.q_interactions", "help.a_interactions"] },
  "faq.concerns": { sourceKeys: ["help.q_concerns", "help.a_concerns"] },
  "faq.show_doctor": { sourceKeys: ["help.q_show_doctor", "help.a_show_doctor"] },
  "faq.caregiver_access": { sourceKeys: ["help.q_caregiver_access", "help.a_caregiver_access"] },
  "tz.confirm": { sourceKeys: ["tz.confirm_title", "tz.confirm_body"] },
} as const satisfies Record<string, GuidanceAudioEntry>;

export type GuidanceAudioId = keyof typeof GUIDANCE_AUDIO_ENTRIES;
