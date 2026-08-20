"use client";
import type { BloodPressureReadingDto, WeightReadingDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export function useBloodPressureReadings() {
  const { data, error, reload } = useSharedResource<BloodPressureReadingDto[]>({
    path: "/profiles/current/blood-pressure-readings",
    fetcher: async () =>
      (
        await api.get<{ items: BloodPressureReadingDto[] }>("/profiles/current/blood-pressure-readings", {
          profileId: getActiveProfileId(),
        })
      ).items,
  });
  return { items: data, error, reload };
}

export async function addBloodPressureReading(input: {
  measuredAt: string;
  systolic: number;
  diastolic: number;
  pulseBpm?: number;
  note?: string;
}) {
  const res = await api.post("/profiles/current/blood-pressure-readings", input, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/blood-pressure-readings");
  return res;
}

export async function deleteBloodPressureReading(id: string) {
  const res = await api.delete(`/blood-pressure-readings/${id}`, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/blood-pressure-readings");
  return res;
}

export function useWeightReadings() {
  const { data, error, reload } = useSharedResource<WeightReadingDto[]>({
    path: "/profiles/current/weight-readings",
    fetcher: async () =>
      (await api.get<{ items: WeightReadingDto[] }>("/profiles/current/weight-readings", { profileId: getActiveProfileId() }))
        .items,
  });
  return { items: data, error, reload };
}

export async function addWeightReading(input: { measuredAt: string; weightKg: number; note?: string }) {
  const res = await api.post("/profiles/current/weight-readings", input, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/weight-readings");
  return res;
}

export async function deleteWeightReading(id: string) {
  const res = await api.delete(`/weight-readings/${id}`, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/weight-readings");
  return res;
}
