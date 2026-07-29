"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type CheckupRecordDto, type GlucoseReadingDto } from "@medpass/api-client";
import type { GlucoseReadingContext } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";

export function useGlucoseReadings() {
  const [items, setItems] = useState<GlucoseReadingDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: GlucoseReadingDto[] }>("/profiles/current/glucose-readings", {
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

export async function addGlucoseReading(input: {
  measuredAt: string;
  context: GlucoseReadingContext;
  valueMgDl: number;
  note?: string;
}) {
  return api.post("/profiles/current/glucose-readings", input, { profileId: getActiveProfileId() });
}

export async function deleteGlucoseReading(id: string) {
  return api.delete(`/glucose-readings/${id}`, { profileId: getActiveProfileId() });
}

export function useCheckupRecords() {
  const [items, setItems] = useState<CheckupRecordDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: CheckupRecordDto[] }>("/profiles/current/checkup-records", {
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
  return api.post("/profiles/current/checkup-records", input, { profileId: getActiveProfileId() });
}

export async function deleteCheckupRecord(id: string) {
  return api.delete(`/checkup-records/${id}`, { profileId: getActiveProfileId() });
}
