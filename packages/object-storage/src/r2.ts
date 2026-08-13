import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  type LifecycleRule,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { opaqueObjectKey, type BucketPurpose, type ObjectStorage, type PresignedUpload } from "./index.js";

/**
 * The single lifecycle rule that enforces the backup retention target
 * (Session 17): objects under the given prefix in the backups bucket expire
 * after `days` days. Pure/deterministic so it can be unit-tested and compared
 * against whatever is actually configured remotely. Scoped to the prefix so it
 * can never touch marketing media, patient documents, or any other namespace.
 */
export const BACKUP_LIFECYCLE_RULE_ID = "expire-postgres-backups";
export function buildBackupLifecycleRule(prefix: string, days: number): LifecycleRule {
  return {
    ID: BACKUP_LIFECYCLE_RULE_ID,
    Filter: { Prefix: prefix },
    Status: "Enabled",
    Expiration: { Days: days },
  };
}

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

  async putObjectBytes(opts: { bucket: BucketPurpose; objectKey: string; body: Buffer; contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucketName(opts.bucket), Key: opts.objectKey, Body: opts.body, ContentType: opts.contentType }),
    );
  }

  /** Current lifecycle rules on a bucket (empty array if none configured). */
  async getBucketLifecycle(bucket: BucketPurpose): Promise<LifecycleRule[]> {
    try {
      const res = await this.client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucketName(bucket) }));
      return res.Rules ?? [];
    } catch (err) {
      // R2/S3 returns NoSuchLifecycleConfiguration when nothing is set.
      if (err instanceof Error && /NoSuchLifecycleConfiguration/.test(err.name + err.message)) return [];
      throw err;
    }
  }

  /** Replaces the bucket's lifecycle configuration with exactly these rules. */
  async putBucketLifecycle(bucket: BucketPurpose, rules: LifecycleRule[]): Promise<void> {
    await this.client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: this.bucketName(bucket),
        LifecycleConfiguration: { Rules: rules },
      }),
    );
  }

  /** Lists object keys under a prefix (read-only; for backup-age evidence). */
  async listObjects(bucket: BucketPurpose, prefix: string, maxKeys = 1000): Promise<string[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucketName(bucket), Prefix: prefix, MaxKeys: maxKeys }),
    );
    return (res.Contents ?? []).map((o) => o.Key ?? "").filter(Boolean);
  }
}
