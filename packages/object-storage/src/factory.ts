import { LocalDiskObjectStorage, type LocalDiskConfig } from "./local-disk.js";
import { R2ObjectStorage, type R2Config } from "./r2.js";
import type { ObjectStorage } from "./index.js";

/**
 * Picks the real R2 backend when credentials are configured, falling back to
 * the local-disk dev/test stand-in otherwise (docs/24 ADR-12) — shared across
 * apps/api, apps/worker, and apps/cron so the same selection logic (and R2
 * client construction) isn't triplicated at each call site.
 */
export function createObjectStorage(opts: { r2?: R2Config; local: LocalDiskConfig }): ObjectStorage {
  if (opts.r2) return new R2ObjectStorage(opts.r2);
  return new LocalDiskObjectStorage(opts.local);
}
