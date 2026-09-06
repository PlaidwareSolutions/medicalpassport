/**
 * Shared domain enums. Mirrors the Prisma enums in @medpass/database so
 * clients (web today, native later) never import the ORM.
 */

export const MEDICATION_STATUSES = [
  "current",
  "paused",
  "completed",
  "stopped",
  "unknown",
] as const;
export type MedicationStatus = (typeof MEDICATION_STATUSES)[number];

/** Allowed medication status transitions; anything else is rejected. */
export const MEDICATION_STATUS_TRANSITIONS: Record<MedicationStatus, MedicationStatus[]> = {
  current: ["paused", "completed", "stopped"],
  paused: ["current", "stopped", "completed"],
  completed: ["current"],
  stopped: ["current"],
  unknown: ["current", "paused", "completed", "stopped"],
};

export const FREQUENCY_CODES = [
  "OD",
  "OD_AFTERNOON",
  "BD",
  "TDS",
  "QID",
  "SOS",
  "HS",
  "PATTERN",
  "ALTERNATE_DAY",
  "WEEKLY",
  "FORTNIGHTLY",
  "MONTHLY",
  "CUSTOM",
] as const;
export type FrequencyCode = (typeof FREQUENCY_CODES)[number];

/**
 * Frequency codes that can be auto-scheduled without extra patient setup
 * (docs/09 §6) — single source of truth shared by SchedulingService (which
 * derives the schedule) and the schedule-conflict safety rule (which flags
 * a missing one), so the two can never drift apart.
 */
export const AUTO_SCHEDULABLE_FREQUENCY_CODES: readonly FrequencyCode[] = [
  "OD",
  "OD_AFTERNOON",
  "BD",
  "TDS",
  "HS",
  "PATTERN",
  "WEEKLY",
  "FORTNIGHTLY",
  "MONTHLY",
];

export const FOOD_INSTRUCTIONS = ["before", "with", "after", "any", "bedtime"] as const;
export type FoodInstruction = (typeof FOOD_INSTRUCTIONS)[number];

export const DOSE_UNITS = ["tablet", "capsule", "ml", "drop", "puff", "sachet", "unit", "application"] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];

/** Blood Sugar Monitoring Diary (docs/07 screen 42) — time-of-day context for a glucose reading. */
export const GLUCOSE_READING_CONTEXTS = [
  "before_breakfast",
  "after_breakfast",
  "before_lunch",
  "after_lunch",
  "before_dinner",
  "after_dinner",
  "during_night",
  "random",
] as const;
export type GlucoseReadingContext = (typeof GLUCOSE_READING_CONTEXTS)[number];

/** Test reports the patient keeps a copy of (docs/07 screen 44). */
export const MEDICAL_REPORT_KINDS = [
  "blood_test",
  "urine_test",
  "imaging",
  "ecg",
  "pathology",
  "discharge_summary",
  "other",
] as const;
export type MedicalReportKind = (typeof MEDICAL_REPORT_KINDS)[number];

/** V2 Phase 1 (docs_v2/04 §3.3) — one visit/admission that ties records together. */
export const ENCOUNTER_KINDS = ["outpatient", "inpatient", "emergency", "teleconsult", "pharmacy", "lab_visit", "home"] as const;
export type EncounterKind = (typeof ENCOUNTER_KINDS)[number];

/** Timeline projection kinds (docs_v2/04 §9.1, ADR-V2-008) — mirrors the `HealthEventKind` Prisma enum. */
export const HEALTH_EVENT_KINDS = [
  "prescription",
  "medicine_started",
  "medicine_changed",
  "medicine_stopped",
  "medicine_paused",
  "medicine_resumed",
  "medicine_completed",
  "dose_taken",
  "dose_missed",
  "adherence_summary",
  "test_result",
  "imaging_report",
  "measurement",
  "doctor_visit",
  "hospital_admission",
  "discharge",
  "document",
  "clinical_note",
  "allergy_recorded",
  "condition_recorded",
  "immunization",
  "procedure",
  "dispense",
  "reconciliation",
  "abdm_record_linked",
  "share_created",
  "caregiver_action",
  "profile_updated",
] as const;
export type HealthEventKind = (typeof HEALTH_EVENT_KINDS)[number];

