/**
 * Cloudflare R2 access layer — Stage 3 scaffold.
 *
 * Contract (docs/26): private buckets only; opaque object keys with no
 * patient identifiers; short-lived presigned URLs issued only after
 * authorization; every issuance audited; no permanent public URLs stored.
 *
 * The implementation will use the S3-compatible API (ADR-12); local
 * development pairs with MinIO via docker-compose.
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
}

/** Generates an opaque, non-guessable object key: {kind}/{yyyy}/{mm}/{uuid}. */
export function opaqueObjectKey(kind: string, id: string, now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${kind}/${yyyy}/${mm}/${id}`;
}
