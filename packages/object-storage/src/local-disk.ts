import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { opaqueObjectKey, type BucketPurpose, type ObjectStorage, type PresignedUpload } from "./index.js";

/**
 * Local-disk stand-in for Cloudflare R2 (docs/24 ADR-12, docs/26). This is a
 * documented dev-only backend — production uses real R2 via the S3 API, and
 * nothing else in the app needs to change to swap it: both implementations
 * satisfy the same `ObjectStorage` interface, and the two-phase
 * authorize→direct-upload→verify flow (docs/13 §13.3) is identical either
 * way. A "presigned URL" here is an HMAC-signed, short-lived, single-object,
 * single-operation token pointing at a small HTTP endpoint this process
 * also serves — functionally the same contract as a real presigned S3 URL,
 * just self-hosted instead of pointing at Cloudflare.
 */
export interface LocalDiskConfig {
  rootDir: string;
  /** Only required to presign — a delete/head-only consumer (e.g. a cleanup job) can omit it. */
  baseUrl?: string;
  /** HMAC key for signing tokens — derive from a real secret, never hardcode. */
  secret: string;
  uploadExpirySeconds?: number;
  downloadExpirySeconds?: number;
}

export interface StorageToken {
  bucket: BucketPurpose;
  objectKey: string;
  op: "upload" | "download";
  contentType?: string;
  maxSizeBytes?: number;
  exp: number; // epoch seconds
}

const DEFAULT_UPLOAD_EXPIRY = 10 * 60;
const DEFAULT_DOWNLOAD_EXPIRY = 5 * 60;

export class LocalDiskObjectStorage implements ObjectStorage {
  constructor(private readonly config: LocalDiskConfig) {}

  async presignUpload(opts: {
    bucket: BucketPurpose;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<PresignedUpload> {
    const objectKey = opaqueObjectKey("doc", randomUUID());
    const exp = nowSeconds() + (this.config.uploadExpirySeconds ?? DEFAULT_UPLOAD_EXPIRY);
    const token = this.sign({
      bucket: opts.bucket,
      objectKey,
      op: "upload",
      contentType: opts.contentType,
      maxSizeBytes: opts.maxSizeBytes,
      exp,
    });
    return {
      objectKey,
      url: `${this.requireBaseUrl()}/v1/dev-storage/${token}`,
      expiresAt: new Date(exp * 1000),
      maxSizeBytes: opts.maxSizeBytes,
      allowedContentTypes: [opts.contentType],
    };
  }

  async presignDownload(opts: { bucket: BucketPurpose; objectKey: string }): Promise<{ url: string; expiresAt: Date }> {
    const exp = nowSeconds() + (this.config.downloadExpirySeconds ?? DEFAULT_DOWNLOAD_EXPIRY);
    const token = this.sign({ bucket: opts.bucket, objectKey: opts.objectKey, op: "download", exp });
    return { url: `${this.requireBaseUrl()}/v1/dev-storage/${token}`, expiresAt: new Date(exp * 1000) };
  }

  async head(opts: { bucket: BucketPurpose; objectKey: string }): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    try {
      const s = await stat(this.pathFor(opts.bucket, opts.objectKey));
      return { exists: true, sizeBytes: s.size };
    } catch {
      return { exists: false };
    }
  }

  async delete(opts: { bucket: BucketPurpose; objectKey: string }): Promise<void> {
    await rm(this.pathFor(opts.bucket, opts.objectKey), { force: true });
  }

  /** Verifies and decodes a token issued by presignUpload/presignDownload. */
  verify(token: string): StorageToken {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) throw new Error("malformed token");
    const expectedSig = this.hmac(payloadB64);
    if (sig.length !== expectedSig.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      throw new Error("invalid token signature");
    }
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as StorageToken;
    if (payload.exp < nowSeconds()) throw new Error("token expired");
    return payload;
  }

  /** Writes an incoming request stream to disk, enforcing maxSizeBytes as it streams. */
  async writeStream(bucket: BucketPurpose, objectKey: string, stream: AsyncIterable<Uint8Array>, maxSizeBytes: number): Promise<number> {
    const path = this.pathFor(bucket, objectKey);
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "w");
    let total = 0;
    try {
      for await (const chunk of stream) {
        total += chunk.length;
        if (total > maxSizeBytes) throw new Error("payload too large");
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }
    return total;
  }

  pathFor(bucket: BucketPurpose, objectKey: string): string {
    return join(this.config.rootDir, bucket, objectKey);
  }

  private requireBaseUrl(): string {
    if (!this.config.baseUrl) throw new Error("LocalDiskObjectStorage: baseUrl is required to presign a URL");
    return this.config.baseUrl;
  }

  private sign(payload: StorageToken): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${payloadB64}.${this.hmac(payloadB64)}`;
  }

  private hmac(data: string): string {
    return createHmac("sha256", this.config.secret).update(data).digest("base64url");
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
