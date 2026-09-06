import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { Prisma } from "@medpass/database";
import { ERROR_CODES } from "@medpass/domain";
import {
  ProvenanceMissingError,
  buildCollectionBundle,
  serialize,
  serializePatientSummary,
  validateResource,
  type BundleResource,
  type CanonicalPatientRef,
  type CanonicalPatientSummary,
  type FhirValidationFailure,
  type IgVersion,
  type ResourceBase,
  type SerializableEntity,
} from "@medpass/fhir";
import { ApiProblem } from "../../common/errors";
import { decryptField } from "../../common/crypto";
import { PrismaService } from "../../common/prisma.service";
import {
  patientRefOf,
  provenanceOf,
  toCanonicalAllergy,
  toCanonicalCondition,
  toCanonicalDiagnosticReport,
  toCanonicalDocumentReference,
  toCanonicalLabObservation,
  toCanonicalMedication,
  toCanonicalMedicationRequest,
  toCanonicalMedicationStatement,
  toCanonicalOrganization,
  toCanonicalPatient,
  toCanonicalPractitioner,
  toCanonicalVitalObservation,
  type AbhaIdentity,
  type ProductWithIngredients,
} from "./canonical-mappers";

export interface ExportActor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

export interface ExportResult {
  bundle: BundleResource;
  resourceCount: number;
  /** Rows the serializer refused, mapping gaps and validator findings — all persisted as `FhirValidationFailure`. */
  failureCount: number;
}

/** Software version stamped on every Provenance assembler agent. */
const SOFTWARE_VERSION = `medicinepassport-api@${process.env.npm_package_version ?? "0.1.0"}`;

/**
 * `GET profiles/current/fhir/export` and `…/fhir/ips` (docs_v2/05 §10, docs_v2/08 §2, §8):
 * the patient's own canonical rows → FHIR through `@medpass/fhir`. This service reads clinical
 * tables and writes only `fhir_validation_failures` + the audit chain; it never writes a
 * clinical row (guarded by `no-direct-clinical-write.spec.ts`).
 */
@Injectable()
export class FhirExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportBundle(profileId: string, ig: IgVersion, actor: ExportActor): Promise<ExportResult> {
    const rows = await this.loadRows(profileId);
    const now = new Date();
    const ref = patientRefOf(rows.profile, rows.abha);
    const resources: ResourceBase[] = [];
    const failures: FhirValidationFailure[] = [];

    const emit = (entity: SerializableEntity): void => {
      try {
        const { resource, provenance, warnings } = serialize(entity, { ig, softwareVersion: SOFTWARE_VERSION });
        const check = validateResource(resource, { ig });
        if (!check.ok) failures.push(...check.failures);
        failures.push(...warnings);
        resources.push(resource, provenance);
      } catch (err) {
        if (err instanceof ProvenanceMissingError) {
          failures.push(refusal(err, ig));
          return;
        }
        throw err;
      }
    };

    emit({ kind: "Patient", canonical: toCanonicalPatient(rows.profile, rows.abha, rows.abhaVerifiedAt) });
    for (const p of rows.practitioners) emit({ kind: "Practitioner", canonical: toCanonicalPractitioner(p) });
    for (const o of rows.organizations) emit({ kind: "Organization", canonical: toCanonicalOrganization(o) });
    for (const a of rows.allergies) emit({ kind: "AllergyIntolerance", canonical: toCanonicalAllergy(a, ref) });
    for (const c of rows.conditions) emit({ kind: "Condition", canonical: toCanonicalCondition(c, ref) });