/** docs/13, docs/07 screen 19 — each a separate labeled block, approved-only, never fabricated. */
export const CLINICAL_CONTENT_KINDS = ["education", "storage", "warning_symptoms", "food_alcohol", "missed_dose"] as const;
export type ClinicalContentKind = (typeof CLINICAL_CONTENT_KINDS)[number];

export const CAREGIVER_SCOPES = [
  "view_medications",
  "view_schedule",
  "manage_reminders",
  "record_doses",
  "add_medications",
  "edit_medications",
  "review_concerns",
  "share_records",
  "manage_profile",
  "full_management",
  // V2 Phase 6 (docs_v2/04 §2.2) — mirrors the Prisma enum extension
  "view_tests",
  "upload_tests",
  "view_measurements",
  "add_measurements",
  "view_documents",
  "upload_documents",
  "manage_caregivers",
] as const;
export type CaregiverScope = (typeof CAREGIVER_SCOPES)[number];

export const CONSENT_TYPES = [
  "data_processing",
  "sms_reminders",
  "whatsapp_reminders",
  "email",
  "caregiver_access",
  "sharing",
  "ai_processing",
  "emergency_card",
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const MEDICATION_SOURCES = ["search", "manual", "extraction", "previous", "import"] as const;
export type MedicationSource = (typeof MEDICATION_SOURCES)[number];

export const DOSE_STATUSES = [
  "upcoming",
  "taken",
  "skipped",
  "missed",
  "snoozed",
  "could_not_take",
  "unavailable",
  "problem",
  "taken_other_time",
  "cancelled",
] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

export const DOSE_ACTIONS = [
  "taken",
  "skipped",
  "snoozed",
  "could_not_take",
  "unavailable",
  "problem",
  "taken_other_time",
  "cancelled",
] as const;
export type DoseAction = (typeof DOSE_ACTIONS)[number];

export const TIMELINE_SLOTS = ["morning", "midday", "night"] as const;
export type TimelineSlot = (typeof TIMELINE_SLOTS)[number];

export const SUPPORTED_LOCALES = ["en", "hi", "te", "ur"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const RTL_LOCALES: readonly Locale[] = ["ur"];

/** Never expose the medicine name by default (docs/16) — patient opts in. */
export const NOTIFICATION_PRIVACY_MODES = ["generic", "full_name"] as const;
export type NotificationPrivacyMode = (typeof NOTIFICATION_PRIVACY_MODES)[number];

export const SAFETY_FINDING_CATEGORIES = [
  "exact_ingredient_duplication",
  "partial_ingredient_duplication",
  "therapeutic_class_duplication",
  "drug_drug_interaction",
  "drug_allergy",
  "drug_condition",
  "food",
  "alcohol",
  "schedule_conflict",
  "dose_differs_from_prescription",
  "missing_information",
  "uncertain_normalization",
  // Phase 2 (docs_v2/10 §3, docs_v2/06 P2-3): additive — nothing above changes.
  "multiple_active_prescriptions",
  "conflicting_instructions",
] as const;
export type SafetyFindingCategory = (typeof SAFETY_FINDING_CATEGORIES)[number];

/** V2 Phase 1 clinical-profile enums (docs_v2/04 §3.1, §10); mirror the Prisma enums. */
export const BLOOD_GROUPS = ["a_pos", "a_neg", "b_pos", "b_neg", "ab_pos", "ab_neg", "o_pos", "o_neg", "unknown"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const ORGANIZATION_KINDS = ["clinic", "hospital", "laboratory", "pharmacy", "diagnostic_centre", "other"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const ALLERGY_CATEGORIES = ["medication", "food", "environment", "biologic", "other"] as const;
export type AllergyCategory = (typeof ALLERGY_CATEGORIES)[number];

export const ALLERGY_CRITICALITIES = ["low", "high", "unable_to_assess"] as const;
export type AllergyCriticality = (typeof ALLERGY_CRITICALITIES)[number];

export const CONDITION_CLINICAL_STATUSES = ["active", "remission", "resolved", "inactive", "unknown"] as const;
export type ConditionClinicalStatus = (typeof CONDITION_CLINICAL_STATUSES)[number];
