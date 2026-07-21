import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { opaqueObjectKey, type BucketPurpose, type ObjectStorage, type PresignedUpload } from "./index.js";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Real bucket name = `${bucketPrefix}${purpose}`, e.g. "medpass-dev-" + "patient-docs" (docs/26 §13's per-environment prefix, adapted for a shared Cloudflare account hosting multiple unrelated projects). */
  bucketPrefix: string;
  uploadExpirySeconds?: number;
  downloadExpirySeconds?: number;
}

const DEFAULT_UPLOAD_EXPIRY = 10 * 60;
const DEFAULT_DOWNLOAD_EXPIRY = 5 * 60;

/** Real Cloudflare R2 backend (docs/26 §13), via R2's S3-compatible API. */
export class R2ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  private bucketName(purpose: BucketPurpose): string {
    return `${this.config.bucketPrefix}${purpose}`;
  }

  async presignUpload(opts: { bucket: BucketPurpose; contentType: string; maxSizeBytes: number }): Promise<PresignedUpload> {
    const objectKey = opaqueObjectKey("doc", randomUUID());
    const expiresIn = this.config.uploadExpirySeconds ?? DEFAULT_UPLOAD_EXPIRY;
    const command = new PutObjectCommand({
      Bucket: this.bucketName(opts.bucket),
      Key: objectKey,
      ContentType: opts.contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return {
      objectKey,
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      maxSizeBytes: opts.maxSizeBytes,
      allowedContentTypes: [opts.contentType],
    };
  }

  async presignDownload(opts: { bucket: BucketPurpose; objectKey: string }): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = this.config.downloadExpirySeconds ?? DEFAULT_DOWNLOAD_EXPIRY;
    const command = new GetObjectCommand({ Bucket: this.bucketName(opts.bucket), Key: opts.objectKey });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async head(opts: { bucket: BucketPurpose; objectKey: string }): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName(opts.bucket), Key: opts.objectKey }));
      return { exists: true, sizeBytes: result.ContentLength, contentType: result.ContentType };
    } catch {
      return { exists: false };
    }
  }

  async delete(opts: { bucket: BucketPurpose; objectKey: string }): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName(opts.bucket), Key: opts.objectKey }));
  }

  async getObjectBytes(opts: { bucket: BucketPurpose; objectKey: string }): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucketName(opts.bucket), Key: opts.objectKey }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`R2 object not found: ${opts.bucket}/${opts.objectKey}`);
    return Buffer.from(bytes);
  }
}