    // Catalog products travel once each, borrowing the provenance of the first row that references them.
    const products = new Map<string, ProductWithIngredients>();
    for (const m of rows.medications) if (m.product) products.set(m.product.id, m.product);
    for (const p of rows.prescriptions) for (const item of p.items) if (item.product) products.set(item.product.id, item.product);
    for (const product of products.values()) {
      const owner = rows.medications.find((m) => m.productId === product.id) ?? rows.prescriptions.flatMap((p) => p.items).find((i) => i.productId === product.id);
      emit({ kind: "Medication", canonical: toCanonicalMedication(product, owner ? provenanceOf(owner) : null) });
    }
    for (const m of rows.medications) emit({ kind: "MedicationStatement", canonical: toCanonicalMedicationStatement(m, m.instructions[0] ?? null, ref) });
    for (const p of rows.prescriptions) for (const item of p.items) emit({ kind: "MedicationRequest", canonical: toCanonicalMedicationRequest(item, p, ref, now) });
    for (const r of rows.reports) {
      const results = r.results.filter((x) => x.deletedAt === null && x.supersededById === null);
      const docs = rows.documents.filter((d) => d.diagnosticReportId === r.id).map((d) => d.id);
      emit({ kind: "DiagnosticReport", canonical: toCanonicalDiagnosticReport(r, results.map((x) => x.id), docs, ref) });
      for (const x of results) emit({ kind: "ObservationLab", canonical: toCanonicalLabObservation(x, r, ref) });
    }
    for (const o of rows.observations) emit({ kind: "ObservationVital", canonical: toCanonicalVitalObservation(o, ref) });
    for (const d of rows.documents) emit({ kind: "DocumentReference", canonical: toCanonicalDocumentReference(d, ref) });

