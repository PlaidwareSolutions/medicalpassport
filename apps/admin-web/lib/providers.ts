"use client";
import { useAdminSession } from "./session";

/** Shared shapes for the provider-directory pages (mirror of admin-organizations.controller.ts). */
export type DirectoryScope = "global" | "patient" | "all";

export const ORGANIZATION_KINDS = ["clinic", "hospital", "laboratory", "pharmacy", "diagnostic_centre", "other"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const KIND_LABELS: Record<OrganizationKind, string> = {
  clinic: "Clinic",
  hospital: "Hospital",
  laboratory: "Laboratory",
  pharmacy: "Pharmacy",
  diagnostic_centre: "Diagnostic centre",
  other: "Other",
};

export interface GlobalOrganization {
  id: string;
  patientScoped: false;
  kind: OrganizationKind;
  displayName: string;
  addressText: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  hfrId: string | null;
  verification: string;
  mergedIntoId: string | null;
  practitionerCount: number;
  encounterCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A patient-entered facility: opaque id + counts only, never the name. */
export interface PatientScopedOrganization {
  id: string;
  patientScoped: true;
  kind: OrganizationKind;
  hfrId: string | null;
  verification: string;
  practitionerCount: number;
  encounterCount: number;
  createdAt: string;
}

export type OrganizationRow = GlobalOrganization | PatientScopedOrganization;

export interface GlobalPractitioner {
  id: string;
  patientScoped: false;
  displayName: string;
  speciality: string | null;
  registrationNumber: string | null;
  registrationCouncil: string | null;
  hprId: string | null;
  organizationId: string | null;
  verification: string;
  medicationCount: number;
  prescriptionCount: number;
  reportCount: number;
  encounterCount: number;
  createdAt: string;
}

export interface PatientScopedPractitioner {
  id: string;
  patientScoped: true;
  hprId: string | null;
  verification: string;
  medicationCount: number;
  prescriptionCount: number;
  reportCount: number;
  encounterCount: number;
  createdAt: string;
}

export type PractitionerRow = GlobalPractitioner | PatientScopedPractitioner;

export interface DirectoryPage<T> {
  items: T[];
  nextCursor: string | null;
  totals: { global: number; patient: number };
}

/** True when the signed-in admin holds provider_admin (or super_admin, which implies every duty). */
export function useCanManageProviders(): boolean {
  const { admin } = useAdminSession();
  const duties = admin?.duties ?? [];
  return duties.includes("provider_admin") || duties.includes("super_admin");
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function verificationTone(v: string): "default" | "success" | "warning" {
  if (v === "provider_verified" || v === "source_authenticated") return "success";
  if (v === "patient_confirmed") return "warning";
  return "default";
}
