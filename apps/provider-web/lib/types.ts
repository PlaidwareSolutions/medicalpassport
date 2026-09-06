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
  instructionSummary: string;
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
  measurements?: unknown;
  documents?: Array<{ kind: string; createdAt?: string }>;
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
