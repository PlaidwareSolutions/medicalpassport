import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createObjectStorage, type ObjectStorage } from "@medpass/object-storage";
import { env } from "./env";

let storage: ObjectStorage | undefined;

/**
 * Real Cloudflare R2 when R2_* is fully configured (docs/26 §13, Stage 11
 * follow-up); otherwise the local-disk stand-in (docs/24 ADR-12). The HMAC
 * secret for the local-disk backend is derived from FIELD_ENCRYPTION_KEY
 * rather than requiring a separate dev-only secret.
 */
export function getObjectStorage(): ObjectStorage {
  if (!storage) {
    const config = env();
    const r2 =
      config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY && config.R2_BUCKET_PREFIX
        ? {
            accountId: config.R2_ACCOUNT_ID,
            accessKeyId: config.R2_ACCESS_KEY_ID,
            secretAccessKey: config.R2_SECRET_ACCESS_KEY,
            bucketPrefix: config.R2_BUCKET_PREFIX,
          }
        : undefined;
    storage = createObjectStorage({
      r2,
      local: {
        rootDir: resolve(process.cwd(), config.OBJECT_STORAGE_ROOT),
        baseUrl: config.OBJECT_STORAGE_BASE_URL ?? `http://localhost:${config.PORT}`,
        secret: createHash("sha256").update(config.FIELD_ENCRYPTION_KEY + ":object-storage").digest("hex"),
      },
    });
  }
  return storage;
}
