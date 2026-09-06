import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { getAnalyte, getObservationConcept } from "@medpass/terminology";
import type {
  ClinicalRelationship,
  ClinicalRelationshipBasis,
  ClinicalRelationshipEntity,
  ClinicalRelationshipKind,
  ClinicalRelationshipStatus,
  Prisma,
} from "@medpass/database";
import type { ClinicalRelationshipsQuery } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import type { ProvenanceActor } from "../../common/provenance-actor";
import { usualMonitoringFor } from "./condition-monitoring";

interface Actor extends ProvenanceActor {
  correlationId?: string;
}

/** One end of an edge: a row (`id`) or a terminology code (`key`), never both. */
interface EdgeEnd {
  type: ClinicalRelationshipEntity;
  id?: string;
  key?: string;
}

interface InferredEdge {
  kind: ClinicalRelationshipKind;
  basis: ClinicalRelationshipBasis;
  from: EdgeEnd;
  to: EdgeEnd;
  basisDetail: Prisma.InputJsonValue;
}

export interface RelationshipEndDto {
  type: ClinicalRelationshipEntity;
  id: string | null;
  key: string | null;
  /** Resolved display text — the patient's own entered names, or the terminology display. */
  label: string | null;
}

export interface ClinicalRelationshipDto {
  id: string;
  kind: ClinicalRelationshipKind;
  status: ClinicalRelationshipStatus;
  origin: string;
  basis: ClinicalRelationshipBasis;
  from: RelationshipEndDto;
  to: RelationshipEndDto;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  dismissedByUserId: string | null;
  dismissedAt: string | null;
  provenanceSource: string | null;
  verification: string | null;
  createdAt: string;
}

function ref(end: EdgeEnd): string {
  return `${end.type}:${end.id ?? end.key ?? ""}`;
}

/** Deterministic identity of an edge, so re-running the inference is an upsert and never a duplicate. */
export function edgeKeyOf(kind: ClinicalRelationshipKind, from: EdgeEnd, to: EdgeEnd): string {
  return `${kind}|${ref(from)}|${ref(to)}`;
}

/**
 * `ClinicalRelationship` edges (docs_v2/06 P10-1) — the treatment-journey
 * graph: condition ↔ medicine ↔ result ↔ measurement ↔ provider.
 *
 * Every edge this service derives is `origin: inferred`, `status:
 * suggested`, and is rendered as a question the patient answers — never as a
 * fact and never as a clinical claim (exit gate M10). The inference reads
 * only links the patient or their clinic already recorded (a medicine's
 * `reasonConditionId`, a prescription's practitioner) plus one code-level
 * lookup ("this analyte is usually used to follow this condition"), and even
 * that lookup only fires when the patient already has rows of that kind, so
 * a suggestion can never invent data the record does not hold.
 *
 * Confirming records who answered; dismissing stops the question being asked
 * again — a re-run of the inference upserts on `edgeKey` with an empty
 * update, so an answered edge is never quietly reset to a question.
 */
