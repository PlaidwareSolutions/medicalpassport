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

/**
 * V2 Phase 4 diagnostics enums (docs_v2/04 §6.2/§6.3); mirror the Prisma
 * enums `DiagnosticReportKind`, `DiagnosticReportStatus`, `ImagingModality`
 * and `ObservationInterpretation`. The analyte *vocabulary* itself stays in
 * report-analytes.ts and is extended by @medpass/terminology — only the
 * closed shape enums live here.
 */
export const DIAGNOSTIC_REPORT_KINDS = [
  "laboratory",
  "imaging",
  "ecg",
  "echo",
  "pathology",
  "microbiology",
  "genetics",
  "other",
] as const;
export type DiagnosticReportKind = (typeof DIAGNOSTIC_REPORT_KINDS)[number];

export const DIAGNOSTIC_REPORT_STATUSES = ["registered", "partial", "final", "amended", "cancelled"] as const;
export type DiagnosticReportStatus = (typeof DIAGNOSTIC_REPORT_STATUSES)[number];

export const IMAGING_MODALITIES = ["xray", "ct", "mri", "ultrasound", "mammography", "pet", "nuclear", "other"] as const;
export type ImagingModality = (typeof IMAGING_MODALITIES)[number];

/**
 * A clinical judgement, never computed by this app (hazard H-25). Only a
 * provider-sourced write may carry one — see
 * `ERROR_CODES.INTERPRETATION_NOT_CLIENT_SETTABLE`.
 */
export const OBSERVATION_INTERPRETATIONS = ["normal", "high", "low", "critical_high", "critical_low", "abnormal"] as const;
export type ObservationInterpretation = (typeof OBSERVATION_INTERPRETATIONS)[number];

/** Censoring comparators as printed by labs ("<5", ">1000"); display-only, never compared. */
export const RESULT_COMPARATORS = ["<", ">", "<=", ">="] as const;
export type ResultComparator = (typeof RESULT_COMPARATORS)[number];

/**
 * V2 Phase 5 observation enums (docs_v2/04 §5.2, ADR-V2-011); mirror the
 * Prisma enums `ObservationConcept`, `ObservationContext`,
 * `MeasurementDeviceKind` and `MeasurementDevicePlatform`. The per-concept
 * unit table and plausibility ranges live in @medpass/terminology, not here.
 */
export const OBSERVATION_CONCEPTS = [
  "blood_pressure",
  "heart_rate",
  "blood_glucose",
  "body_weight",
  "body_height",
  "bmi",
  "spo2",
  "body_temperature",
  "respiratory_rate",
  "inr",
  "peak_flow",
  "pain_score",
  "insulin_dose",
  "fluid_intake",
  "fluid_output",
  "waist_circumference",
  "steps",
  "sleep_hours",
  "other",
] as const;
export type ObservationConcept = (typeof OBSERVATION_CONCEPTS)[number];

export const OBSERVATION_CONTEXTS = [
  "before_breakfast",
  "after_breakfast",
  "before_lunch",
  "after_lunch",
  "before_dinner",
  "after_dinner",
  "during_night",
  "random",
  "fasting",
  "resting",
  "post_exercise",
  "sitting",
  "standing",
  "lying",
  "morning",
  "evening",
] as const;
export type ObservationContext = (typeof OBSERVATION_CONTEXTS)[number];

export const MEASUREMENT_DEVICE_KINDS = [
  "bp_monitor",
  "glucometer",
  "cgm",
  "smart_scale",
  "pulse_oximeter",
  "thermometer",
  "wearable",
  "phone_health_platform",
  "other",
] as const;
export type MeasurementDeviceKind = (typeof MEASUREMENT_DEVICE_KINDS)[number];

export const MEASUREMENT_DEVICE_PLATFORMS = ["bluetooth", "apple_health", "health_connect", "vendor_api", "manual"] as const;
export type MeasurementDevicePlatform = (typeof MEASUREMENT_DEVICE_PLATFORMS)[number];

/** Trend windows and buckets (docs_v2/05 §7). */
export const TREND_WINDOWS = ["7d", "30d", "90d"] as const;
export type TrendWindow = (typeof TREND_WINDOWS)[number];

export const TREND_BUCKETS = ["day", "week", "month"] as const;
export type TrendBucket = (typeof TREND_BUCKETS)[number];

/** Days each trend window covers. */
export const TREND_WINDOW_DAYS: Readonly<Record<TrendWindow, number>> = { "7d": 7, "30d": 30, "90d": 90 };

/**
 * Every V1 glucose context is also an `ObservationContext`, so the
 * dual-write mirror carries it across verbatim rather than inventing one
 * (ADR-V2-011). Written as an explicit map so adding a V1 context without
 * an observation twin fails to compile.
 */
export const GLUCOSE_CONTEXT_TO_OBSERVATION_CONTEXT: Readonly<Record<GlucoseReadingContext, ObservationContext>> = {
  before_breakfast: "before_breakfast",
  after_breakfast: "after_breakfast",
  before_lunch: "before_lunch",
  after_lunch: "after_lunch",
  before_dinner: "before_dinner",
  after_dinner: "after_dinner",
  during_night: "during_night",
  random: "random",
};

/**
 * V1 `MedicalReport.kind` → V2 `DiagnosticReportKind` for the dual-write
 * mirror (docs_v2/04 §6.2). `blood_test`/`urine_test` are both laboratory —
 * the specimen lives on the result's `specimenType`, not on the report kind;
 * `discharge_summary` is not a diagnostic at all and lands on `other`.
 */
export const MEDICAL_REPORT_KIND_TO_DIAGNOSTIC_KIND: Readonly<Record<MedicalReportKind, DiagnosticReportKind>> = {
  blood_test: "laboratory",
  urine_test: "laboratory",
  imaging: "imaging",
  ecg: "ecg",
  pathology: "pathology",
  discharge_summary: "other",
  other: "other",
};
