/**
 * Daily backup health check (docs/27: "checksums, size sanity, freshness —
 * alerts on failure"). Re-downloads the latest backup from R2 and re-hashes
 * it independently — confirming what's actually sitting in R2 still matches
 * what backup-export recorded, not just trusting that record. Doesn't
 * decrypt (verify-backups only needs to prove the object exists, is the
 * right size, and hasn't been tampered with/corrupted at rest — decryption
 * + restorability is restore-test's job, monthly, since it's much more
 * expensive).
 */
import { createHash } from "node:crypto";
import { createObjectStorage } from "@medpass/object-storage";
import { runJob } from "../lib/run-job";

const MAX_BACKUP_AGE_HOURS = 25;

runJob("verify-backups", async ({ prisma, log, config }) => {
  const latest = await prisma.backupExecution.findFirst({ where: { status: "succeeded" }, orderBy: { completedAt: "desc" } });
  if (!latest || !latest.objectKey) {
    log.error({}, "no successful backup found — DR compliance is out until one exists (docs/29 non-negotiable)");
    return { ok: false, reason: "no_backup" };
  }

  const ageHours = (Date.now() - (latest.completedAt?.getTime() ?? 0)) / (60 * 60 * 1000);
  if (ageHours > MAX_BACKUP_AGE_HOURS) {
    log.error({ backupExecutionId: latest.id, ageHours }, "latest backup is stale");
    return { ok: false, reason: "stale", ageHours };
  }

  if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET_PREFIX) {
    log.info({}, "R2 not configured — nothing to verify against");
    return { ok: false, reason: "r2_not_configured" };
  }
  const storage = createObjectStorage({
    r2: {
      accountId: config.R2_ACCOUNT_ID,
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
      bucketPrefix: config.R2_BUCKET_PREFIX,
    },
    local: { rootDir: ".dev-data/object-storage", secret: "unused-for-backups" },
  });

  const head = await storage.head({ bucket: "backups", objectKey: latest.objectKey });
  if (!head.exists) {
    log.error({ backupExecutionId: latest.id, objectKey: latest.objectKey }, "backup object recorded but missing from R2");
    return { ok: false, reason: "missing_object" };
  }
  if (head.sizeBytes !== latest.sizeBytes) {
    log.error({ backupExecutionId: latest.id, recorded: latest.sizeBytes, actual: head.sizeBytes }, "backup size mismatch");
    return { ok: false, reason: "size_mismatch" };
  }

  const bytes = await storage.getObjectBytes({ bucket: "backups", objectKey: latest.objectKey });
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== latest.sha256) {
    log.error({ backupExecutionId: latest.id }, "backup checksum mismatch — possible corruption");
    return { ok: false, reason: "checksum_mismatch" };
  }

  log.info({ backupExecutionId: latest.id, ageHours: Math.round(ageHours * 10) / 10 }, "latest backup verified: fresh, present, checksum matches");
  return { ok: true, backupExecutionId: latest.id };
});
