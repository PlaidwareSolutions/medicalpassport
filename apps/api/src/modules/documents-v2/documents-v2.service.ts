import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { DocumentKind, Prisma, PrismaClient } from "@medpass/database";
import { DETERMINISTIC_CLASSIFIER_VERSION } from "@medpass/document-intelligence";
import { emitHealthEvent, projectDocument, supersedeHealthEvents } from "@medpass/health-events";
import {
  maxBytesForPage,
  MAX_DOCUMENT_PAGES,
  type AuthorizeDocumentPagesInput,
  type CreateDocumentV2Input,
  type DocumentListQuery,
  type DocumentPageUploadInput,
  type UpdateDocumentV2Input,
} from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { eventCtx } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import { signatureMatches } from "../../common/file-signature";
import { stampProvenanceFor, type ProvenanceActor } from "../../common/provenance-actor";
import { RateLimitService } from "../../common/rate-limit.service";
import { getObjectStorage } from "../../common/storage";
import { emitProductEvent } from "../product-events/product-events.service";

export interface DocumentActor extends ProvenanceActor {
  correlationId?: string;
  /** The caller's UI locale — a product-metrics dimension only, never stored on the row. */
  locale?: string;
}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * V2 documents carry their own timeline entity type so a backfilled V1
 * `PrescriptionDocument` event and its V2 twin never collide on the
 * `(entityType, entityId, kind, occurredAt)` key (docs_v2/04 §9.2).
 */
export const DOCUMENT_EVENT_ENTITY_TYPE = "patient_document";

/** Same cost controls as V1 documents (docs/31), now counted per page. */
const PROFILE_STORAGE_QUOTA_BYTES = 200 * 1024 * 1024;
const PROFILE_STORAGE_WARN_RATIO = 0.8;
const DAILY_PAGE_QUOTA = 60;

/**
 * V2 documents (docs_v2/05 §5, docs_v2/04 §7). A document is a *set of pages*
 * with one classification and one attachment point, uploaded page by page and
 * classified asynchronously. V1's `PrescriptionDocument` endpoints keep
 * running untouched alongside these (docs_v2/05 §15 sunsets them at V2.5).
 *
 * Nothing in this service writes a clinical row. Extraction candidates become
 * clinical data through exactly one function, `materializeCandidate`
 * (docs_v2/09 §1 rule 3), and a test asserts no second writer exists.
 */
