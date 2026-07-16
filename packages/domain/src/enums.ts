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
  "BD",
  "TDS",
  "QID",
  "SOS",
  "HS",
  "PATTERN",
  "ALTERNATE_DAY",
  "WEEKLY",
  "CUSTOM",
] as const;
export type FrequencyCode = (typeof FREQUENCY_CODES)[number];

export const FOOD_INSTRUCTIONS = ["before", "with", "after", "any", "bedtime"] as const;
export type FoodInstruction = (typeof FOOD_INSTRUCTIONS)[number];

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

export const SUPPORTED_LOCALES = ["en", "hi", "te", "ur"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const RTL_LOCALES: readonly Locale[] = ["ur"];

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
] as const;
export type SafetyFindingCategory = (typeof SAFETY_FINDING_CATEGORIES)[number];
