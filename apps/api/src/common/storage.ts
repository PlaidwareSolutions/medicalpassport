import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { LocalDiskObjectStorage } from "@medpass/object-storage";
import { env } from "./env";

let storage: LocalDiskObjectStorage | undefined;

/**
 * Local-disk object storage (docs/24 ADR-12) — a documented dev-only stand-in
 * for Cloudflare R2. The HMAC secret is derived from FIELD_ENCRYPTION_KEY
 * rather than requiring a separate dev-only secret.
 */
export function getObjectStorage(): LocalDiskObjectStorage {
  if (!storage) {
    const config = env();
    storage = new LocalDiskObjectStorage({
      rootDir: resolve(process.cwd(), config.OBJECT_STORAGE_ROOT),
      baseUrl: config.OBJECT_STORAGE_BASE_URL ?? `http://localhost:${config.PORT}`,
      secret: createHash("sha256").update(config.FIELD_ENCRYPTION_KEY + ":object-storage").digest("hex"),
    });
  }
  return storage;
}
