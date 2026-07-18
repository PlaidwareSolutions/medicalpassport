"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type PatientMedicationDto } from "@medpass/api-client";
import { cacheMedications, enqueueMutation, getCachedMedications } from "@medpass/offline-sync";
import { api, getActiveProfileId, newIdempotencyKey } from "./api";
import { notifyMutationQueued } from "./offline";

/** The two cached list variants any screen actually reads (docs/15) — Home's "current" and the Medicines tab's unfiltered "all". */
const CACHED_VARIANTS = ["current", "all"];

export interface EditMedicationPatch {
  patientReason?: string;
  quantityOnHand?: number | null;
  instruction?: {
    doseQuantity: number;
    doseUnit: string;
    frequencyCode: string;
    pattern?: string;
    foodInstruction: string;
    durationDays?: number;
  };
}

export function useMedications(status?: string) {
  const [items, setItems] = useState<PatientMedicationDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [fromCache, setFromCache] = useState(false);
  const variant = status ?? "all";

  const load = useCallback(async () => {
    setError(undefined);
    const profileId = getActiveProfileId();
    try {
      const query = status ? `?status=${status}` : "";
      const res = await api.get<{ items: PatientMedicationDto[] }>(`/profiles/current/medications${query}`, {
        profileId,
      });
      setItems(res.items);
      setFromCache(false);
      if (profileId) await cacheMedications(profileId, variant, res.items);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.problem.title);
        return;
      }
      // Genuine network failure (no response at all) — fall back to cache
      // rather than a dead error screen (docs/15).
      if (profileId) {
        const cached = await getCachedMedications<PatientMedicationDto[]>(profileId, variant);
        if (cached) {
          setItems(cached.items);
          setFromCache(true);
          return;
        }
      }
      setError("network");
    }
  }, [status, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, fromCache, reload: load };
}

async function findCachedMedication(profileId: string, id: string): Promise<PatientMedicationDto | undefined> {
  for (const variant of CACHED_VARIANTS) {
    const cached = await getCachedMedications<PatientMedicationDto[]>(profileId, variant);
    const found = cached?.items.find((m) => m.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Single-medicine detail (used by the detail and edit screens). Falls back
 * to whatever cached list already has this medicine on a genuine network
 * failure, same as `useMedications` — reopening a medicine you've already
 * viewed shouldn't go dead just because the app is offline (docs/15).
 */
export function useMedication(id: string) {
  const [medication, setMedication] = useState<PatientMedicationDto | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [fromCache, setFromCache] = useState(false);

  const load = useCallback(async () => {
    setError(undefined);
    const profileId = getActiveProfileId();
    try {
      const m = await api.get<PatientMedicationDto>(`/medications/${id}`, { profileId });
      setMedication(m);
      setFromCache(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.problem.title);
        return;
      }
      if (profileId) {
        const cached = await findCachedMedication(profileId, id);
        if (cached) {
          setMedication(cached);
          setFromCache(true);
          return;
        }
      }
      setError("network");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { medication, error, fromCache, reload: load };
}

export function instructionSummary(
  m: PatientMedicationDto,
  t: (key: never, params?: Record<string, string | number>) => string,
): string {
  const i = m.instruction;
  if (!i) return "";
  const freq = t(`frequency.${i.frequencyCode.toLowerCase()}` as never);
  const food = t(`food.${i.foodInstruction}` as never);
  const pattern = i.pattern ? ` ${i.pattern}` : "";
  return `${i.doseQuantity} ${i.doseUnit} · ${freq}${pattern} · ${food}`;
}

async function patchCachedMedication(profileId: string, id: string, patch: EditMedicationPatch): Promise<void> {
  for (const variant of CACHED_VARIANTS) {
    const cached = await getCachedMedications<PatientMedicationDto[]>(profileId, variant);
    if (!cached) continue;
    const items = cached.items.map((m) =>
      m.id === id
        ? {
            ...m,
            ...(patch.patientReason !== undefined ? { patientReason: patch.patientReason } : {}),
            ...(patch.quantityOnHand !== undefined
              ? { quantityOnHand: patch.quantityOnHand != null ? String(patch.quantityOnHand) : null }
              : {}),
            ...(patch.instruction
              ? {
                  instruction: {
                    ...m.instruction,
                    doseQuantity: String(patch.instruction.doseQuantity),
                    doseUnit: patch.instruction.doseUnit,
                    frequencyCode: patch.instruction.frequencyCode,
                    pattern: patch.instruction.pattern ?? null,
                    foodInstruction: patch.instruction.foodInstruction,
                    durationDays: patch.instruction.durationDays ?? null,
                  },
                }
              : {}),
          }
        : m,
    );
    await cacheMedications(profileId, variant, items);
  }
}

/**
 * Adds a medicine. On a genuine network failure, queues the mutation for
 * later replay through `POST /v1/sync` (docs/15) instead of losing what the
 * patient just entered — same pattern as offline dose recording. There's no
 * optimistic entry added to the cached medicines list here: the new
 * medicine simply appears once the queued mutation syncs, and the existing
 * "changes pending" banner (useSyncEngine) already tells the patient
 * something is waiting to save.
 */
export async function createMedication(payload: Record<string, unknown>): Promise<{ queuedOffline: boolean }> {
  const profileId = getActiveProfileId();
  const clientMutationId = newIdempotencyKey();
  try {
    await api.post("/profiles/current/medications", payload, { idempotencyKey: clientMutationId, profileId });
    return { queuedOffline: false };
  } catch (err) {
    if (err instanceof ApiError) throw err; // a real rejection (e.g. validation) — never hide it
    if (profileId) {
      await enqueueMutation({
        clientMutationId,
        entity: "patient_medication",
        operation: "create",
        payload,
        capturedAt: new Date().toISOString(),
        profileId,
      });
      notifyMutationQueued();
    }
    return { queuedOffline: true };
  }
}

/**
 * Edits a medicine. On a genuine network failure, queues the mutation for
 * later replay through `POST /v1/sync` and patches the cached list entries
 * immediately, so reopening the app offline shows the edit the patient just
 * made rather than silently reverting it (docs/15) — mirrors how offline
 * dose recording patches the cached timeline.
 */
export async function updateMedication(
  medication: PatientMedicationDto,
  patch: EditMedicationPatch,
): Promise<{ queuedOffline: boolean }> {
  const profileId = getActiveProfileId();
  const clientMutationId = newIdempotencyKey();
  const body = { rowVersion: medication.rowVersion, ...patch };
  try {
    await api.patch(`/medications/${medication.id}`, body, { idempotencyKey: clientMutationId, profileId });
    return { queuedOffline: false };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (profileId) {
      await enqueueMutation({
        clientMutationId,
        entity: "patient_medication",
        operation: "update",
        payload: { id: medication.id, ...body },
        capturedAt: new Date().toISOString(),
        profileId,
      });
      await patchCachedMedication(profileId, medication.id, patch);
      notifyMutationQueued();
    }
    return { queuedOffline: true };
  }
}
