import { Inject, Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { Prisma } from "@medpass/database";
import { isProposable, valueSchemaFor } from "@medpass/document-intelligence";
import { ERROR_CODES } from "@medpass/domain";
import { DEFAULT_SOFTWARE_VERSION, isSupportedIgVersion, parseBundleToCandidates, validateResource, type FhirValidationFailure, type ParsedCandidateDraft } from "@medpass/fhir";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import type { AbdmActor } from "./abdm.service";
import { ABDM_GATEWAY_CLIENT, type AbdmGatewayClient } from "./gateway-client";

/** ABDM HI type → the document kind the imported bundle is filed under (docs_v2/04 §7.2). */
const HI_TYPE_KIND: Record<string, "prescription" | "lab_report" | "discharge_summary" | "consultation_note" | "vaccination_record" | "other"> = {
  Prescription: "prescription",
  DiagnosticReport: "lab_report",
  DischargeSummary: "discharge_summary",
  OPConsultation: "consultation_note",
  ImmunizationRecord: "vaccination_record",
  HealthDocumentRecord: "other",
  WellnessRecord: "other",
};

const ENGINE = "abdm-fhir-parser";

/**
 * docs_v2/08 §7 import policy: inbound bundle → parser → candidate rows → patient confirmation.
 *
 * The bundle is filed as a `PatientDocument` (source channel `abdm`, provenance `abdm_imported` /
 * `source_authenticated`, `sourceAbdmTxnId` = the transfer transaction) with one
 * `DocumentExtraction` whose `DocumentCandidate` rows are the parsed drafts — exactly the rows the
 * documents-v2 confirmation queue already shows and materializes. This service therefore never
 * touches a clinical table (`no-direct-clinical-write.spec.ts`); the single writer in
 * `documents-v2/materialize-candidate.ts` stamps the confirmed rows with the document's ABDM
 * provenance so they end up `abdm_imported` + `source_authenticated` + `sourceAbdmTxnId`.
 */
@Injectable()
export class AbdmImportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ABDM_GATEWAY_CLIENT) private readonly gateway: AbdmGatewayClient,
  ) {}

  async importBundle(profileId: string, bundleId: string, actor: AbdmActor) {
    const bundle = await this.prisma.abdmDataBundle.findFirst({ where: { id: bundleId, patientProfileId: profileId } });
    if (!bundle) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Bundle not found", 404);
    if (bundle.importStatus === "candidates_created") throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This bundle has already been imported", 409);
    if (bundle.importStatus === "erased") throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, "This bundle was erased under its consent", 409);

    const fetched = await this.gateway.fetchBundle({ bundleId: bundle.id, transactionId: bundle.transactionId, correlationId: actor.correlationId });
    const ig = isSupportedIgVersion(fetched.igVersion) ? fetched.igVersion : "6.5";

    // Validate for the evidence trail; a structurally broken bundle is rejected, findings are recorded either way.
    const check = validateResource(fetched.bundle, { ig });
    const failures: FhirValidationFailure[] = check.ok ? [] : check.failures;
    const fatal = failures.some((f) => f.severity === "fatal");
    if (fatal) {
      await this.prisma.$transaction(async (tx) => {
        await this.recordFailures(tx, bundle.id, failures);
        await tx.abdmDataBundle.update({ where: { id: bundle.id }, data: { importStatus: "rejected" } });
      });
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "The received bundle is not a FHIR bundle this app can read", 422);
    }

    const parsed = parseBundleToCandidates(fetched.bundle);
    const accepted: ParsedCandidateDraft[] = [];
    for (const draft of parsed.candidates) {
      if (!isProposable(draft.targetEntity, draft.targetField)) {
        failures.push(informational(ig, draft, "target is not proposable from a document"));
        continue;
      }
      const schema = valueSchemaFor(draft.targetEntity, draft.targetField);
      const result = schema?.safeParse(draft.proposedValue);
      if (!result?.success) {
        failures.push(informational(ig, draft, `proposed value rejected by the extraction catalogue: ${result?.error.issues[0]?.message ?? "unknown"}`));
        continue;
      }
      accepted.push({ ...draft, proposedValue: result.data as unknown });
    }

    const now = new Date();
    const out = await this.prisma.$transaction(async (tx) => {
      // The transfer's AbdmTransaction row is what every confirmed row will point at (`sourceAbdmTxnId`).
      const transfer =
        (bundle.transactionId ? await tx.abdmTransaction.findFirst({ where: { transactionId: bundle.transactionId, direction: "inbound" } }) : null) ??
        (await tx.abdmTransaction.create({
          data: { patientProfileId: profileId, kind: "health-information.transfer", transactionId: bundle.transactionId, direction: "inbound", status: "completed", gatewayEnv: this.gateway.env, completedAt: now, correlationId: actor.correlationId ?? null },
        }));

      const document = await tx.patientDocument.create({
        data: {
          patientProfileId: profileId,
          kind: HI_TYPE_KIND[bundle.hiType] ?? "other",
          // No title: a FHIR bundle has no human-written one, and the
          // importer's own audit string ("ABDM Prescription (IG 6.5)") was
          // being shown to patients as if it were. The HI type and IG
          // version are on the AbdmDataBundle row and in the audit context
          // where they belong; clients name the document from its kind.
          title: null,
          documentDate: now,
          status: "processed",
          classification: HI_TYPE_KIND[bundle.hiType] ?? "other",
          classifiedBy: "deterministic",
          sourceChannel: "abdm",
          pageCount: 0,
          provenanceSource: "abdm_imported",
          verification: "source_authenticated",
          recordedVia: "abdm",
          recordedByUserId: actor.userId,
          sourceAbdmTxnId: transfer.id,
        },
      });
      const extraction = await tx.documentExtraction.create({
        data: { documentId: document.id, engine: ENGINE, engineVersion: DEFAULT_SOFTWARE_VERSION, status: "succeeded", startedAt: now, finishedAt: now },
      });
      for (const draft of accepted) {
        await tx.documentCandidate.create({
          data: {
            extractionId: extraction.id,
            patientProfileId: profileId,
            targetEntity: draft.targetEntity,
            targetField: draft.targetField,
            groupKey: draft.groupKey,
            pageNumber: null,
            boundingBox: { sourceResourceType: draft.sourceResourceType, sourceResourceId: draft.sourceResourceId } as Prisma.InputJsonValue,
            detectedText: draft.detectedText,
            proposedValue: draft.proposedValue as Prisma.InputJsonValue,
            confidence: draft.confidence,
          },
        });
      }
      await this.recordFailures(tx, bundle.id, failures);
      await tx.abdmDataBundle.update({
        where: { id: bundle.id },
        data: { importStatus: "candidates_created", decryptedAt: bundle.decryptedAt ?? now, entryCount: parsed.resourceCount, fhirVersion: fetched.fhirVersion, igVersion: fetched.igVersion },
      });
      await writeAudit(tx, {
        action: "abdm.bundle_imported",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "abdm_data_bundle",
        entityId: bundle.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { hiType: bundle.hiType, ig, documentId: document.id, extractionId: extraction.id, candidateCount: accepted.length, unsupported: parsed.unsupported.length, failureCount: failures.length },
      });
      return { documentId: document.id, extractionId: extraction.id };
    });

    return {
      bundleId: bundle.id,
      importStatus: "candidates_created" as const,
      documentId: out.documentId,
      extractionId: out.extractionId,
      candidateCount: accepted.length,
      unsupported: parsed.unsupported,
      validationFailureCount: failures.length,
    };
  }

  private async recordFailures(tx: Prisma.TransactionClient, bundleId: string, failures: FhirValidationFailure[]): Promise<void> {
    if (failures.length === 0) return;
    await tx.fhirValidationFailure.createMany({
      data: failures.map((f) => ({ bundleId, direction: "inbound", igVersion: f.igVersion, profileUrl: f.profileUrl, resourceType: f.resourceType, path: f.path, severity: f.severity, message: f.message })),
    });
  }
}

function informational(ig: string, draft: ParsedCandidateDraft, message: string): FhirValidationFailure {
  return {
    path: `${draft.sourceResourceType}.${draft.targetEntity}.${draft.targetField}`,
    severity: "information",
    message: `${draft.sourceResourceType}/${draft.sourceResourceId ?? "?"}: ${message}`,
    profileUrl: "",
    resourceType: draft.sourceResourceType,
    igVersion: ig,
  };
}
