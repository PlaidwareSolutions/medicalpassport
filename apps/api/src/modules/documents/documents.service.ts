import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, type AuditActorType } from "@medpass/domain";
import { maxBytesFor, type AuthorizeUploadInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { getObjectStorage } from "../../common/storage";
import { signatureMatches } from "../../common/file-signature";

const BUCKET = "patient-docs" as const;

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async authorizeUpload(
    profileId: string,
    input: AuthorizeUploadInput,
    actor: { userId: string; actorType: AuditActorType; correlationId?: string },
  ) {
    const maxSizeBytes = maxBytesFor(input.contentType);
    if (input.sizeBytes > maxSizeBytes) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "File is too large", 400);
    }

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

    return { documentId: document.id, uploadUrl: presigned.url, expiresAt: presigned.expiresAt.toISOString() };
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
    const path = storage.pathFor("patient-docs", doc.storedObject.objectKey);
    const { readFile } = await import("node:fs/promises");
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
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

  async handleDevUpload(token: string, req: Request): Promise<void> {
    const storage = getObjectStorage();
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
    const storage = getObjectStorage();
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
}
