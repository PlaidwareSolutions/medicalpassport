"use client";
import type { ShareAccessEventDto, ShareDto, VisitSummaryDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export function useVisitSummary() {
  const { data, error, reload } = useSharedResource<VisitSummaryDto>({
    path: "/profiles/current/visit-summary",
    fetcher: () => api.get<VisitSummaryDto>("/profiles/current/visit-summary", { profileId: getActiveProfileId() }),
  });
  return { data, error, reload };
}

export function useShares() {
  const { data, error, reload } = useSharedResource<ShareDto[]>({
    path: "/profiles/current/shares",
    fetcher: async () =>
      (await api.get<{ items: ShareDto[] }>("/profiles/current/shares", { profileId: getActiveProfileId() })).items,
  });
  return { items: data, error, reload };
}

export async function createShare(input: {
  sections: Record<string, boolean>;
  expiresInHours: number;
  kind: "link" | "qr";
}) {
  const res = await api.post<{ id: string; token: string; expiresAt: string }>("/profiles/current/shares", input, {
    profileId: getActiveProfileId(),
  });
  invalidate("profile", "/profiles/current/shares");
  return res;
}

export async function revokeShare(id: string) {
  const res = await api.post(`/shares/${id}/revoke`, undefined, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/shares");
  return res;
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

/**
 * Opens WhatsApp's own share intent with the visit summary as plain text
 * (docs/07 screen 29) — no WhatsApp Business API account exists to send
 * through server-side (OD-10), so the patient's own WhatsApp app sends it,
 * the same way any other "share to WhatsApp" link works on web or mobile.
 */
export async function shareVisitSummaryViaWhatsApp(sections: Record<string, boolean>): Promise<void> {
  const query = new URLSearchParams(Object.entries(sections).map(([k, v]) => [k, String(v)])).toString();
  const res = await api.get<{ text: string }>(`/profiles/current/visit-summary/text?${query}`, {
    profileId: getActiveProfileId(),
  });
  window.open(`https://wa.me/?text=${encodeURIComponent(res.text)}`, "_blank", "noopener,noreferrer");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
