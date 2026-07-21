/**
 * Cloudflare R2 access layer.
 *
 * Contract (docs/26): private buckets only; opaque object keys with no
 * patient identifiers; short-lived presigned URLs issued only after
 * authorization; every issuance audited; no permanent public URLs stored.
 *
 * Two implementations share this interface: `LocalDiskObjectStorage` (docs/24
 * ADR-12, the dev/test default) and `R2ObjectStorage` (the real S3-compatible
 * backend, docs/26 §13 — Stage 11 follow-up), selected by `createObjectStorage`
 * based on whether R2 credentials are configured.
 */

export type BucketPurpose = "patient-docs" | "derived" | "ocr-tmp" | "backups";

export interface PresignedUpload {
  objectKey: string;
  url: string;
  expiresAt: Date;
  maxSizeBytes: number;
  allowedContentTypes: string[];
}

export interface ObjectStorage {
  presignUpload(opts: {
    bucket: BucketPurpose;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<PresignedUpload>;
  presignDownload(opts: { bucket: BucketPurpose; objectKey: string }): Promise<{ url: string; expiresAt: Date }>;
  head(opts: { bucket: BucketPurpose; objectKey: string }): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }>;
  delete(opts: { bucket: BucketPurpose; objectKey: string }): Promise<void>;
  /** Reads an object's full bytes — used where the server itself needs the content (signature verification, OCR), not just a client-facing URL. */
  getObjectBytes(opts: { bucket: BucketPurpose; objectKey: string }): Promise<Buffer>;
}

/** Generates an opaque, non-guessable object key: {kind}/{yyyy}/{mm}/{uuid}. */
export function opaqueObjectKey(kind: string, id: string, now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${kind}/${yyyy}/${mm}/${id}`;
}

export * from "./local-disk.js";
export * from "./r2.js";
export * from "./factory.js";
