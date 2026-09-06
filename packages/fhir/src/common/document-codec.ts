import { getDocumentType } from "@medpass/terminology";
import type { CanonicalDocumentReference, DocumentStatus } from "../canonical/document.js";
import { type CodecContext, type SerializedResource, warning } from "./failure.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import {
  CODE_SYSTEMS,
  MEDPASS_SYSTEMS,
  type Attachment,
  type CodeableConcept,
  type DocumentReferenceContent,
  type DocumentReferenceResource,
  type Reference,
} from "./r4.js";
import { patientReference, reference } from "./references.js";

const STATUS_TO_FHIR: Record<DocumentStatus, DocumentReferenceResource["status"]> = {
  uploaded: "current",
  verified: "current",
  processing: "current",
  processed: "current",
  failed: "current",
  deleted: "entered-in-error",
};

/** The opaque attachment reference. The API resolves it to a signed URL only for an authorized caller. */
export function storedObjectUrn(storedObjectId: string): string {
  return `${MEDPASS_SYSTEMS.storedObject}:${storedObjectId}`;
}

/**
 * `PatientDocument` + pages → R4 `DocumentReference`. One `content` per page, each attachment by
 * opaque reference — never public R2 URLs and never inline bytes (docs_v2/08 §6 #15).
 */
export function documentToResource(input: CanonicalDocumentReference, ctx: CodecContext): SerializedResource<DocumentReferenceResource> {
  const c = requireProvenanceOf("PatientDocument", input);
  const warnings = [];
  const entry = getDocumentType(c.kind);
  const type: CodeableConcept = { text: c.title ?? entry?.display ?? c.kind };
  if (entry?.loincCode) {
    type.coding = [{ system: CODE_SYSTEMS.loinc, code: entry.loincCode, ...(entry.loincDisplay ? { display: entry.loincDisplay } : {}) }];
  } else {
    type.coding = [{ system: MEDPASS_SYSTEMS.csDocumentKind, code: c.kind, display: entry?.display ?? c.kind }];
    if (!entry?.intentionallyUnmapped) {
      warnings.push(warning(ctx, "DocumentReference", "type", `document kind "${c.kind}" has no LOINC document code; exported with the local CodeSystem`));
    }
  }

  const content: DocumentReferenceContent[] = c.pages.map((page) => {
    const attachment: Attachment = {
      contentType: page.contentType,
      url: storedObjectUrn(page.storedObjectId),
      title: `Page ${page.pageNumber}`,
    };
    if (page.sizeBytes !== null) attachment.size = page.sizeBytes;
    if (page.sha256Hex) attachment.hash = Buffer.from(page.sha256Hex, "hex").toString("base64");
    return { attachment };
  });
  if (content.length === 0) {
    // R4 requires content 1..*: a document with no uploaded page is still a record of the upload attempt.
    content.push({ attachment: { contentType: "application/octet-stream", url: storedObjectUrn("none"), title: "No pages uploaded" } });
    warnings.push(warning(ctx, "DocumentReference", "content", "document has no uploaded pages; a placeholder attachment was emitted"));
  }

  const resource: DocumentReferenceResource = {
    resourceType: "DocumentReference",
    id: c.id,
    meta: { profile: [ctx.profileUrl] },
    identifier: [{ system: MEDPASS_SYSTEMS.document, value: c.id }],
    status: STATUS_TO_FHIR[c.status],
    type,
    subject: patientReference(c.patient),
    date: c.provenance.recordedAt,
    content,
  };
  if (c.documentDate) resource.context = { period: { start: c.documentDate } };
  const related: Reference[] = [];
  if (c.prescriptionId) related.push({ identifier: { system: MEDPASS_SYSTEMS.prescription, value: c.prescriptionId } });
  if (c.diagnosticReportId) related.push(reference("DiagnosticReport", c.diagnosticReportId));
  if (c.encounterId) resource.context = { ...(resource.context ?? {}), encounter: [reference("Encounter", c.encounterId)] };
  if (related.length > 0) resource.context = { ...(resource.context ?? {}), related };
  return { resource, warnings };
}
