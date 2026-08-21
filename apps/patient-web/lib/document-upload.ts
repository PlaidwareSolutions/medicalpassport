"use client";
import type { AuthorizeUploadResponseDto } from "@medpass/api-client";
import { api, getActiveProfileId, newIdempotencyKey } from "./api";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Imaging and scan reports get the scan document kind; everything else is a
 * lab result. Takes the report kind as a plain string because DTOs type it
 * that way (MedicalReportKind at the form layer narrows to the same values).
 */
export function documentKindFor(kind: string): "scan_report" | "lab_report" {
  return kind === "imaging" || kind === "ecg" ? "scan_report" : "lab_report";
}

/**
 * authorize → presigned PUT → complete: the one upload sequence every
 * document surface shares (was duplicated across prescriptions/new and
 * reports/new; now also used by both detail screens' add-more-pages flow —
 * a report or prescription is routinely several pages, docs/07 §43/44).
 */
export async function uploadDocument(
  file: File,
  target: { kind: "prescription"; prescriptionId: string } | { kind: "scan_report" | "lab_report"; reportId: string },
): Promise<void> {
  const contentType = file.type || "application/octet-stream";
  const authRes = await api.post<AuthorizeUploadResponseDto>(
    "/profiles/current/documents/authorize-upload",
    { ...target, contentType, sizeBytes: file.size },
    { idempotencyKey: newIdempotencyKey(), profileId: getActiveProfileId() },
  );
  const putRes = await fetch(authRes.uploadUrl, { method: "PUT", headers: { "content-type": contentType }, body: file });
  if (!putRes.ok) throw new Error("upload_failed");
  await api.post(`/documents/${authRes.documentId}/complete`, undefined, { profileId: getActiveProfileId() });
}
