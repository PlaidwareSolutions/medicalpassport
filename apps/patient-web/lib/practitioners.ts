"use client";
import type { PractitionerDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

/**
 * "My doctors" — the shared records behind every prescriber/doctor field.
 * A rename or merge changes what medicines/prescriptions/reports display,
 * so mutations invalidate those caches too.
 */
export function usePractitioners() {
  const { data, error, reload } = useSharedResource<PractitionerDto[]>({
    path: "/profiles/current/practitioners",
    fetcher: async () =>
      (await api.get<{ items: PractitionerDto[] }>("/profiles/current/practitioners", { profileId: getActiveProfileId() }))
        .items,
  });
  return { items: data, error, reload };
}

export async function createPractitioner(input: { displayName: string; speciality?: string }) {
  const res = await api.post<PractitionerDto>("/profiles/current/practitioners", input, {
    profileId: getActiveProfileId(),
  });
  invalidate("profile", "/profiles/current/practitioners");
  return res;
}

function invalidatePractitionerViews() {
  invalidate("profile", "/profiles/current/practitioners");
  invalidate("profile", "/profiles/current/medications");
  invalidate("profile", "/medications/");
  invalidate("profile", "/profiles/current/prescriptions");
  invalidate("profile", "/prescriptions/");
  invalidate("profile", "/profiles/current/reports");
  invalidate("profile", "/reports/");
}

/**
 * Called by entry forms just before submit: a typed-in new doctor with a
 * speciality needs an explicit create (the form's own endpoint only carries
 * the name string); a bare name needs nothing — the server's resolve()
 * dedup handles it, exactly as before the picker existed.
 */
export async function ensurePractitioner(displayName: string, speciality: string) {
  if (!displayName.trim() || !speciality.trim()) return;
  await createPractitioner({ displayName: displayName.trim(), speciality: speciality.trim() });
}

export async function updatePractitioner(id: string, input: { displayName?: string; speciality?: string }) {
  const res = await api.patch<PractitionerDto>(`/practitioners/${id}`, input, { profileId: getActiveProfileId() });
  invalidatePractitionerViews();
  return res;
}

export async function mergePractitioner(id: string, targetId: string) {
  const res = await api.post<PractitionerDto>(`/practitioners/${id}/merge`, { targetId }, { profileId: getActiveProfileId() });
  invalidatePractitionerViews();
  return res;
}

export async function deletePractitioner(id: string) {
  await api.delete(`/practitioners/${id}`, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/practitioners");
}
