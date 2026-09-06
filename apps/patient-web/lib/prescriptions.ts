"use client";
import type { PrescriptionDocumentDto, PrescriptionDto } from "@medpass/api-client";
import type { DoseUnit, FoodInstruction, FrequencyCode } from "@medpass/domain";
import { api, getActiveProfileId, newIdempotencyKey } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { invalidateHealthTimeline, type ProvenanceSource, type VerificationState } from "./health-timeline";
import { invalidateMedicationData } from "./medications";

/**
 * Prescriptions (docs/07 screen 43, docs_v2/04 §4.1, docs_v2/06 P2-5): the
 * record of what each doctor wrote, line by line. A `PrescriptionItem` is a
 * line *as written on the paper* — separate from the patient's own medicine
 * list. A line can be prescribed and never started (a normal outcome, not a
 * gap), and "Start this medicine" is what turns one into a medicine, through
 * the same server path a hand-added medicine takes.
 */

export interface PrescriptionItemDto {
  id: string;
  sequence: number;
  enteredName: string;
  productId: string | null;
  strengthLabel: string | null;
  formText: string | null;
  routeText: string | null;
  /** Decimal serialised as a string; null when the paper didn't say. */
  doseQuantity: string | null;
  doseUnit: DoseUnit | null;
  frequencyCode: FrequencyCode | null;
  pattern: string | null;
  foodInstruction: FoodInstruction | null;
  durationDays: number | null;
  instructionsText: string | null;
  /** Set once the line has become one of the patient's medicines. */
  startedMedicationId: string | null;
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
}

export interface PrescriptionItemInput {
  enteredName: string;
  sequence?: number;
  productId?: string | null;
  strengthLabel?: string | null;
  formText?: string | null;
  routeText?: string | null;
  doseQuantity?: number | null;
  doseUnit?: DoseUnit | null;
  frequencyCode?: FrequencyCode | null;
  pattern?: string | null;
  foodInstruction?: FoodInstruction | null;
  durationDays?: number | null;
  instructionsText?: string | null;
}

export interface PrescriptionDetailDto {
  id: string;
  practitionerName: string | null;
  /** Calendar date "YYYY-MM-DD" or null. */
  prescribedAt: string | null;
  notes: string | null;
  encounterId: string | null;
  diagnosisText: string | null;
  validUntil: string | null;
  followUpOn: string | null;
  items: PrescriptionItemDto[];
  createdAt: string;
  documents: PrescriptionDocumentDto[];
  medications: Array<{ id: string; enteredName: string; status: string; doseUnit: string | null }>;
}

export interface CreatePrescriptionInput {
  practitionerName?: string;
  prescribedAt?: string;
  notes?: string;
  diagnosisText?: string | null;
  validUntil?: string | null;
  followUpOn?: string | null;
  encounterId?: string | null;
  items?: PrescriptionItemInput[];
}

/** What "Start this medicine" may add to a line: only what the paper left out, plus the patient's own details. */
export interface StartMedicationInput {
  doseQuantity?: number;
  doseUnit?: DoseUnit;
  frequencyCode?: FrequencyCode;
  pattern?: string;
  foodInstruction?: FoodInstruction;
  startDate?: string;
  quantityOnHand?: number;
  patientReason?: string;
}

const LIST_PATH = "/profiles/current/prescriptions";

function bust(prescriptionId?: string): void {
  invalidate("profile", LIST_PATH);
  invalidate("profile", prescriptionId ? `/prescriptions/${prescriptionId}` : "/prescriptions/");
  invalidateHealthTimeline();
}

export function usePrescriptions() {
  const { data, error, reload } = useSharedResource<PrescriptionDto[]>({
    path: LIST_PATH,
    fetcher: async () => (await api.get<{ items: PrescriptionDto[] }>(LIST_PATH, { profileId: getActiveProfileId() })).items,
  });
  return { items: data, error, reload };
}

export function usePrescription(id: string) {
  const { data, error, reload } = useSharedResource<PrescriptionDetailDto>({
    path: `/prescriptions/${id}`,
    fetcher: () => api.get<PrescriptionDetailDto>(`/prescriptions/${id}`, { profileId: getActiveProfileId() }),
  });
  return { prescription: data, error, reload };
}

export async function createPrescription(input: CreatePrescriptionInput) {
  const res = await api.post<PrescriptionDetailDto>(LIST_PATH, input, { profileId: getActiveProfileId() });
  bust();
  return res;
}

export async function deletePrescription(id: string) {
  const res = await api.delete(`/prescriptions/${id}`, { profileId: getActiveProfileId() });
  bust();
  return res;
}

export async function linkMedicationToPrescription(prescriptionId: string, medicationId: string) {
  const res = await api.post<PrescriptionDetailDto>(`/prescriptions/${prescriptionId}/medications`, { medicationId }, {
    profileId: getActiveProfileId(),
  });
  // Linking can fill in the medicine's prescriber, so its cached rows are stale too.
  bust(prescriptionId);
  invalidateMedicationData();
  return res;
}

// --- line items (docs_v2/05 §4) -----------------------------------------

export async function addPrescriptionItem(prescriptionId: string, input: PrescriptionItemInput) {
  const res = await api.post<PrescriptionItemDto>(`/prescriptions/${prescriptionId}/items`, input, { profileId: getActiveProfileId() });
  bust(prescriptionId);
  return res;
}

export async function updatePrescriptionItem(prescriptionId: string, itemId: string, patch: Partial<PrescriptionItemInput>) {
  const res = await api.patch<PrescriptionItemDto>(`/prescription-items/${itemId}`, patch, { profileId: getActiveProfileId() });
  bust(prescriptionId);
  return res;
}

export async function deletePrescriptionItem(prescriptionId: string, itemId: string) {
  await api.delete(`/prescription-items/${itemId}`, { profileId: getActiveProfileId() });
  bust(prescriptionId);
}

/**
 * "Start this medicine" from a line. The server refuses (400 with
 * `errors[{path}]`) when the line plus the override still has no readable
 * dose — starting on an invented dose is hazard H-02 — and answers 409 when
 * the line is already a live medicine. Both are surfaced by the sheet, never
 * swallowed. An idempotency key guards the double-tap.
 */
export async function startMedicationFromItem(prescriptionId: string, itemId: string, input: StartMedicationInput) {
  const res = await api.post<{ id: string }>(`/prescription-items/${itemId}/start-medication`, input, {
    profileId: getActiveProfileId(),
    idempotencyKey: newIdempotencyKey(),
  });
  bust(prescriptionId);
  invalidateMedicationData();
  invalidate("profile", "/profiles/current/safety/findings");
  return res;
}

/** Presigned, short-lived — fetched on demand rather than embedded in the list. */
export async function documentDownloadUrl(documentId: string): Promise<string> {
  const res = await api.get<{ url: string }>(`/documents/${documentId}/download-url`, { profileId: getActiveProfileId() });
  return res.url;
}
