"use client";
import type { CheckupRecordDto, GlucoseReadingDto } from "@medpass/api-client";
import type { GlucoseReadingContext } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export function useGlucoseReadings() {
  const { data, error, reload } = useSharedResource<GlucoseReadingDto[]>({
    path: "/profiles/current/glucose-readings",
    fetcher: async () =>
      (await api.get<{ items: GlucoseReadingDto[] }>("/profiles/current/glucose-readings", { profileId: getActiveProfileId() }))
        .items,
  });
  return { items: data, error, reload };
}

export async function addGlucoseReading(input: {
  measuredAt: string;
  context: GlucoseReadingContext;
  valueMgDl: number;
  note?: string;
}) {
  const res = await api.post("/profiles/current/glucose-readings", input, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/glucose-readings");
  return res;
}

export async function deleteGlucoseReading(id: string) {
  const res = await api.delete(`/glucose-readings/${id}`, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/glucose-readings");
  return res;
}

export function useCheckupRecords() {
  const { data, error, reload } = useSharedResource<CheckupRecordDto[]>({
    path: "/profiles/current/checkup-records",
    fetcher: async () =>
      (await api.get<{ items: CheckupRecordDto[] }>("/profiles/current/checkup-records", { profileId: getActiveProfileId() }))
        .items,
  });
  return { items: data, error, reload };
}

export async function addCheckupRecord(input: {
  checkupDate: string;
  fastingGlucoseMgDl?: number;
  postPrandialGlucoseMgDl?: number;
  hba1cPercent?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  weightKg?: number;
  waistCircumferenceCm?: number;
  cholesterolMgDl?: number;
  treatmentChanges?: string;
  nextAppointmentDate?: string;
}) {
  const res = await api.post("/profiles/current/checkup-records", input, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/checkup-records");
  return res;
}

export async function deleteCheckupRecord(id: string) {
  const res = await api.delete(`/checkup-records/${id}`, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/checkup-records");
  return res;
}
