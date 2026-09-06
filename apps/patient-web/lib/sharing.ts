"use client";
import type { ShareAccessEventDto, ShareDto, VisitSummaryDto } from "@medpass/api-client";
import type { ShareAudience, ShareExpiryPreset } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export type { ShareAudience, ShareExpiryPreset };

/**
 * The list rows carry two fields the shared DTO predates: the audience the
 * patient picked, and the frozen section map. Both matter on the list
 * screen — an existing link must be readable as exactly what it was when it
 * was made, so a patient can see it did not widen when the app learned new
 * sections (docs_v2/06 P7 exit gate).
 */
export type ShareListItem = ShareDto & { audience?: string };

export function useVisitSummary() {
  const { data, error, reload } = useSharedResource<VisitSummaryDto>({
    path: "/profiles/current/visit-summary",
    fetcher: () => api.get<VisitSummaryDto>("/profiles/current/visit-summary", { profileId: getActiveProfileId() }),
  });
  return { data, error, reload };
}

export function useShares() {
  const { data, error, reload } = useSharedResource<ShareListItem[]>({
    path: "/profiles/current/shares",
    fetcher: async () =>
      (await api.get<{ items: ShareListItem[] }>("/profiles/current/shares", { profileId: getActiveProfileId() })).items,
  });
  return { items: data, error, reload };
}

/**
 * The section vocabulary a share stores (docs_v2/04 §11). Order is the
 * order the picker lists them in: what a doctor reads first, then the
 * numbers, then the paperwork.
 */
export const SHARE_SECTIONS = [
  "medications",
  "allergies",
  "conditions",
  "recentChanges",
  "concerns",
  "reports",
  "measurements",
  "glucoseReadings",
  "bloodPressureReadings",
  "weightReadings",
  "checkups",
  "prescriptions",
  "encounters",
  "documents",
] as const;
export type ShareSection = (typeof SHARE_SECTIONS)[number];

/**
 * Every section, explicitly false where unchosen.
 *
 * This is not defensive tidiness — it is the contract. The server merges
 * what it receives over `DEFAULT_SHARE_SECTIONS`, in which nearly every
 * section is *true*. Sending only the boxes that were ticked would silently
 * share everything the caller left out. The picker therefore always sends
 * all fourteen keys.
 */
export function fullSectionMap(chosen: Partial<Record<ShareSection, boolean>>): Record<ShareSection, boolean> {
  return Object.fromEntries(SHARE_SECTIONS.map((s) => [s, chosen[s] === true])) as Record<ShareSection, boolean>;
}

export interface CreateShareInput {
  /** Partial is accepted; `fullSectionMap` fills in the explicit falses. */
  sections: Partial<Record<ShareSection, boolean>>;
  /** `full_passport` expands server-side to every section, documents included. */
  fullPassport?: boolean;
  audience: ShareAudience;
  expiresIn: ShareExpiryPreset;
  kind: "link" | "qr";
}

export async function createShare(input: CreateShareInput) {
  const body = {
    sections: input.fullPassport ? { ...fullSectionMap({}), full_passport: true } : fullSectionMap(input.sections),
    audience: input.audience,
    expiresIn: input.expiresIn,
    kind: input.kind,
  };
  const res = await api.post<{ id: string; token: string; expiresAt: string; audience?: string }>(
    "/profiles/current/shares",
    body,
    { profileId: getActiveProfileId() },
  );
  invalidate("profile", "/profiles/current/shares");
  return res;
}

/**
 * The recipient's view, built for the patient's own profile — what the
 * preview renders before a link exists. Same builder the public snapshot
 * route uses, so the preview cannot drift from the thing it previews.
 *
 * Note what it never contains: caregiver actions (docs_v2/10 H-33). A share
 * recipient learns what changed, never who in the family changed it.
 */
export function fetchDoctorSnapshot(): Promise<DoctorSnapshotDto> {
  return api.get<DoctorSnapshotDto>("/profiles/current/doctor-snapshot", { profileId: getActiveProfileId() });
}

export interface DoctorSnapshotDto {
  profile: { displayName: string; yearOfBirth: number | null; sex: string | null; timezone: string };
  generatedAt: string;
  currentMedications?: Array<{
    name: string;
    ingredients: string[];
    strengthLabel: string | null;
    instructionSummary: string;
    prescriberName: string | null;
    startDate: string | null;
  }>;
  allergies?: Array<{ label: string; severity: string; reactionNote: string | null }>;
  majorConditions?: Array<{ label: string; clinicalStatus: string | null; onsetDate: string | null; note: string | null }>;
  recentChanges?: Array<{ kind: string; occurredAt: string; summary: unknown }>;
  latestResults?: Array<{
    analyteKey: string;
    label: string;
    value: string;
    unit: string | null;
    referenceText: string | null;
    at: string;
    reportTitle: string;
  }>;
  measurements?: Array<{
    concept: string;
    label: string;
    unit: string;
    count: number;
    latest: { value: string; value2: string | null; measuredAt: string; context: string | null } | null;
  }>;
  documents?: Array<{ id: string; kind: string; title: string | null; documentDate: string | null; pageCount: number }>;
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
