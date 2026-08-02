"use client";
import { useEffect } from "react";
import { ApiError, type PatientMedicationDto } from "@medpass/api-client";
import { formatDoseAmount, needsDoseUnitConfirmation } from "@medpass/medication-terminology";
import { cacheMedications, enqueueMutation, getCachedMedications, type SyncChangeSignal } from "@medpass/offline-sync";
import { api, getActiveProfileId, newIdempotencyKey } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { notifyMutationQueued, REMOTE_CHANGE_EVENT } from "./offline";

/** The two cached list variants any screen actually reads (docs/15) — Home's "current" and the Medicines tab's unfiltered "all". */
const CACHED_VARIANTS = ["current", "all"];

export interface EditMedicationPatch {
  patientReason?: string;
  prescriberName?: string;
  quantityOnHand?: number | null;
  criticalEscalation?: boolean;
  instruction?: {
    doseQuantity: number;
    doseUnit: string;
    frequencyCode: string;
    pattern?: string;
    foodInstruction: string;
    durationDays?: number;
  };
}

/** Everything a medication mutation can leave stale — the lists, any detail row, and the schedule built from them. */
export function invalidateMedicationData(): void {
  invalidate("profile", "/profiles/current/medications");
  invalidate("profile", "/medications/");
  invalidate("profile", "/profiles/current/timeline");
}

export function useMedications(status?: string) {
  const variant = status ?? "all";
  const query = status ? `?status=${status}` : "";
  const path = `/profiles/current/medications${query}`;

  const readIndexedDb = async () => {
    const profileId = getActiveProfileId();
    if (!profileId) return undefined;
    return (await getCachedMedications<PatientMedicationDto[]>(profileId, variant))?.items;
  };

  const { data, error, fromCache, reload } = useSharedResource<PatientMedicationDto[]>({
    path,
    fetcher: async () =>
      (await api.get<{ items: PatientMedicationDto[] }>(path, { profileId: getActiveProfileId() })).items,
    // Cold start: the IndexedDB copy renders before the first network answer.
    seed: readIndexedDb,
    // Genuine network failure: the docs/15 offline path, unchanged.
    fallback: readIndexedDb,
    onFetched: async (items) => {
      const profileId = getActiveProfileId();
      if (!profileId) return;
      await cacheMedications(profileId, variant, items);
      // The medicines screen now fetches only the unfiltered list (its
      // "current" tab is derived client-side), so the offline "current"
      // variant — which offline Home and the low-storage trim keep alive —
      // is written here as a derivation instead of by a second request.
      if (variant === "all") {
        await cacheMedications(profileId, "current", items.filter((m) => m.status === "current"));
      }
    },
  });

  // A caregiver's edit (or this patient's own other device) made while this
  // screen wasn't actively fetching — reload once told the medications list
  // for this profile changed (docs/15 incremental sync). The shared entries
  // are dropped first so an unmounted consumer can't render the stale copy.
  useEffect(() => {
    function onRemoteChange(e: Event) {
      const change = (e as CustomEvent<SyncChangeSignal>).detail;
      if (change.scope === "medications" && change.profileId === getActiveProfileId()) {
        invalidate("profile", "/profiles/current/medications");
        invalidate("profile", "/medications/");
        void reload();
      }
    }
    window.addEventListener(REMOTE_CHANGE_EVENT, onRemoteChange);
    return () => window.removeEventListener(REMOTE_CHANGE_EVENT, onRemoteChange);
  }, [reload]);

  return { items: data, error, fromCache, reload };
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
  const readIndexedDb = async () => {
    const profileId = getActiveProfileId();
    if (!profileId) return undefined;
    return findCachedMedication(profileId, id);
  };

  const { data, error, fromCache, reload } = useSharedResource<PatientMedicationDto>({
    path: `/medications/${id}`,
    fetcher: () => api.get<PatientMedicationDto>(`/medications/${id}`, { profileId: getActiveProfileId() }),
    fallback: readIndexedDb,
  });

  // The signal doesn't say which medicine changed (docs/15 — an
  // invalidation, not a patch), so any "medications changed" for this
  // profile reloads this one too — cheap, and correct whether or not it
  // was this specific medicine.
  useEffect(() => {
    function onRemoteChange(e: Event) {
      const change = (e as CustomEvent<SyncChangeSignal>).detail;
      if (change.scope === "medications" && change.profileId === getActiveProfileId()) {
        invalidate("profile", "/profiles/current/medications");
        invalidate("profile", "/medications/");
        void reload();
      }
    }
    window.addEventListener(REMOTE_CHANGE_EVENT, onRemoteChange);
    return () => window.removeEventListener(REMOTE_CHANGE_EVENT, onRemoteChange);
  }, [reload]);

  return { medication: data, error, fromCache, reload };
}

export function instructionSummary(
  m: PatientMedicationDto,
  t: (key: never, params?: Record<string, string | number>) => string,
): string {
  const i = m.instruction;
  if (!i) return "";
  const freq = t(`frequency.${i.frequencyCode.toLowerCase()}` as never);
  const food = t(`food.${i.foodInstruction}` as never);
  const unit = t(`unit.${i.doseUnit}` as never);
  const pattern = i.pattern ? ` ${i.pattern}` : "";
  return `${formatDoseAmount(Number(i.doseQuantity))} ${unit} · ${freq}${pattern} · ${food}`;
}

/**
 * Whether to prompt for this medicine's type. A medicine with no instruction
 * has no unit to be wrong about; the status rule lives in
 * `needsDoseUnitConfirmation`, where it's unit-tested.
 */
export function needsTypeConfirmation(m: PatientMedicationDto): boolean {
  return m.instruction != null && needsDoseUnitConfirmation(m.status, m.instruction.doseUnitConfirmed);
}

export async function confirmDoseUnit(id: string, doseUnit: string) {
  const res = await api.post<PatientMedicationDto>(`/medications/${id}/confirm-dose-unit`, { doseUnit }, {
    profileId: getActiveProfileId(),
  });
  // The list must not keep advertising the unconfirmed state (or the old
  // glyph) after the patient just answered.
  invalidateMedicationData();
  return res;
}

/**
 * The same line minus the dose — for screens that already show the dose
 * visually (DoseVisual), where repeating "1 tablet" as text would just be
 * noise. The dose glyph's own label is what satisfies docs/33's
 * "icons always paired with text labels".
 */
export function scheduleSummary(
  m: PatientMedicationDto,
  t: (key: never, params?: Record<string, string | number>) => string,
): string {
  const i = m.instruction;
  if (!i) return "";
  const freq = t(`frequency.${i.frequencyCode.toLowerCase()}` as never);
  const food = t(`food.${i.foodInstruction}` as never);
  const pattern = i.pattern ? ` ${i.pattern}` : "";
  return `${freq}${pattern} · ${food}`;
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
            ...(patch.prescriberName !== undefined ? { prescriberName: patch.prescriberName } : {}),
            ...(patch.quantityOnHand !== undefined
              ? { quantityOnHand: patch.quantityOnHand != null ? String(patch.quantityOnHand) : null }
              : {}),
            ...(patch.criticalEscalation !== undefined ? { criticalEscalation: patch.criticalEscalation } : {}),
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
    invalidateMedicationData();
    invalidate("profile", "/profiles/current/safety/findings");
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
    invalidateMedicationData();
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
    invalidateMedicationData();
    invalidate("profile", "/profiles/current/safety/findings");
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
    invalidateMedicationData();
    return { queuedOffline: true };
  }
}
