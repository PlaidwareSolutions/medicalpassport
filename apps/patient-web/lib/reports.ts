"use client";
import type { ReportDetailDto, ReportDto, ReportValueDto, ReportValueHistoryItemDto } from "@medpass/api-client";
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
  // Its values disappear from every per-analyte history too.
  invalidate("profile", "/profiles/current/report-values");
  return res;
}

function invalidateValueData(): void {
  // The detail payload embeds the values, and every ?analyte= history
  // variant shares this prefix.
  invalidate("profile", "/reports/");
  invalidate("profile", "/profiles/current/report-values");
}

export async function addReportValue(
  reportId: string,
  input: { analyte: string; otherLabel?: string; enteredValue: string; referenceText?: string },
) {
  const res = await api.post<ReportValueDto>(`/reports/${reportId}/values`, input, { profileId: getActiveProfileId() });
  invalidateValueData();
  return res;
}

export async function deleteReportValue(id: string) {
  const res = await api.delete(`/report-values/${id}`, { profileId: getActiveProfileId() });
  invalidateValueData();
  return res;
}

/** One analyte across every report — report values only, never check-up entries (docs/07 screens 42/44). */
export function useReportValueHistory(analyte: string | undefined) {
  const path = `/profiles/current/report-values?analyte=${analyte ?? ""}`;
  const { data, error, reload } = useSharedResource<ReportValueHistoryItemDto[]>({
    path,
    fetcher: async () => {
      if (!analyte) return [];
      return (await api.get<{ items: ReportValueHistoryItemDto[] }>(path, { profileId: getActiveProfileId() })).items;
    },
  });
  return { items: data, error, reload };
}
