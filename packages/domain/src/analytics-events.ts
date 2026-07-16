/**
 * Analytics event names shared across web and (later) native clients.
 * Payloads must contain opaque IDs and coarse buckets only — never PHI,
 * never free text (docs/07 shared defaults).
 */
export const ANALYTICS_EVENTS = [
  "screen_viewed",
  "welcome_get_started",
  "language_selected",
  "otp_requested",
  "otp_verified",
  "otp_failed",
  "profile_created",
  "dependent_added",
  "caregiver_invited",
  "caregiver_revoked",
  "home_section_tapped",
  "passport_viewed",
  "add_method_selected",
  "medication_search",
  "medication_saved",
  "explanation_depth_used",
  "read_aloud_used",
  "dose_recorded",
  "sync_status_viewed",
  "a2hs_shown",
  "a2hs_accepted",
  "a2hs_dismissed",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
