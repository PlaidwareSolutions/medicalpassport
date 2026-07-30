"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type PrescriptionDetailDto, type PrescriptionDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export function usePrescriptions() {
  const [items, setItems] = useState<PrescriptionDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: PrescriptionDto[] }>("/profiles/current/prescriptions", {
        profileId: getActiveProfileId(),
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, reload: load };
}

export function usePrescription(id: string) {
  const [prescription, setPrescription] = useState<PrescriptionDetailDto | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setPrescription(await api.get<PrescriptionDetailDto>(`/prescriptions/${id}`, { profileId: getActiveProfileId() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { prescription, error, reload: load };
}

export async function createPrescription(input: { practitionerName?: string; prescribedAt?: string; notes?: string }) {
  return api.post<PrescriptionDetailDto>("/profiles/current/prescriptions", input, { profileId: getActiveProfileId() });
}

export async function deletePrescription(id: string) {
  return api.delete(`/prescriptions/${id}`, { profileId: getActiveProfileId() });
}

export async function linkMedicationToPrescription(prescriptionId: string, medicationId: string) {
  return api.post<PrescriptionDetailDto>(`/prescriptions/${prescriptionId}/medications`, { medicationId }, {
    profileId: getActiveProfileId(),
  });
}

/** Presigned, short-lived — fetched on demand rather than embedded in the list. */
export async function documentDownloadUrl(documentId: string): Promise<string> {
  const res = await api.get<{ url: string }>(`/documents/${documentId}/download-url`, { profileId: getActiveProfileId() });
  return res.url;
}
