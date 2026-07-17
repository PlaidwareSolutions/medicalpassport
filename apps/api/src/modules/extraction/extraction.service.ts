import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, FREQUENCY_CODES, type AuditActorType, type FrequencyCode } from "@medpass/domain";
import type { CreateMedicationFromExtractionInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { getObjectStorage } from "../../common/storage";
import { MedicationsService } from "../medications/medications.service";
import { detectCandidates } from "./candidate-detection";
import { OCR_ENGINE, OCR_ENGINE_VERSION, runOcr } from "./ocr";

interface Actor {
  userId: string;
  actorType: AuditActorType;
  correlationId?: string;
}

const CANDIDATE_INCLUDE = { candidates: { orderBy: { field: "asc" as const } } };

@Injectable()
export class ExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly medications: MedicationsService,
  ) {}

  /**
   * Runs OCR synchronously in-request (docs/22 Stage 3/8 simplification —
   * a real deployment would push this to the worker queue so a slow scan
   * doesn't hold an HTTP connection open). Never fabricates values: every
   * candidate keeps the exact OCR line it came from alongside a confidence
   * score, and nothing here is scheduled or shown as fact until the patient
   * confirms it (docs/09 §6).
   */
  async process(profileId: string, documentId: string, actor: Actor) {
    const doc = await this.prisma.prescriptionDocument.findFirst({
      where: { id: documentId, patientProfileId: profileId },
      include: { storedObject: true },
    });
    if (!doc) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Document not found", 404);
    if (doc.storedObject.status !== "verified") {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This document hasn't finished uploading yet", 400);
    }

    const extraction = await this.prisma.prescriptionExtraction.create({
      data: { prescriptionDocumentId: documentId, engine: OCR_ENGINE, engineVersion: OCR_ENGINE_VERSION, status: "running" },
    });
    await this.prisma.prescriptionDocument.update({ where: { id: documentId }, data: { status: "processing" } });

    try {
      const storage = getObjectStorage();
      const path = storage.pathFor("patient-docs", doc.storedObject.objectKey);
      const rawText = await runOcr(path);

      const products = await this.prisma.medicationProduct.findMany({
        where: { status: "active" },
        include: { brand: true },
      });
      const catalog = products.map((p) => ({
        id: p.id,
        brandName: p.brand?.name ?? null,
        brandAliases: p.brand?.aliases ?? [],
        genericName: p.genericName,
      }));
      const candidates = detectCandidates(rawText, catalog);

      await this.prisma.$transaction(async (tx) => {
        await tx.prescriptionExtraction.update({
          where: { id: extraction.id },
          data: { status: "succeeded", rawText, completedAt: new Date() },
        });
        for (const c of candidates) {
          await tx.extractionCandidate.create({
            data: {
              extractionId: extraction.id,
              field: c.field,
              detectedText: c.detectedText,
              proposedValue: c.proposedValue,
              confidence: c.confidence,
            },
          });
        }
        await tx.prescriptionDocument.update({ where: { id: documentId }, data: { status: "processed" } });
        await writeAudit(tx, {
          action: "extraction.processed",
          actorUserId: actor.userId,
          actorType: actor.actorType,
          entityType: "prescription_extraction",
          entityId: extraction.id,
          patientProfileId: profileId,
          correlationId: actor.correlationId,
          context: { candidateCount: candidates.length, fields: candidates.map((c) => c.field) },
        });
      });

      return this.get(profileId, documentId);
    } catch (err) {
      await this.prisma.$transaction([
        this.prisma.prescriptionExtraction.update({ where: { id: extraction.id }, data: { status: "failed" } }),
        this.prisma.prescriptionDocument.update({ where: { id: documentId }, data: { status: "failed" } }),
      ]);
      throw err instanceof ApiProblem
        ? err
        : new ApiProblem(ERROR_CODES.INTERNAL, "Couldn't read this document. Try a clearer photo.", 500);
    }
  }

  async get(profileId: string, documentId: string) {
    const doc = await this.prisma.prescriptionDocument.findFirst({
      where: { id: documentId, patientProfileId: profileId },
    });
    if (!doc) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Document not found", 404);

    const extraction = await this.prisma.prescriptionExtraction.findFirst({
      where: { prescriptionDocumentId: documentId },
      orderBy: { createdAt: "desc" },
      include: CANDIDATE_INCLUDE,
    });
    if (!extraction) return { documentId, status: doc.status, extraction: null };

    const productIds = extraction.candidates
      .filter((c) => c.field === "brand_name" && c.proposedValue)
      .map((c) => c.proposedValue!);
    const products = productIds.length
      ? await this.prisma.medicationProduct.findMany({
          where: { id: { in: productIds } },
          include: { brand: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    return {
      documentId,
      status: doc.status,
      extraction: {
        id: extraction.id,
        status: extraction.status,
        candidates: extraction.candidates.map((c) => {
          const product = c.field === "brand_name" && c.proposedValue ? productById.get(c.proposedValue) : undefined;
          return {
            id: c.id,
            field: c.field,
            detectedText: c.detectedText,
            proposedValue: c.proposedValue,
            proposedLabel: product
              ? [product.brand?.name, product.strengthLabel].filter(Boolean).join(" ")
              : c.proposedValue,
            confidence: Number(c.confidence),
            status: c.status,
            confirmedValue: c.confirmedValue,
          };
        }),
      },
    };
  }

  async confirmCandidate(profileId: string, candidateId: string, confirmedValue: string, actor: Actor) {
    const candidate = await this.findOwnedCandidate(profileId, candidateId);
    if (candidate.field === "brand_name") {
      const product = await this.prisma.medicationProduct.findFirst({
        where: { id: confirmedValue, status: "active" },
      });
      if (!product) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown medicine selected", 400);
    }
    if (candidate.field === "frequency") {
      this.parseFrequencyValue(confirmedValue);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.extractionCandidate.update({
        where: { id: candidateId },
        data: { status: "confirmed", confirmedValue, confirmedByUserId: actor.userId, confirmedAt: new Date() },
      });
      await writeAudit(tx, {
        action: "extraction.field_confirmed",
        actorUserId: actor.userId,
        actorType: actor.actorType,
        entityType: "extraction_candidate",
        entityId: candidateId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { field: candidate.field },
      });
    });
    return { id: candidateId, status: "confirmed" as const };
  }

  async rejectCandidate(profileId: string, candidateId: string, actor: Actor) {
    const candidate = await this.findOwnedCandidate(profileId, candidateId);
    await this.prisma.$transaction(async (tx) => {
      await tx.extractionCandidate.update({ where: { id: candidateId }, data: { status: "rejected" } });
      await writeAudit(tx, {
        action: "extraction.field_rejected",
        actorUserId: actor.userId,
        actorType: actor.actorType,
        entityType: "extraction_candidate",
        entityId: candidateId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { field: candidate.field },
      });
    });
    return { id: candidateId, status: "rejected" as const };
  }

  /**
   * Only confirmed catalog matches and confirmed frequencies feed a new
   * medication — an unmatched brand or an unconfirmed frequency means the
   * patient falls back to the regular search/manual add flow instead of a
   * guess being silently used (docs/09 §6).
   */
  async createMedicationFromExtraction(
    profileId: string,
    extractionId: string,
    input: CreateMedicationFromExtractionInput,
    actor: { userId: string; actorRole: "patient" | "caregiver"; correlationId?: string },
  ) {
    const extraction = await this.prisma.prescriptionExtraction.findFirst({
      where: { id: extractionId, prescriptionDocument: { patientProfileId: profileId } },
      include: CANDIDATE_INCLUDE,
    });
    if (!extraction) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Extraction not found", 404);

    const confirmed = (field: string) => extraction.candidates.find((c) => c.field === field && c.status === "confirmed");

    const brand = confirmed("brand_name");
    if (!brand?.confirmedValue) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Confirm the medicine name before adding it", 400);
    }
    const frequency = confirmed("frequency");
    if (!frequency?.confirmedValue) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Confirm the dosing frequency before adding it", 400);
    }
    const { frequencyCode, pattern } = this.parseFrequencyValue(frequency.confirmedValue);
    const food = confirmed("food_instruction");

    return this.medications.create(
      profileId,
      {
        productId: brand.confirmedValue,
        source: "extraction",
        isPrn: input.isPrn,
        patientReason: input.patientReason,
        prescriberName: input.prescriberName,
        startDate: input.startDate,
        instruction: {
          doseQuantity: input.doseQuantity,
          doseUnit: input.doseUnit,
          frequencyCode,
          pattern,
          foodInstruction: (food?.confirmedValue as never) ?? "any",
          originalText: extraction.rawText?.slice(0, 500),
        },
      },
      actor,
    );
  }

  private parseFrequencyValue(value: string): { frequencyCode: FrequencyCode; pattern?: string } {
    if (value.startsWith("PATTERN:")) {
      const pattern = value.slice("PATTERN:".length);
      if (!/^\d(\.\d)?-\d(\.\d)?-\d(\.\d)?$/.test(pattern)) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Invalid dosing pattern", 400);
      }
      return { frequencyCode: "PATTERN", pattern };
    }
    if (!(FREQUENCY_CODES as readonly string[]).includes(value)) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Invalid dosing frequency", 400);
    }
    return { frequencyCode: value as FrequencyCode };
  }

  private async findOwnedCandidate(profileId: string, candidateId: string) {
    const candidate = await this.prisma.extractionCandidate.findFirst({
      where: { id: candidateId, extraction: { prescriptionDocument: { patientProfileId: profileId } } },
    });
    if (!candidate) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Candidate not found", 404);
    return candidate;
  }
}
