"use client";
import type { ReportDetailDto, ReportDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export function useReports() {
  const { data, error, reload } = useSharedResource<ReportDto[]>({
    path: "/profiles/current/reports",
    fetcher: async () =>
      (await api.get<{ items: ReportDto[] }>("/profiles/current/reports", { profileId: getActiveProfileId() })).items,
  });
  return { items: data, error, reload };
}

export function useReport(id: string) {
  const { data, error, reload } = useSharedResource<ReportDetailDto>({
    path: `/reports/${id}`,
    fetcher: () => api.get<ReportDetailDto>(`/reports/${id}`, { profileId: getActiveProfileId() }),
  });
  return { report: data, error, reload };
}

export async function createReport(input: {
  kind: string;
  label?: string;
  facilityName?: string;
  practitionerName?: string;
  testedAt?: string;
  notes?: string;
}) {
  const res = await api.post<ReportDetailDto>("/profiles/current/reports", input, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/reports");
  return res;
}

export async function deleteReport(id: string) {
  const res = await api.delete(`/reports/${id}`, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/reports");
  invalidate("profile", "/reports/");
  return res;
}
