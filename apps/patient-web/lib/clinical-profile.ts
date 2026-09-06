"use client";
import type { AllergyCategory, AllergyCriticality, BloodGroup, ConditionClinicalStatus, OrganizationKind } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { invalidateHealthTimeline, type ProvenanceSource, type VerificationState } from "./health-timeline";

/**
 * Clinical profile (docs_v2/05 §2, docs_v2/06 P1-4): conditions,
 * immunizations, procedures, family history, emergency contacts and the
 * patient's own clinics. Every row carries server-stamped provenance
 * (`provenanceSource`, `verification`) which clients read but never send
 * (ADR-V2-002) — the input types below deliberately omit them.
 *
 * One generic resource factory keeps the six lists identical in behaviour:
 * list under `profiles/current/<collection>`, mutate under `/<collection>/:id`,
 * invalidate the list and the timeline projection on every write.
 */

export interface Provenanced {
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
}

export interface ConditionDto extends Provenanced {
  id: string;
  label: string;
  note: string | null;
  active: boolean;
  clinicalStatus: ConditionClinicalStatus | null;
  onsetDate: string | null;
  abatementDate: string | null;
  severity: string | null;
  createdAt: string;
}
export interface ConditionInput {
  label: string;
  note?: string | null;
  clinicalStatus?: ConditionClinicalStatus | null;
  onsetDate?: string | null;
  abatementDate?: string | null;
}

export interface ImmunizationDto extends Provenanced {
  id: string;
  vaccineText: string;
  doseNumber: number | null;
  administeredOn: string;
  notes: string | null;
  createdAt: string;
}
export interface ImmunizationInput {
  vaccineText: string;
  doseNumber?: number | null;
  administeredOn: string;
  notes?: string | null;
}

export interface ProcedureDto extends Provenanced {
  id: string;
  procedureText: string;
  performedOn: string;
  notes: string | null;
  createdAt: string;
}
export interface ProcedureInput {
  procedureText: string;
  performedOn: string;
  notes?: string | null;
}

export interface FamilyHistoryDto extends Provenanced {
  id: string;
  relationship: string;
  conditionText: string;
  notes: string | null;
  createdAt: string;
}
export interface FamilyHistoryInput {
  relationship: string;
  conditionText: string;
  notes?: string | null;
}

export interface EmergencyContactDto {
  id: string;
  name: string;
  relationship: string | null;
  /** E.164 — decrypted for the profile's own viewers. */
  phone: string;
  priority: number;
  createdAt: string;
}
export interface EmergencyContactInput {
  name: string;
  relationship?: string | null;
  phone: string;
  priority?: number;
}

export interface OrganizationDto {
  id: string;
  kind: OrganizationKind;
  displayName: string;
  addressText: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  verification: VerificationState;
  createdAt: string;
}
export interface OrganizationInput {
  kind: OrganizationKind;
  displayName: string;
  addressText?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
}

export interface AllergyCreateInput {
  label: string;
  severity: string;
  reactionNote?: string | null;
  category?: AllergyCategory | null;
  criticality?: AllergyCriticality | null;
  onsetDate?: string | null;
}

interface ResourceApi<Dto, Input> {
  useList: () => { items: Dto[] | undefined; error: string | undefined; reload: () => Promise<void> };
  add: (input: Input) => Promise<Dto>;
  update: (id: string, patch: Partial<Input>) => Promise<Dto>;
  remove: (id: string) => Promise<void>;
}

function resource<Dto, Input>(collection: string, extraInvalidate: string[] = []): ResourceApi<Dto, Input> {
  const listPath = `/profiles/current/${collection}`;
  const bust = () => {
    invalidate("profile", listPath);
    for (const p of extraInvalidate) invalidate("profile", p);
    invalidateHealthTimeline();
  };
  return {
    useList() {
      // A hook returned from a factory: called unconditionally by each screen, so the rules of hooks hold.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { data, error, reload } = useSharedResource<Dto[]>({
        path: listPath,
        fetcher: async () => (await api.get<{ items: Dto[] }>(listPath, { profileId: getActiveProfileId() })).items,
      });
      return { items: data, error, reload };
    },
    async add(input) {
      const res = await api.post<Dto>(listPath, input, { profileId: getActiveProfileId() });
      bust();
      return res;
    },
    async update(id, patch) {
      const res = await api.patch<Dto>(`/${collection}/${id}`, patch, { profileId: getActiveProfileId() });
      bust();
      return res;
    },
    async remove(id) {
      await api.delete(`/${collection}/${id}`, { profileId: getActiveProfileId() });
      bust();
    },
  };
}

export const conditions = resource<ConditionDto, ConditionInput>("conditions", ["/profiles/current/safety/findings"]);
export const immunizations = resource<ImmunizationDto, ImmunizationInput>("immunizations");
export const procedures = resource<ProcedureDto, ProcedureInput>("procedures");
export const familyHistory = resource<FamilyHistoryDto, FamilyHistoryInput>("family-history");
export const emergencyContacts = resource<EmergencyContactDto, EmergencyContactInput>("emergency-contacts");
export const organizations = resource<OrganizationDto, OrganizationInput>("organizations", ["/profiles/current/encounters"]);

// --- profile health details (blood group, height) -----------------------

export interface ProfileDetailsDto {
  id: string;
  displayName: string;
  yearOfBirth: number | null;
  sex: string | null;
  preferredLocale: string;
  timezone: string;
  rowVersion: number;
  bloodGroup?: BloodGroup | null;
  /** Decimal serialised as string by Prisma, number by hand-written DTOs — accept both. */
  heightCm?: number | string | null;
}

const PROFILE_PATH = "/profiles/current";

export function useProfileDetails() {
  const { data, error, reload } = useSharedResource<ProfileDetailsDto>({
    path: PROFILE_PATH,
    fetcher: () => api.get<ProfileDetailsDto>(PROFILE_PATH, { profileId: getActiveProfileId() }),
  });
  return { profile: data, error, reload };
}

export async function updateHealthDetails(rowVersion: number, patch: { bloodGroup?: BloodGroup | null; heightCm?: number | null }) {
  const res = await api.patch<{ id: string; rowVersion: number }>(PROFILE_PATH, { rowVersion, ...patch }, { profileId: getActiveProfileId() });
  invalidate("profile", PROFILE_PATH);
  invalidateHealthTimeline();
  return res;
}

export function heightAsNumber(h: ProfileDetailsDto["heightCm"]): number | undefined {
  if (h === null || h === undefined || h === "") return undefined;
  const n = typeof h === "number" ? h : Number(h);
  return Number.isFinite(n) ? n : undefined;
}