    const bundle = buildCollectionBundle(resources, { id: randomUUID(), timestamp: now.toISOString() });
    await this.record(profileId, actor, "fhir.exported", ig, bundle, failures, null);
    return { bundle, resourceCount: resources.length, failureCount: failures.length };
  }

  /** docs_v2/08 §8: Indian Patient Summary (v7.0 only). Sections are limited to confirmed rows by the serializer. */
  async patientSummary(profileId: string, actor: ExportActor): Promise<ExportResult> {
    const ig: IgVersion = "7.0";
    const rows = await this.loadRows(profileId);
    const ref = patientRefOf(rows.profile, rows.abha);
    const products = new Map<string, ProductWithIngredients>();
    for (const m of rows.medications) if (m.product) products.set(m.product.id, m.product);

    const summary: CanonicalPatientSummary = {
      patient: toCanonicalPatient(rows.profile, rows.abha, rows.abhaVerifiedAt),
      author: { practitioner: null, organization: null },
      medications: rows.medications.map((m) => toCanonicalMedicationStatement(m, m.instructions[0] ?? null, ref)),
      catalog: [...products.values()].map((product) => {
        const owner = rows.medications.find((m) => m.productId === product.id);
        return toCanonicalMedication(product, owner ? provenanceOf(owner) : null);
      }),
      allergies: rows.allergies.map((a) => toCanonicalAllergy(a, ref)),
      conditions: rows.conditions.map((c) => toCanonicalCondition(c, ref)),
      results: rows.reports.flatMap((r) => r.results.filter((x) => x.deletedAt === null && x.supersededById === null).map((x) => toCanonicalLabObservation(x, r, ref))),
      vitals: rows.observations.map((o) => toCanonicalVitalObservation(o, ref)),
    };

    const failures: FhirValidationFailure[] = [];
    let bundle: BundleResource;
    try {
      const out = serializePatientSummary(summary, { ig, softwareVersion: SOFTWARE_VERSION, bundleId: randomUUID(), timestamp: new Date().toISOString() });
      bundle = out.bundle;
      failures.push(...out.warnings.filter((w) => w.severity !== "information"));
    } catch (err) {
      if (err instanceof ProvenanceMissingError) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This profile cannot be summarised yet: its identity row has no provenance", 422);
      }
      throw err;
    }
    const check = validateResource(bundle, { ig });
    if (!check.ok) failures.push(...check.failures);
    await this.record(profileId, actor, "fhir.patient_summary_exported", ig, bundle, failures, null);
    return { bundle, resourceCount: bundle.entry?.length ?? 0, failureCount: failures.length };
  }

  private async record(
    profileId: string,
    actor: ExportActor,
    action: "fhir.exported" | "fhir.patient_summary_exported",
    ig: IgVersion,
    bundle: BundleResource,
    failures: FhirValidationFailure[],
    bundleRowId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (failures.length > 0) {
        await tx.fhirValidationFailure.createMany({
          data: failures.map((f) => ({
            bundleId: bundleRowId,
            direction: "outbound",
            igVersion: f.igVersion,
            profileUrl: f.profileUrl,
            resourceType: f.resourceType,
            path: f.path,
            severity: f.severity,
            message: f.message,
          })),
        });
      }
      await writeAudit(tx, {
        action,
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "fhir_bundle",
        entityId: bundle.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { ig, entryCount: bundle.entry?.length ?? 0, failureCount: failures.length },
      });
    });
  }

  private async loadRows(profileId: string) {
    const profile = await this.prisma.patientProfile.findFirst({ where: { id: profileId, deletedAt: null } });
    if (!profile) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Profile not found", 404);
    const link = await this.prisma.abhaLink.findFirst({ where: { patientProfileId: profileId, status: "active" }, orderBy: { linkedAt: "desc" } });
    const abha: AbhaIdentity = { abhaAddress: link?.abhaAddress ?? null, abhaNumber: link ? decryptField(link.abhaNumberCiphertext) : null };

    const [allergies, conditions, medications, prescriptions, reports, observations, documents] = await Promise.all([
      this.prisma.patientAllergy.findMany({ where: { patientProfileId: profileId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
      this.prisma.patientCondition.findMany({ where: { patientProfileId: profileId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
      this.prisma.patientMedication.findMany({
        where: { patientProfileId: profileId, deletedAt: null },
        include: { instructions: { where: { supersededAt: null }, orderBy: { createdAt: "desc" }, take: 1 }, product: productInclude },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.prescription.findMany({
        where: { patientProfileId: profileId, deletedAt: null },
        include: { items: { where: { deletedAt: null }, orderBy: { sequence: "asc" } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.diagnosticReport.findMany({
        where: { patientProfileId: profileId, deletedAt: null },
        include: { results: { orderBy: { sequence: "asc" } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.observation.findMany({ where: { patientProfileId: profileId, deletedAt: null }, orderBy: { measuredAt: "asc" } }),
      this.prisma.patientDocument.findMany({
        where: { patientProfileId: profileId, deletedAt: null, status: { in: ["uploaded", "verified", "processing", "processed"] } },
        include: { pages: { orderBy: { pageNumber: "asc" }, include: { storedObject: { select: { id: true, contentType: true, sizeBytes: true, sha256: true } } } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    // Items reference products by id without a Prisma relation; resolve them in one query.
    const itemProductIds = [...new Set(prescriptions.flatMap((p) => p.items.map((i) => i.productId)).filter((id): id is string => id !== null))];
    const itemProducts = itemProductIds.length > 0 ? await this.prisma.medicationProduct.findMany({ where: { id: { in: itemProductIds } }, ...productInclude }) : [];
    const byId = new Map(itemProducts.map((p) => [p.id, p]));
    const prescriptionsWithProducts = prescriptions.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i, product: i.productId ? (byId.get(i.productId) ?? null) : null })) }));

    // Directory rows referenced anywhere in the export (or created by this profile) travel with it.
    const practitionerIds = new Set<string>();
    const organizationIds = new Set<string>();
    for (const p of prescriptions) if (p.practitionerId) practitionerIds.add(p.practitionerId);
    for (const m of medications) for (const id of [m.practitionerId, m.prescribingPractitionerId]) if (id) practitionerIds.add(id);
    for (const r of reports) {
      for (const id of [r.orderingPractitionerId, r.reportingPractitionerId]) if (id) practitionerIds.add(id);
      if (r.organizationId) organizationIds.add(r.organizationId);
    }
    for (const c of conditions) if (c.diagnosedByPractitionerId) practitionerIds.add(c.diagnosedByPractitionerId);
    const practitioners = await this.prisma.practitioner.findMany({
      where: { deletedAt: null, OR: [{ id: { in: [...practitionerIds] } }, { createdByProfileId: profileId }] },
      orderBy: { createdAt: "asc" },
    });
    for (const p of practitioners) if (p.organizationId) organizationIds.add(p.organizationId);
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null, OR: [{ id: { in: [...organizationIds] } }, { patientProfileId: profileId }] },
      orderBy: { createdAt: "asc" },
    });

    return { profile, abha, abhaVerifiedAt: link?.lastVerifiedAt ?? link?.linkedAt ?? null, allergies, conditions, medications, prescriptions: prescriptionsWithProducts, reports, observations, documents, practitioners, organizations };
  }
}

const productInclude = { include: { ingredients: { include: { ingredient: true } }, dosageForm: true } } satisfies Prisma.MedicationProductDefaultArgs;

function refusal(err: ProvenanceMissingError, ig: IgVersion): FhirValidationFailure {
  return {
    path: `${err.entityType}.provenance`,
    severity: "error",
    message: err.message,
    profileUrl: "",
    resourceType: err.entityType,
    igVersion: ig,
  };
}
