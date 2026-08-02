"use client";
import type { PrescriptionDetailDto, PrescriptionDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export function usePrescriptions() {
  const { data, error, reload } = useSharedResource<PrescriptionDto[]>({
    path: "/profiles/current/prescriptions",
    fetcher: async () =>
      (await api.get<{ items: PrescriptionDto[] }>("/profiles/current/prescriptions", { profileId: getActiveProfileId() }))
        .items,
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

export async function createPrescription(input: { practitionerName?: string; prescribedAt?: string; notes?: string }) {
  const res = await api.post<PrescriptionDetailDto>("/profiles/current/prescriptions", input, {
    profileId: getActiveProfileId(),
  });
  invalidate("profile", "/profiles/current/prescriptions");
  return res;
}

export async function deletePrescription(id: string) {
  const res = await api.delete(`/prescriptions/${id}`, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/prescriptions");
  invalidate("profile", "/prescriptions/");
  return res;
}

export async function linkMedicationToPrescription(prescriptionId: string, medicationId: string) {
  const res = await api.post<PrescriptionDetailDto>(`/prescriptions/${prescriptionId}/medications`, { medicationId }, {
    profileId: getActiveProfileId(),
  });
  // Linking can fill in the medicine's prescriber, so its cached rows are stale too.
  invalidate("profile", "/prescriptions/");
  invalidate("profile", "/profiles/current/medications");
  invalidate("profile", "/medications/");
  return res;
}

/** Presigned, short-lived — fetched on demand rather than embedded in the list. */
export async function documentDownloadUrl(documentId: string): Promise<string> {
  const res = await api.get<{ url: string }>(`/documents/${documentId}/download-url`, { profileId: getActiveProfileId() });
  return res.url;
}
