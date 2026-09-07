/**
 * Response shapes of the provider surface (apps/api/openapi.json `provider/*`;
 * the JSON bodies are typed here by hand until codegen replaces them).
 * Everything is either an opaque id or a label the patient chose to share.
 */
import type { OrganizationKind, ProposalKind, ProposalStatus } from "./proposal-kinds";

export type MemberRole = "owner" | "doctor" | "staff" | "pharmacist" | "lab_tech";

export interface SessionOrganization {
  id: string;
  displayName: string;
  kind: OrganizationKind;
  role: MemberRole;
}

/** GET provider/auth/session */
export interface ProviderSessionDto {
  userId: string;
  userKind: "provider" | "both";
  organizations: SessionOrganization[];
  current: { organizationId: string; role: MemberRole };
}

/** POST provider/auth/totp */
export interface ProviderTotpDto {
  token: string;
  expiresAt: string;
  user: { id: string };
  organizations: SessionOrganization[];
}

/** GET provider/organizations/current */
export interface OrganizationDto {
  id: string;
  kind: OrganizationKind;
  displayName: string;
  addressText: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  hfrId: string | null;
  verification: string;
  role: MemberRole;
  memberCount: number;
  /** Authoritative: which proposal kinds this organization may send. */
  allowedProposalKinds: ProposalKind[];
  createdAt: string;
  updatedAt: string;
}

export interface MemberDto {
  id: string;
  userId: string;
  role: MemberRole;
  status: "active" | "suspended";
  phone: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export const LINK_SECTIONS = [
  "medications",
  "allergies",
  "conditions",
  "recentChanges",
  "concerns",
  "glucoseReadings",
  "bloodPressureReadings",
  "weightReadings",
  "checkups",
  "prescriptions",
  "reports",
  "measurements",
  "documents",
  "encounters",
] as const;
export type LinkSection = (typeof LINK_SECTIONS)[number];

/** GET provider/patients — labels only, no clinical data. */
export interface PatientLinkDto {
  linkId: string;
  patient?: { displayName: string; yearOfBirth: number | null; sex: string | null };
  sections: LinkSection[];
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface SnapshotMedication {
  /** Present on the provider snapshot so a line can refer to the medicine; absent on the public share. */
  patientMedicationId?: string;
  name: string;
  ingredients: string[];
  strengthLabel: string | null;
  /** The raw shorthand the shared payload carries ("1 tablet · BD · after") — a fallback for `instruction`. */
  instructionSummary: string;
  /**
   * The codes behind that summary, present on the provider snapshot only, so
   * a CONTINUE line reads with the same labels as the START line next to it
   * instead of raw shorthand. Unvalidated here; `parseInstruction` decides.
   */
  instruction?: unknown;
  prescriberName: string | null;
  startDate: string | null;
}

/** GET provider/patients/:linkId/snapshot — only the sections the patient granted are present. */
export interface SnapshotDto {
  linkId: string;
  sections: LinkSection[];
  profile: { displayName: string; yearOfBirth: number | null; sex: string | null; timezone: string };
  generatedAt: string;
  currentMedications?: SnapshotMedication[];
  allergies?: Array<{ label: string; severity: string; reactionNote: string | null }>;
  majorConditions?: Array<{ label: string; clinicalStatus: string | null; onsetDate: string | null; note: string | null }>;
  recentChanges?: Array<{ kind: string; occurredAt: string; summary: unknown }>;
  latestResults?: Array<{
    analyteKey: string;
    label: string;
    value: string;
    unit: string | null;
    comparator: string | null;
    referenceText: string | null;
    interpretation: string | null;
    at: string;
    reportTitle: string;
  }>;
  /**
   * Home measurements and diary sections — present only when the link grants
   * them. Values exactly as the patient recorded them, with arithmetic
   * aggregates; the portal never adds a high/low judgement of its own (H-25).
   */
  measurements?: SnapshotMeasurement[];
  glucoseReadings?: {
    readingCount: number;
    averageMgDl: number | null;
    lowestMgDl: number | null;
    highestMgDl: number | null;
    byContext: Array<{ context: string; count: number; averageMgDl: number }>;
    recent: Array<{ valueMgDl: number; context: string; measuredAt: string; note: string | null }>;
  };
  bloodPressureReadings?: {
    readingCount: number;
    averageSystolic: number | null;
    averageDiastolic: number | null;
    recent: Array<{ systolic: number; diastolic: number; pulseBpm: number | null; measuredAt: string; note: string | null }>;
  };
  weightReadings?: {
    readingCount: number;
    latestKg: string | null;
    changeKg: string | null;
    recent: Array<{ weightKg: string; measuredAt: string; note: string | null }>;
  };
  checkups?: Array<{
    checkupDate: string;
    fastingGlucoseMgDl: number | null;
    postPrandialGlucoseMgDl: number | null;
    hba1cPercent: string | null;
    bloodPressureSystolic: number | null;
    bloodPressureDiastolic: number | null;
    weightKg: string | null;
    nextAppointmentDate: string | null;
  }>;
  prescriptions?: Array<{ prescribedAt: string | null; practitionerName: string | null; notes: string | null; medicationCount: number }>;
  unresolvedConcerns?: Array<{ category: string; severity: string; summary: string }>;
  encounters?: Array<{
    kind: string;
    startedAt: string;
    endedAt: string | null;
    organizationName: string | null;
    practitionerName: string | null;
    reasonText: string | null;
    diagnosisText: string | null;
  }>;
  documents?: Array<{ kind: string; createdAt?: string }>;
}

export interface SnapshotMeasurement {
  concept: string;
  label: string;
  unit: string;
  count: number;
  latest: { value: string; value2: string | null; measuredAt: string; context: string | null } | null;
  minimum: string | null;
  maximum: string | null;
  average: string | null;
  average2: string | null;
}

export interface ProposalDto {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  linkId: string;
  organization: { id: string; displayName: string; kind: OrganizationKind };
  payload: Record<string, unknown>;
  proposedAt: string;
  decidedAt: string | null;
  /** Indexes into `payload.lines` the patient declined while accepting the rest (H-43). */
  declinedLines?: number[];
  /** The patient's own words when they declined the whole proposal. */
  decisionReason?: string | null;
  resultingEntityType: string | null;
  resultingEntityId: string | null;
  updatedAt: string;
}

export interface AnalyteDto {
  key: string;
  display: string;
  group: string;
  loincCode: string | null;
  loincDisplay: string | null;
  canonicalUnit: string | null;
  canonicalUnitDisplay: string | null;
  allowedEnteredUnits: Array<{ unit: string; display: string; isCanonical: boolean }>;
  openEntry: boolean;
}

export interface AnalytesDto {
  system: string;
  items: AnalyteDto[];
}
