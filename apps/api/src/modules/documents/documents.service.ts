import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, type AuditActorType } from "@medpass/domain";
import { maxBytesFor, type AuthorizeUploadInput } from "@medpass/validation";
import { LocalDiskObjectStorage } from "@medpass/object-storage";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { RateLimitService } from "../../common/rate-limit.service";
import { getObjectStorage } from "../../common/storage";
import { signatureMatches } from "../../common/file-signature";

const BUCKET = "patient-docs" as const;

/**
 * Cost controls (docs/31): a per-profile document storage quota (soft warn,
 * hard cap) and a per-user daily upload count quota — distinct from the
 * per-file size/type limit above, which bounds one upload, not the total
 * or the rate of them. 200 MB comfortably covers docs/31's baseline
 * assumption (~2 uploads/patient/month at ~1–2 MB each) with real headroom;
 * 20/day is generous for a legitimate batch-scanning session while still
 * bounding a genuine runaway/abuse case.
 */
const PROFILE_STORAGE_QUOTA_BYTES = 200 * 1024 * 1024;
const PROFILE_STORAGE_WARN_RATIO = 0.8;
const DAILY_UPLOAD_QUOTA = 20;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async authorizeUpload(
    profileId: string,
    input: AuthorizeUploadInput,
    actor: { userId: string; actorType: AuditActorType; correlationId?: string },
  ) {
    const maxSizeBytes = maxBytesFor(input.contentType);
    if (input.sizeBytes > maxSizeBytes) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "File is too large", 400);
    }

    if (input.prescriptionId) {
      const prescription = await this.prisma.prescription.findFirst({
        where: { id: input.prescriptionId, patientProfileId: profileId, deletedAt: null },
        select: { id: true },
      });
      if (!prescription) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown prescription", 400);
    }

    if (input.reportId) {
      const report = await this.prisma.medicalReport.findFirst({
        where: { id: input.reportId, patientProfileId: profileId, deletedAt: null },
        select: { id: true },
      });
      if (!report) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown report", 400);
    }

    const { allowed: withinDailyQuota } = await this.rateLimit.checkAndIncrement(
      `document_upload_daily:${actor.userId}`,
      DAILY_UPLOAD_QUOTA,
      24 * 60 * 60,
    );
    if (!withinDailyQuota) {
      throw new ApiProblem(ERROR_CODES.RATE_LIMITED, "You've reached today's upload limit. Please try again tomorrow.", 429);
    }

    const currentUsage = await this.profileStorageBytes(profileId);
    if (currentUsage + input.sizeBytes > PROFILE_STORAGE_QUOTA_BYTES) {
      throw new ApiProblem(
        ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
        "You've reached your document storage limit. Contact support if you need more space.",
        400,
      );
    }
    const approachingStorageQuota = currentUsage + input.sizeBytes > PROFILE_STORAGE_QUOTA_BYTES * PROFILE_STORAGE_WARN_RATIO;

    const storage = getObjectStorage();
    const presigned = await storage.presignUpload({ bucket: BUCKET, contentType: input.contentType, maxSizeBytes });

    const document = await this.prisma.$transaction(async (tx) => {
      const storedObject = await tx.storedObject.create({
        data: {
          bucket: "patient_docs",
          objectKey: presigned.objectKey,
          contentType: input.contentType,
          status: "pending",
          expiresAt: presigned.expiresAt,
        },
      });
      const doc = await tx.prescriptionDocument.create({
        data: {
          patientProfileId: profileId,
          storedObjectId: storedObject.id,
          prescriptionId: input.prescriptionId,
          reportId: input.reportId,
          kind: input.kind,
          status: "pending_upload",
        },
      });
      await tx.objectAccessEvent.create({
        data: { storedObjectId: storedObject.id, actorUserId: actor.userId, operation: "presign_upload" },
      });
      await writeAudit(tx, {
        action: "document.upload_authorized",
        actorUserId: actor.userId,
        actorType: actor.actorType,
        entityType: "prescription_document",
        entityId: doc.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { kind: input.kind, contentType: input.contentType },
      });
      return doc;
    });

    return {
      documentId: document.id,
      uploadUrl: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
      approachingStorageQuota,
    };
  }

  /** Sum of verified (actually-stored) document bytes for a profile — pending/quarantined objects don't count yet. */
  private async profileStorageBytes(profileId: string): Promise<number> {
    const result = await this.prisma.storedObject.aggregate({
      where: { status: "verified", document: { patientProfileId: profileId } },
      _sum: { sizeBytes: true },
    });
    return result._sum.sizeBytes ?? 0;
  }

  /**
   * Verifies the object actually exists and matches its declared type/size
   * before trusting the client's "I uploaded it" claim (docs/13 §13.3) —
   * checks the real magic-byte signature, computes a checksum, and only
   * then marks the document usable.
   */
  async completeUpload(
    profileId: string,
    documentId: string,
    actor: { userId: string; actorType: AuditActorType; correlationId?: string },
  ) {
    const doc = await this.prisma.prescriptionDocument.findFirst({
      where: { id: documentId, patientProfileId: profileId },
      include: { storedObject: true },
    });
    if (!doc) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Document not found", 404);
    if (doc.status !== "pending_upload") {
      // Idempotent: a duplicate completion report is a no-op, not an error.
      return { id: doc.id, status: doc.status };
    }

    const storage = getObjectStorage();
    let bytes: Buffer;
    try {
      bytes = await storage.getObjectBytes({ bucket: "patient-docs", objectKey: doc.storedObject.objectKey });
    } catch {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Upload not found — try uploading again", 400);
    }

    const declaredType = doc.storedObject.contentType ?? "";
    const validSignature = signatureMatches(declaredType, bytes.subarray(0, 16));
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    if (!validSignature) {
      // Quarantine must persist even though the request still fails — throwing
      // inside $transaction would roll the flag back and leave the document
      // silently stuck in pending_upload forever, so this commits first.
      await this.prisma.$transaction(async (tx) => {
        await tx.storedObject.update({ where: { id: doc.storedObjectId }, data: { status: "quarantined" } });
        await tx.prescriptionDocument.update({ where: { id: documentId }, data: { status: "quarantined" } });
        await writeAudit(tx, {
          action: "document.upload_completed",
          actorUserId: actor.userId,
          actorType: actor.actorType,
          entityType: "prescription_document",
          entityId: documentId,
          patientProfileId: profileId,
          correlationId: actor.correlationId,
          context: { result: "quarantined_signature_mismatch" },
        });
      });
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This file doesn't look like a valid image or PDF", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.storedObject.update({
        where: { id: doc.storedObjectId },
        data: { status: "verified", sha256, sizeBytes: bytes.length },
      });
      const updated = await tx.prescriptionDocument.update({
        where: { id: documentId },
        data: { status: "uploaded" },
      });
      await writeAudit(tx, {
        action: "document.upload_completed",
        actorUserId: actor.userId,
        actorType: actor.actorType,
        entityType: "prescription_document",
        entityId: documentId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { result: "verified", sizeBytes: bytes.length },
      });
      return { id: updated.id, status: updated.status };
    });
  }

  async downloadUrl(
    profileId: string,
    documentId: string,
    actor: { userId: string; actorType: AuditActorType; correlationId?: string },
  ) {
    const doc = await this.prisma.prescriptionDocument.findFirst({
      where: { id: documentId, patientProfileId: profileId },
      include: { storedObject: true },
    });
    if (!doc || doc.storedObject.status !== "verified") {
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Document not found", 404);
    }
    const storage = getObjectStorage();
    const presigned = await storage.presignDownload({ bucket: "patient-docs", objectKey: doc.storedObject.objectKey });
    await this.prisma.$transaction(async (tx) => {
      await tx.objectAccessEvent.create({
        data: { storedObjectId: doc.storedObjectId, actorUserId: actor.userId, operation: "presign_download" },
      });
      await writeAudit(tx, {
        action: "document.downloaded",
        actorUserId: actor.userId,
        actorType: actor.actorType,
        entityType: "prescription_document",
        entityId: documentId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
    return { url: presigned.url, expiresAt: presigned.expiresAt.toISOString() };
  }

  async list(profileId: string) {
    const docs = await this.prisma.prescriptionDocument.findMany({
      where: { patientProfileId: profileId },
      orderBy: { createdAt: "desc" },
    });
    return docs.map((d) => ({ id: d.id, kind: d.kind, status: d.status, createdAt: d.createdAt.toISOString() }));
  }

  // ---- dev-storage passthrough (docs/26 direct-upload/download flow) ----
  // Only meaningful against the local-disk backend — real R2 presigned URLs
  // point directly at Cloudflare, so these routes are never generated (and
  // never hit) once R2 is configured. Guarded rather than assumed.

  async handleDevUpload(token: string, req: Request): Promise<void> {
    const storage = this.requireLocalDiskStorage();
    let payload;
    try {
      payload = storage.verify(token);
    } catch {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This upload link has expired. Please try again.", 400);
    }
    if (payload.op !== "upload") throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Invalid upload link", 400);
    await storage.writeStream(payload.bucket, payload.objectKey, req, payload.maxSizeBytes ?? 20 * 1024 * 1024);
  }

  async handleDevDownload(token: string, res: Response): Promise<void> {
    const storage = this.requireLocalDiskStorage();
    let payload;
    try {
      payload = storage.verify(token);
    } catch {
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "This link has expired", 404);
    }
    if (payload.op !== "download") throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Invalid link", 404);

    const storedObject = await this.prisma.storedObject.findUnique({ where: { objectKey: payload.objectKey } });
    if (!storedObject) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "File not found", 404);

    const path = storage.pathFor(payload.bucket, payload.objectKey);
    res.setHeader("content-type", storedObject.contentType ?? "application/octet-stream");
    res.setHeader("cache-control", "private, no-store");
    createReadStream(path).pipe(res);
  }

  private requireLocalDiskStorage(): LocalDiskObjectStorage {
    const storage = getObjectStorage();
    if (!(storage instanceof LocalDiskObjectStorage)) {
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "This link has expired", 404);
    }
    return storage;
  }
}
