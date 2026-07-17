/**
 * Reclaims storage from uploads that never finished (docs/13 §13.3): a
 * presigned URL was issued but the upload/verify step never completed
 * before it expired, or a file was quarantined for a bad signature and has
 * sat past its retention window. Deletes the physical object via the same
 * `ObjectStorage` interface production R2 will use, then marks both the
 * stored object and its document row `deleted` rather than hard-deleting —
 * matching docs/25's initial cron schedule (hourly).
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { LocalDiskObjectStorage, type BucketPurpose } from "@medpass/object-storage";
import { runJob } from "../lib/run-job";

const QUARANTINE_RETENTION_DAYS = 7;

const BUCKET_PURPOSE: Record<string, BucketPurpose> = {
  patient_docs: "patient-docs",
  ocr_tmp: "ocr-tmp",
};

runJob("cleanup-abandoned-uploads", async ({ prisma, log, config }) => {
  const storage = new LocalDiskObjectStorage({
    rootDir: resolve(process.cwd(), config.OBJECT_STORAGE_ROOT),
    secret: createHash("sha256").update(config.FIELD_ENCRYPTION_KEY + ":object-storage").digest("hex"),
  });

  const quarantineCutoff = new Date(Date.now() - QUARANTINE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.storedObject.findMany({
    where: {
      OR: [
        { status: "pending", expiresAt: { lt: new Date() } },
        { status: "quarantined", createdAt: { lt: quarantineCutoff } },
      ],
    },
    include: { document: true },
  });

  let deleted = 0;
  for (const obj of stale) {
    const bucket = BUCKET_PURPOSE[obj.bucket];
    if (!bucket) {
      log.error({ storedObjectId: obj.id, bucket: obj.bucket }, "unknown bucket — skipping");
      continue;
    }
    await storage.delete({ bucket, objectKey: obj.objectKey });
    await prisma.$transaction([
      prisma.storedObject.update({ where: { id: obj.id }, data: { status: "deleted" } }),
      ...(obj.document
        ? [prisma.prescriptionDocument.update({ where: { id: obj.document.id }, data: { status: "deleted" } })]
        : []),
    ]);
    deleted++;
  }

  log.info({ deleted, scanned: stale.length }, "cleaned up abandoned uploads");
  return { deleted };
});
