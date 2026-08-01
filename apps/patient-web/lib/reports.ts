"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type ReportDetailDto, type ReportDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export function useReports() {
  const [items, setItems] = useState<ReportDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: ReportDto[] }>("/profiles/current/reports", {
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

export function useReport(id: string) {
  const [report, setReport] = useState<ReportDetailDto | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setReport(await api.get<ReportDetailDto>(`/reports/${id}`, { profileId: getActiveProfileId() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { report, error, reload: load };
}

export async function createReport(input: {
  kind: string;
  label?: string;
  facilityName?: string;
  practitionerName?: string;
  testedAt?: string;
  notes?: string;
}) {
  return api.post<ReportDetailDto>("/profiles/current/reports", input, { profileId: getActiveProfileId() });
}

export async function deleteReport(id: string) {
  return api.delete(`/reports/${id}`, { profileId: getActiveProfileId() });
}