@Injectable()
export class ClinicalRelationshipsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Refresh the derived edges, then return them.
   *
   * Refreshing on read rather than on a cron is deliberate: the inputs are a
   * handful of indexed per-profile queries, and a patient who has just named
   * the reason for a medicine expects the question about their doctor on the
   * next screen, not after the next batch job.
   */
  async list(profileId: string, query: ClinicalRelationshipsQuery, actor: Actor): Promise<ClinicalRelationshipDto[]> {
    await this.refresh(profileId, actor);
    const where: Prisma.ClinicalRelationshipWhereInput = {
      patientProfileId: profileId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.conditionId ? { OR: [{ fromId: query.conditionId }, { toId: query.conditionId }] } : {}),
      ...(query.medicationId
        ? { AND: [{ OR: [{ fromId: query.medicationId }, { toId: query.medicationId }] }] }
        : {}),
    };
    const rows = await this.prisma.clinicalRelationship.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "asc" }] });
    return this.present(profileId, rows);
  }

  async confirm(profileId: string, id: string, actor: Actor): Promise<ClinicalRelationshipDto> {
    return this.answer(profileId, id, "confirmed", actor);
  }

  async dismiss(profileId: string, id: string, actor: Actor): Promise<ClinicalRelationshipDto> {
    return this.answer(profileId, id, "dismissed", actor);
  }

  private async answer(
    profileId: string,
    id: string,
    status: "confirmed" | "dismissed",
    actor: Actor,
  ): Promise<ClinicalRelationshipDto> {
    // Scoped by profile, so another patient's edge is a 404 and not a 403 —
    // the id itself must not confirm that the row exists.
    const existing = await this.prisma.clinicalRelationship.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Suggested link not found", 404);

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.clinicalRelationship.update({
        where: { id },
        data:
          status === "confirmed"
            ? {
                status,
                confirmedByUserId: actor.userId,
                confirmedAt: now,
                dismissedByUserId: null,
                dismissedAt: null,
                // The edge stays `system_derived` — it *was* derived, and
                // `basis` still says from what. Only the trust state moves,
                // and only upwards (ADR-V2-002).
                verification: "patient_confirmed",
                verifiedByUserId: actor.userId,
                verifiedAt: now,
              }
            : {
                status,
                dismissedByUserId: actor.userId,
                dismissedAt: now,
                confirmedByUserId: null,
                confirmedAt: null,
                verification: "unverified",
                verifiedByUserId: null,
                verifiedAt: null,
              },
      });
      await writeAudit(tx, {
        action: status === "confirmed" ? "clinical_relationship.confirmed" : "clinical_relationship.dismissed",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "clinical_relationship",
        entityId: row.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { kind: row.kind, basis: row.basis },
      });
      return row;
    });
    const [dto] = await this.present(profileId, [updated]);
    return dto!;
  }

  // ───────────────────────── inference ─────────────────────────

  /** Upserts every derivable edge. Existing rows are left exactly as they are. */
  async refresh(profileId: string, actor: Actor): Promise<void> {
    const edges = await this.derive(profileId);
    if (edges.length === 0) return;
    for (const edge of edges) {
      const edgeKey = edgeKeyOf(edge.kind, edge.from, edge.to);
      await this.prisma.clinicalRelationship.upsert({
        where: { patientProfileId_edgeKey: { patientProfileId: profileId, edgeKey } },
        // Empty on purpose: a confirmed or dismissed edge must survive every
        // later re-run, or the patient would be asked the same question again
        // after answering it.
        update: {},
        create: {
          patientProfileId: profileId,
          kind: edge.kind,
          fromType: edge.from.type,
          fromId: edge.from.id ?? null,
          fromKey: edge.from.key ?? null,
          toType: edge.to.type,
          toId: edge.to.id ?? null,
          toKey: edge.to.key ?? null,
          edgeKey,
          status: "suggested",
          origin: "inferred",
          basis: edge.basis,
          basisDetail: edge.basisDetail,
          provenanceSource: "system_derived",
          verification: "unverified",
          // Nobody pressed save; the channel is still recorded so an edge
          // derived on a phone is distinguishable from one derived by a job.
          recordedVia: actor.recordedVia ?? "pwa",
          recordedByUserId: null,
        },
      });
    }
  }

  private async derive(profileId: string): Promise<InferredEdge[]> {
    const [conditions, medications, analyteRows, conceptRows, practitioners] = await Promise.all([
      this.prisma.patientCondition.findMany({
        where: { patientProfileId: profileId, deletedAt: null },
        select: { id: true, label: true, code: true },
      }),
      this.prisma.patientMedication.findMany({
        where: { patientProfileId: profileId, deletedAt: null },
        select: {
          id: true,
          reasonConditionId: true,
          practitionerId: true,
          prescribingPractitionerId: true,
          prescriptionId: true,
          prescription: { select: { id: true, practitionerId: true, deletedAt: true } },
        },
      }),
      this.prisma.diagnosticResult.groupBy({
        by: ["analyteKey"],
        where: { patientProfileId: profileId, deletedAt: null, supersededById: null },
      }),
      this.prisma.observation.groupBy({
        by: ["concept"],
        where: { patientProfileId: profileId, deletedAt: null },
      }),
      this.prisma.practitioner.findMany({ where: { createdByProfileId: profileId, deletedAt: null }, select: { id: true } }),
    ]);

    const conditionIds = new Set(conditions.map((c) => c.id));
    const practitionerIds = new Set(practitioners.map((p) => p.id));
    const analytes = new Set(analyteRows.map((r) => r.analyteKey));
    const concepts = new Set(conceptRows.map((r) => String(r.concept)));
    const edges: InferredEdge[] = [];

    for (const med of medications) {
      const conditionId = med.reasonConditionId && conditionIds.has(med.reasonConditionId) ? med.reasonConditionId : null;
      if (conditionId) {
        edges.push({
          kind: "medicine_for_condition",
          basis: "medicine_reason_condition",
          from: { type: "medication", id: med.id },
          to: { type: "condition", id: conditionId },
          basisDetail: { medicationId: med.id, conditionId },
        });
      }

      // Whoever the record already names as the prescriber: the medicine's
      // own two columns first, then the prescription it came from. A
      // soft-deleted prescription stops being evidence (the same rule the
      // medicines list follows for its links).
      const fromPrescription = med.prescription && med.prescription.deletedAt === null ? med.prescription.practitionerId : null;
      const candidates: Array<{ id: string; basis: ClinicalRelationshipBasis; detail: Prisma.InputJsonValue }> = [
        ...(med.prescribingPractitionerId
          ? [{ id: med.prescribingPractitionerId, basis: "medicine_practitioner" as const, detail: { medicationId: med.id } }]
          : []),
        ...(med.practitionerId && med.practitionerId !== med.prescribingPractitionerId
          ? [{ id: med.practitionerId, basis: "medicine_practitioner" as const, detail: { medicationId: med.id } }]
          : []),
        ...(fromPrescription
          ? [
              {
                id: fromPrescription,
                basis: "prescription_practitioner" as const,
                detail: { medicationId: med.id, prescriptionId: med.prescription!.id },
              },
            ]
          : []),
      ];
      for (const candidate of candidates) {
        if (!practitionerIds.has(candidate.id)) continue;
        edges.push({
          kind: "provider_for_medicine",
          basis: candidate.basis,
          from: { type: "practitioner", id: candidate.id },
          to: { type: "medication", id: med.id },
          basisDetail: candidate.detail,
        });
        if (conditionId) {
          edges.push({
            kind: "provider_for_condition",
            basis: candidate.basis,
            from: { type: "practitioner", id: candidate.id },
            to: { type: "condition", id: conditionId },
            basisDetail: { ...(candidate.detail as Record<string, unknown>), conditionId },
          });
        }
      }
    }

    for (const condition of conditions) {
      const hint = usualMonitoringFor(condition.label, condition.code);
      for (const analyteKey of hint.analyteKeys) {
        // Only ever about data the patient already has: no suggestion is
        // made about a test that was never done.
        if (!analytes.has(analyteKey)) continue;
        edges.push({
          kind: "result_tracks_condition",
          basis: "condition_usual_monitoring",
          from: { type: "analyte", key: analyteKey },
          to: { type: "condition", id: condition.id },
          basisDetail: { analyteKey, conditionId: condition.id },
        });
      }
      for (const concept of hint.concepts) {
        if (!concepts.has(concept)) continue;
        edges.push({
          kind: "measurement_tracks_condition",
          basis: "condition_usual_monitoring",
          from: { type: "observation_concept", key: concept },
          to: { type: "condition", id: condition.id },
          basisDetail: { concept, conditionId: condition.id },
        });
      }
    }

    // The same edge can be derived twice (two medicines, one doctor, one condition).
    const seen = new Set<string>();
    return edges.filter((e) => {
      const key = edgeKeyOf(e.kind, e.from, e.to);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ───────────────────────── presentation ─────────────────────────

  /** Batched label lookup: three queries per page, never one per edge, and every one scoped to this profile. */
  async present(profileId: string, rows: ClinicalRelationship[]): Promise<ClinicalRelationshipDto[]> {
    const idsOf = (type: ClinicalRelationshipEntity) => {
      const ids = new Set<string>();
      for (const r of rows) {
        if (r.fromType === type && r.fromId) ids.add(r.fromId);
        if (r.toType === type && r.toId) ids.add(r.toId);
      }
      return [...ids];
    };
    const conditionIds = idsOf("condition");
    const medicationIds = idsOf("medication");
    const practitionerIds = idsOf("practitioner");

    const [conditions, medications, practitioners] = await Promise.all([
      conditionIds.length
        ? this.prisma.patientCondition.findMany({ where: { id: { in: conditionIds }, patientProfileId: profileId, deletedAt: null }, select: { id: true, label: true } })
        : [],
      medicationIds.length
        ? this.prisma.patientMedication.findMany({ where: { id: { in: medicationIds }, patientProfileId: profileId, deletedAt: null }, select: { id: true, enteredName: true } })
        : [],
      practitionerIds.length
        ? this.prisma.practitioner.findMany({ where: { id: { in: practitionerIds }, createdByProfileId: profileId, deletedAt: null }, select: { id: true, displayName: true } })
        : [],
    ]);
    const labels = new Map<string, string>();
    for (const c of conditions) labels.set(c.id, c.label);
    for (const m of medications) labels.set(m.id, m.enteredName);
    for (const p of practitioners) labels.set(p.id, p.displayName);

    const end = (type: ClinicalRelationshipEntity, id: string | null, key: string | null): RelationshipEndDto => ({
      type,
      id,
      key,
      label: id ? (labels.get(id) ?? null) : key ? codeLabel(type, key) : null,
    });

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      origin: r.origin,
      basis: r.basis,
      from: end(r.fromType, r.fromId, r.fromKey),
      to: end(r.toType, r.toId, r.toKey),
      confirmedByUserId: r.confirmedByUserId,
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      dismissedByUserId: r.dismissedByUserId,
      dismissedAt: r.dismissedAt?.toISOString() ?? null,
      provenanceSource: r.provenanceSource,
      verification: r.verification,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

/** Display text for a code-valued end, from the shared terminology tables. */
function codeLabel(type: ClinicalRelationshipEntity, key: string): string | null {
  if (type === "analyte") return getAnalyte(key)?.display ?? key;
  if (type === "observation_concept") return getObservationConcept(key)?.display ?? key;
  return key;
}