@Injectable()
export class DocumentsV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // -------------------------------------------------------------------------
  // Create + page uploads
  // -------------------------------------------------------------------------

  async create(profileId: string, input: CreateDocumentV2Input, actor: DocumentActor) {
    await this.requireLinks(this.prisma, profileId, input);
    const { approachingStorageQuota } = await this.checkQuotas(profileId, actor.userId, input.pages);

    const authorizations = await this.presign(input.pages);

    const documentId = await this.prisma.$transaction(async (tx) => {
      const document = await tx.patientDocument.create({
        data: {
          patientProfileId: profileId,
          // A kind the person picked at capture time is already their choice —
          // the classifier may describe the document but never re-label it
          // (docs_v2/09 §4).
          kind: (input.kind as DocumentKind | undefined) ?? "other",
          classifiedBy: input.kind ? "user" : null,
          title: input.title ?? null,
          documentDate: input.documentDate ?? null,
          sourceChannel: input.sourceChannel,
          prescriptionId: input.prescriptionId ?? null,
          diagnosticReportId: input.diagnosticReportId ?? null,
          encounterId: input.encounterId ?? null,
          immunizationId: input.immunizationId ?? null,
          status: "pending_upload",
          ...stampProvenanceFor(actor),
        },
      });
      await this.attachPages(tx, document.id, 0, authorizations, actor.userId);
      await writeAudit(tx, {
        action: "document.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: DOCUMENT_EVENT_ENTITY_TYPE,
        entityId: document.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { pages: authorizations.length, sourceChannel: input.sourceChannel, kind: input.kind ?? null },
      });
      return document.id;
    });

    return {
      ...(await this.byId(profileId, documentId, { withUrls: false })),
      pages: authorizations.map((a, index) => ({
        pageNumber: index + 1,
        uploadUrl: a.url,
        expiresAt: a.expiresAt.toISOString(),
      })),
      approachingStorageQuota,
    };
  }

  /** Adds pages to a document that already exists — a second capture pass, or a page that failed to upload. */
  async authorizePages(profileId: string, documentId: string, input: AuthorizeDocumentPagesInput, actor: DocumentActor) {
    const document = await this.requireDocument(profileId, documentId);
    const existing = await this.prisma.documentPage.count({ where: { documentId } });
    if (existing + input.pages.length > MAX_DOCUMENT_PAGES) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, `A document can hold at most ${MAX_DOCUMENT_PAGES} pages`, 400);
    }
    const { approachingStorageQuota } = await this.checkQuotas(profileId, actor.userId, input.pages);
    const authorizations = await this.presign(input.pages);

    await this.prisma.$transaction(async (tx) => {
      await this.attachPages(tx, document.id, existing, authorizations, actor.userId);
      // More pages are coming, so a document that had already finished
      // uploading goes back to waiting rather than looking complete.
      await tx.patientDocument.update({ where: { id: document.id }, data: { status: "pending_upload" } });
      await writeAudit(tx, {
        action: "document.pages_authorized",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: DOCUMENT_EVENT_ENTITY_TYPE,
        entityId: document.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { pages: authorizations.length, firstPageNumber: existing + 1 },
      });
    });

    return {
      documentId: document.id,
      pages: authorizations.map((a, index) => ({
        pageNumber: existing + index + 1,
        uploadUrl: a.url,
        expiresAt: a.expiresAt.toISOString(),
      })),
      approachingStorageQuota,
    };
  }

  /**
   * Verifies one uploaded page exactly as V1 verifies its single object
   * (docs/13 §13.3): the real magic-byte signature, then a sha256 over the
   * stored bytes. A mismatch quarantines the object — committed on its own so
   * the 400 cannot roll the flag back — and the page never becomes readable.
   *
   * When the last authorized page lands, the document is `uploaded` and one
   * `document_classify` job is enqueued for the whole document. Classification
   * runs once per document, not per page, so a candidate can never be
   * attributed to the wrong page-set (H-36).
   */
  async completePage(profileId: string, documentId: string, pageNumber: number, actor: DocumentActor) {
    const document = await this.requireDocument(profileId, documentId);
    const page = await this.prisma.documentPage.findFirst({
      where: { documentId: document.id, pageNumber },
      include: { storedObject: true },
    });
    if (!page) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Page not found", 404);
    if (page.storedObject.status === "verified") {
      // Idempotent: a duplicate completion report is a no-op, not an error.
      return this.pageCompletionResult(profileId, document.id);
    }
    if (page.storedObject.status === "quarantined") {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This file doesn't look like a valid image or PDF", 400);
    }

    const storage = getObjectStorage();
    let bytes: Buffer;
    try {
      bytes = await storage.getObjectBytes({ bucket: "patient-docs", objectKey: page.storedObject.objectKey });
    } catch {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Upload not found — try uploading again", 400);
    }

    const declaredType = page.storedObject.contentType ?? "";
    if (!signatureMatches(declaredType, bytes.subarray(0, 16))) {
      await this.prisma.$transaction(async (tx) => {
        await tx.storedObject.update({ where: { id: page.storedObjectId }, data: { status: "quarantined" } });
        await tx.patientDocument.update({ where: { id: document.id }, data: { status: "quarantined" } });
        await writeAudit(tx, {
          action: "document.page_completed",
          actorUserId: actor.userId,
          actorType: actor.actorRole,
          entityType: DOCUMENT_EVENT_ENTITY_TYPE,
          entityId: document.id,
          patientProfileId: profileId,
          correlationId: actor.correlationId,
          context: { pageNumber, result: "quarantined_signature_mismatch" },
        });
      });
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This file doesn't look like a valid image or PDF", 400);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await this.prisma.$transaction(async (tx) => {
      await tx.storedObject.update({
        where: { id: page.storedObjectId },
        data: { status: "verified", sha256, sizeBytes: bytes.length },
      });
      const pages = await tx.documentPage.findMany({
        where: { documentId: document.id },
        include: { storedObject: { select: { status: true, sha256: true } } },
        orderBy: { pageNumber: "asc" },
      });
      const verified = pages.filter((p) => p.storedObject.status === "verified");
      const allIn = verified.length === pages.length;

      const updated = await tx.patientDocument.update({
        where: { id: document.id },
        data: { pageCount: verified.length, ...(allIn ? { status: "uploaded" as const } : {}) },
      });
      await writeAudit(tx, {
        action: "document.page_completed",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: DOCUMENT_EVENT_ENTITY_TYPE,
        entityId: document.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { pageNumber, result: "verified", sizeBytes: bytes.length, pagesVerified: verified.length },
      });

      if (allIn) {
        // The document exists on the patient's timeline the moment it is
        // whole — before, and independent of, anything the classifier says.
        await emitHealthEvent(tx, {
          ...projectDocument(await eventCtx(tx, profileId, actor), {
            ...updated,
            kind: updated.kind,
            reportId: updated.diagnosticReportId,
          }),
          entityType: DOCUMENT_EVENT_ENTITY_TYPE,
        });
        await this.enqueueClassify(tx, {
          documentId: document.id,
          profileId,
          actor,
          digest: contentDigest(verified.map((p) => p.storedObject.sha256 ?? "")),
        });
        // Product metrics (docs_v2/06 P1-7): once, when the document is whole
        // — the declared kind enum and the page count, never a title or a byte.
        emitProductEvent({
          name: "engagement.document_uploaded",
          userId: actor.userId,
          profileId,
          correlationId: actor.correlationId,
          clientKind: actor.recordedVia,
          locale: actor.locale,
          properties: { kind: updated.kind, pageCount: verified.length },
        });
      }
    });

    return this.pageCompletionResult(profileId, document.id);
  }

  /**
   * Re-runs classification and extraction (docs_v2/05 §5
   * `documents/:id/process`). Idempotent by content hash plus engine version:
   * the same pages under the same classifier version reuse the existing job
   * rather than queueing a second one.
   */
  async process(profileId: string, documentId: string, actor: DocumentActor) {
    const document = await this.requireDocument(profileId, documentId);
    const pages = await this.prisma.documentPage.findMany({
      where: { documentId: document.id },
      include: { storedObject: { select: { status: true, sha256: true } } },
      orderBy: { pageNumber: "asc" },
    });
    if (pages.length === 0 || pages.some((p) => p.storedObject.status !== "verified")) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This document hasn't finished uploading yet", 400);
    }
    await this.enqueueClassify(this.prisma, {
      documentId: document.id,
      profileId,
      actor,
      digest: contentDigest(pages.map((p) => p.storedObject.sha256 ?? "")),
    });
    return this.byId(profileId, document.id);
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async byId(profileId: string, documentId: string, options: { withUrls?: boolean } = {}) {
    const document = await this.prisma.patientDocument.findFirst({
      where: { id: documentId, patientProfileId: profileId, deletedAt: null },
      include: {
        pages: { orderBy: { pageNumber: "asc" }, include: { storedObject: true } },
        extractions: { orderBy: { createdAt: "desc" }, take: 1, include: { _count: { select: { candidates: true } } } },
      },
    });
    if (!document) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Document not found", 404);

    const withUrls = options.withUrls !== false;
    const storage = getObjectStorage();
    const pages = [];
    for (const page of document.pages) {
      const downloadable = page.storedObject.status === "verified";
      // Short-lived and minted per request (docs_v2/09 §9): a URL is never
      // stored, so a stale link cannot outlive the read that produced it.
      const presigned =
        withUrls && downloadable
          ? await storage.presignDownload({ bucket: "patient-docs", objectKey: page.storedObject.objectKey })
          : null;
      pages.push({
        pageNumber: page.pageNumber,
        status: page.storedObject.status,
        contentType: page.storedObject.contentType,
        sizeBytes: page.storedObject.sizeBytes,
        sha256: page.storedObject.sha256,
        width: page.width,
        height: page.height,
        rotation: page.rotation,
        downloadUrl: presigned?.url ?? null,
        downloadUrlExpiresAt: presigned?.expiresAt.toISOString() ?? null,
      });
    }

    const latest = document.extractions[0];
    return {
      id: document.id,
      kind: document.kind,
      title: document.title,
      documentDate: document.documentDate?.toISOString().slice(0, 10) ?? null,
      status: document.status,
      sourceChannel: document.sourceChannel,
      pageCount: document.pageCount,
      prescriptionId: document.prescriptionId,
      diagnosticReportId: document.diagnosticReportId,
      encounterId: document.encounterId,
      immunizationId: document.immunizationId,
      legacyPrescriptionDocumentId: document.legacyPrescriptionDocumentId,
      classification: {
        kind: document.classification,
        confidence: document.classificationConfidence == null ? null : Number(document.classificationConfidence),
        classifiedBy: document.classifiedBy,
      },
      provenance: {
        source: document.provenanceSource,
        verification: document.verification,
        recordedVia: document.recordedVia,
        recordedAt: document.createdAt.toISOString(),
        sourceDocumentId: document.sourceDocumentId,
      },
      extraction: latest
        ? {
            id: latest.id,
            status: latest.status,
            engine: latest.engine,
            engineVersion: latest.engineVersion,
            candidateCount: latest._count.candidates,
            finishedAt: latest.finishedAt?.toISOString() ?? null,
          }
        : null,
      pages,
      createdAt: document.createdAt.toISOString(),
    };
  }

  /** Newest first, keyset paginated on `(createdAt, id)` like the health timeline. */
  async list(profileId: string, query: DocumentListQuery) {
    const where: Prisma.PatientDocumentWhereInput = {
      patientProfileId: profileId,
      deletedAt: null,
      ...(query.kind ? { kind: query.kind as DocumentKind } : {}),
    };
    if (query.cursor) {
      const { createdAt, id } = decodeCursor(query.cursor);
      where.OR = [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }];
    }
    const rows = await this.prisma.patientDocument.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      include: { extractions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } } },
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.title,
        documentDate: d.documentDate?.toISOString().slice(0, 10) ?? null,
        status: d.status,
        pageCount: d.pageCount,
        sourceChannel: d.sourceChannel,
        classification: {
          kind: d.classification,
          confidence: d.classificationConfidence == null ? null : Number(d.classificationConfidence),
          classifiedBy: d.classifiedBy,
        },
        prescriptionId: d.prescriptionId,
        diagnosticReportId: d.diagnosticReportId,
        encounterId: d.encounterId,
        extractionStatus: d.extractions[0]?.status ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  // -------------------------------------------------------------------------
  // Update + delete
  // -------------------------------------------------------------------------

  /**
   * The patient's override (docs_v2/09 §4). Setting `kind` here is a decision,
   * not a suggestion: `classifiedBy` becomes `user` and the classifier is
   * permanently barred from moving `kind` again on this document. The
   * classifier's own opinion stays visible in `classification` for metrics.
   */
  async update(profileId: string, documentId: string, input: UpdateDocumentV2Input, actor: DocumentActor) {
    const document = await this.requireDocument(profileId, documentId);
    await this.requireLinks(this.prisma, profileId, input);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.patientDocument.update({
        where: { id: document.id },
        data: {
          ...(input.kind !== undefined ? { kind: input.kind as DocumentKind, classifiedBy: "user" as const } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.documentDate !== undefined ? { documentDate: input.documentDate } : {}),
          ...(input.prescriptionId !== undefined ? { prescriptionId: input.prescriptionId } : {}),
          ...(input.diagnosticReportId !== undefined ? { diagnosticReportId: input.diagnosticReportId } : {}),
          ...(input.encounterId !== undefined ? { encounterId: input.encounterId } : {}),
          ...(input.immunizationId !== undefined ? { immunizationId: input.immunizationId } : {}),
        },
      });
      await writeAudit(tx, {
        action: "document.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: DOCUMENT_EVENT_ENTITY_TYPE,
        entityId: document.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { fields: Object.keys(input), kindChosenByUser: input.kind !== undefined },
      });
      // The kind and the date are what the timeline entry says, so a
      // correction replaces the old event rather than sitting beside it.
      if (updated.status !== "pending_upload") {
        await supersedeHealthEvents(tx, DOCUMENT_EVENT_ENTITY_TYPE, document.id);
        await emitHealthEvent(tx, {
          ...projectDocument(await eventCtx(tx, profileId, actor), {
            ...updated,
            reportId: updated.diagnosticReportId,
          }),
          entityType: DOCUMENT_EVENT_ENTITY_TYPE,
        });
      }
    });
    return this.byId(profileId, document.id);
  }

  /**
   * Soft delete only (docs_v2/09 §1 rule 1): the stored originals are kept and
   * removed by the retention policy, never by this call. Candidates already
   * materialized keep pointing at the document as their evidence.
   */
  async softDelete(profileId: string, documentId: string, actor: DocumentActor) {
    const document = await this.requireDocument(profileId, documentId);
    await this.prisma.$transaction(async (tx) => {
      await tx.patientDocument.update({ where: { id: document.id }, data: { deletedAt: new Date(), status: "deleted" } });
      await supersedeHealthEvents(tx, DOCUMENT_EVENT_ENTITY_TYPE, document.id);
      await writeAudit(tx, {
        action: "document.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: DOCUMENT_EVENT_ENTITY_TYPE,
        entityId: document.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** A document is reachable only through its own profile — a foreign id is a 404, never a peek. */
  async requireDocument(profileId: string, documentId: string) {
    const document = await this.prisma.patientDocument.findFirst({
      where: { id: documentId, patientProfileId: profileId, deletedAt: null },
    });
    if (!document) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Document not found", 404);
    return document;
  }

  private async presign(pages: DocumentPageUploadInput[]) {
    const storage = getObjectStorage();
    const authorizations = [];
    for (const page of pages) {
      const maxSizeBytes = maxBytesForPage(page.contentType);
      if (page.sizeBytes > maxSizeBytes) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "File is too large", 400);
      }
      authorizations.push({
        ...(await storage.presignUpload({ bucket: "patient-docs", contentType: page.contentType, maxSizeBytes })),
        contentType: page.contentType,
      });
    }
    return authorizations;
  }

  private async attachPages(
    tx: Tx,
    documentId: string,
    startingAfter: number,
    authorizations: Array<{ objectKey: string; expiresAt: Date; contentType: string }>,
    actorUserId: string,
  ): Promise<void> {
    for (const [index, authorization] of authorizations.entries()) {
      const storedObject = await tx.storedObject.create({
        data: {
          bucket: "patient_docs",
          objectKey: authorization.objectKey,
          contentType: authorization.contentType,
          status: "pending",
          expiresAt: authorization.expiresAt,
        },
      });
      await tx.documentPage.create({
        data: { documentId, pageNumber: startingAfter + index + 1, storedObjectId: storedObject.id },
      });
      await tx.objectAccessEvent.create({
        data: { storedObjectId: storedObject.id, actorUserId, operation: "presign_upload" },
      });
    }
  }

  private async pageCompletionResult(profileId: string, documentId: string) {
    const document = await this.prisma.patientDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { id: true, status: true, pageCount: true, _count: { select: { pages: true } } },
    });
    return {
      id: document.id,
      status: document.status,
      pageCount: document.pageCount,
      pagesAuthorized: document._count.pages,
      profileId,
    };
  }

  private async enqueueClassify(
    tx: Tx,
    params: { documentId: string; profileId: string; actor: DocumentActor; digest: string },
  ): Promise<void> {
    const jobKey = `document-classify:${params.documentId}:${params.digest}:${DETERMINISTIC_CLASSIFIER_VERSION}`;
    const existing = await tx.backgroundJob.findUnique({ where: { jobKey }, select: { id: true } });
    if (existing) return;
    await tx.backgroundJob.create({
      data: {
        queue: "document_classify",
        jobKey,
        payload: {
          documentId: params.documentId,
          profileId: params.profileId,
          actorUserId: params.actor.userId,
          actorType: params.actor.actorRole,
          correlationId: params.actor.correlationId,
        },
        correlationId: params.actor.correlationId,
      },
    });
    await tx.patientDocument.update({ where: { id: params.documentId }, data: { status: "processing" } });
  }

  /** Every named parent must belong to this profile, or the link is a 400 rather than a silent cross-profile edge. */
  private async requireLinks(
    tx: Tx,
    profileId: string,
    input: { prescriptionId?: string | null; diagnosticReportId?: string | null; encounterId?: string | null; immunizationId?: string | null },
  ): Promise<void> {
    if (input.prescriptionId) {
      const row = await tx.prescription.findFirst({
        where: { id: input.prescriptionId, patientProfileId: profileId, deletedAt: null },
        select: { id: true },
      });
      if (!row) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown prescription", 400);
    }
    if (input.diagnosticReportId) {
      const row = await tx.diagnosticReport.findFirst({
        where: { id: input.diagnosticReportId, patientProfileId: profileId, deletedAt: null },
        select: { id: true },
      });
      if (!row) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown report", 400);
    }
    if (input.encounterId) {
      const row = await tx.encounter.findFirst({
        where: { id: input.encounterId, patientProfileId: profileId, deletedAt: null },
        select: { id: true },
      });
      if (!row) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown encounter", 400);
    }
    if (input.immunizationId) {
      const row = await tx.immunization.findFirst({
        where: { id: input.immunizationId, patientProfileId: profileId, deletedAt: null },
        select: { id: true },
      });
      if (!row) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown immunization", 400);
    }
  }

  private async checkQuotas(profileId: string, userId: string, pages: DocumentPageUploadInput[]) {
    const { allowed } = await this.rateLimit.checkAndIncrement(
      `document_page_daily:${userId}`,
      DAILY_PAGE_QUOTA,
      24 * 60 * 60,
      pages.length,
    );
    if (!allowed) {
      throw new ApiProblem(ERROR_CODES.RATE_LIMITED, "You've reached today's upload limit. Please try again tomorrow.", 429);
    }
    const declared = pages.reduce((sum, p) => sum + p.sizeBytes, 0);
    const used = await this.profileStorageBytes(profileId);
    if (used + declared > PROFILE_STORAGE_QUOTA_BYTES) {
      throw new ApiProblem(
        ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
        "You've reached your document storage limit. Contact support if you need more space.",
        400,
      );
    }
    return { approachingStorageQuota: used + declared > PROFILE_STORAGE_QUOTA_BYTES * PROFILE_STORAGE_WARN_RATIO };
  }

  /** Verified bytes only — a pending or quarantined object holds nothing yet. */
  private async profileStorageBytes(profileId: string): Promise<number> {
    const v1 = await this.prisma.storedObject.aggregate({
      where: { status: "verified", document: { patientProfileId: profileId } },
      _sum: { sizeBytes: true },
    });
    const v2 = await this.prisma.storedObject.aggregate({
      where: { status: "verified", documentPages: { some: { document: { patientProfileId: profileId } } } },
      _sum: { sizeBytes: true },
    });
    return (v1._sum.sizeBytes ?? 0) + (v2._sum.sizeBytes ?? 0);
  }
}

/** Stable over page content, so re-processing identical pages reuses the queued job. */
export function contentDigest(sha256s: string[]): string {
  return createHash("sha256").update(sha256s.join("|")).digest("hex").slice(0, 32);
}

/** Opaque keyset cursor: base64url of `createdAt|id`, newest first. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = decoded.indexOf("|");
  const createdAt = sep > 0 ? new Date(decoded.slice(0, sep)) : new Date(NaN);
  const id = sep > 0 ? decoded.slice(sep + 1) : "";
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Invalid cursor", 400);
  }
  return { createdAt, id };
}
