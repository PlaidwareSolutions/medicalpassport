"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type ShareAccessEventDto, type ShareDto, type VisitSummaryDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export function useVisitSummary() {
  const [data, setData] = useState<VisitSummaryDto | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<VisitSummaryDto>("/profiles/current/visit-summary", { profileId: getActiveProfileId() });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, reload: load };
}

export function useShares() {
  const [items, setItems] = useState<ShareDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: ShareDto[] }>("/profiles/current/shares", { profileId: getActiveProfileId() });
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

export async function createShare(input: {
  sections: Record<string, boolean>;
  expiresInHours: number;
  kind: "link" | "qr";
}) {
  return api.post<{ id: string; token: string; expiresAt: string }>("/profiles/current/shares", input, {
    profileId: getActiveProfileId(),
  });
}

export async function revokeShare(id: string) {
  return api.post(`/shares/${id}/revoke`, undefined, { profileId: getActiveProfileId() });
}

export async function fetchAccessLog(id: string): Promise<ShareAccessEventDto[]> {
  const res = await api.get<{ items: ShareAccessEventDto[] }>(`/shares/${id}/accesses`, {
    profileId: getActiveProfileId(),
  });
  return res.items;
}

export function shareUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/s/${token}`;
}

/** Triggers a real browser download of the patient's own doctor-visit summary as a PDF. */
export async function downloadVisitSummaryPdf(): Promise<void> {
  const blob = await api.getBlob("/profiles/current/visit-summary/pdf", { profileId: getActiveProfileId() });
  triggerDownload(blob, "medication-summary.pdf");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
