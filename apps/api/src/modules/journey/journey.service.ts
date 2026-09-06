import { Injectable } from "@nestjs/common";
import { ERROR_CODES, type ObservationConcept } from "@medpass/domain";
import { getAnalyte, getObservationConcept } from "@medpass/terminology";
import type { BeforeAfterQuery } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";
import type { ProvenanceActor } from "../../common/provenance-actor";
import { DiagnosticsService } from "../diagnostics/diagnostics.service";
import { ObservationsService } from "../observations/observations.service";
import { buildBeforeAfter, type BeforeAfterView, type DatedValue } from "./before-after";
import { ClinicalRelationshipsService, type ClinicalRelationshipDto } from "./clinical-relationships.service";

interface Actor extends ProvenanceActor {
  correlationId?: string;
}

/** What the caller is allowed to see, resolved once per hub request. */
export interface SectionAccess {
  medicines: boolean;
  tests: boolean;
  measurements: boolean;
}

export interface MeasureRef {
  kind: "result" | "measurement";
  key: string;
  label: string;
  unit: string | null;
  unitDisplay: string | null;
}

/** The before/after payload. Numbers and window bounds — nothing derived from comparing them. */
export interface BeforeAfterPayload extends BeforeAfterView {
  medication: { id: string; enteredName: string; startDate: string };
  measure: MeasureRef;
}

/** How many before/after views the hub computes inline before it stops and lets the screen ask for more. */
const MAX_INLINE_BEFORE_AFTER = 3;

/**
 * The treatment journey (docs_v2/06 P10-2, P10-3).
 *
 * The hub answers one question — "what is on file around this condition" —
 * and answers it in four independent sections, each gated on the scope that
 * owns that data, so a caregiver trusted with the patient's conditions but
 * not their lab results gets the condition and an omitted section rather
 * than a 403 for the whole screen (docs_v2/04 §2.2).
 *
 * The before/after view lines up the patient's own numbers against a
 * medicine's start date. It states what was measured and when, and stops
 * there: no difference, no percentage, no direction, no verdict. Things that
 * happen near each other in time are not evidence that one caused the other,
 * and an app that quietly did that arithmetic would be making a clinical
 * claim it is not entitled to make (docs_v2/10 §1, exit gate M10).
 */
@Injectable()
export class JourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
    private readonly relationships: ClinicalRelationshipsService,
    private readonly diagnostics: DiagnosticsService,
    private readonly observations: ObservationsService,
  ) {}

  /** Which sections this caller may read, decided once from the scopes the access check already resolved. */
  async sectionAccess(userId: string, profileId: string, caregiverScopes: readonly string[]): Promise<SectionAccess> {
    const profile = await this.prisma.patientProfile.findFirst({
      where: { id: profileId, deletedAt: null },
      select: { ownerUserId: true, claimedByUserId: true },
    });
    if (!profile) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Profile not found", 404);
    const ctx = {
      userId,
      profileOwnerUserId: profile.ownerUserId,
      profileClaimedByUserId: profile.claimedByUserId,
      caregiverScopes: caregiverScopes as never,
    };
    return {
      medicines: this.access.decide(ctx, "view_medications"),
      tests: this.access.decide(ctx, "view_tests"),
      measurements: this.access.decide(ctx, "view_measurements"),
    };
  }

  async conditionHub(profileId: string, conditionId: string, sections: SectionAccess, actor: Actor) {
    const condition = await this.prisma.patientCondition.findFirst({
      where: { id: conditionId, patientProfileId: profileId, deletedAt: null },
    });
    if (!condition) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Condition not found", 404);

    const edges = await this.relationships.list(profileId, { conditionId }, actor);
    const confirmedMedicationIds = new Set(
      edges.filter((e) => e.kind === "medicine_for_condition" && e.status === "confirmed" && e.from.id).map((e) => e.from.id!),
    );

    const medicines = sections.medicines ? await this.medicinesFor(profileId, conditionId, confirmedMedicationIds) : [];
    const statedMedicationIds = new Set(medicines.filter((m) => m.linkSource === "medicine_record").map((m) => m.id));

    const trackedResults = sections.tests ? await this.trackedResults(profileId, edges) : [];
    const trackedMeasurements = sections.measurements ? await this.trackedMeasurements(profileId, edges) : [];
    const doctors = await this.doctorsFor(profileId, edges);

    return {
      condition: {
        id: condition.id,
        label: condition.label,
        note: condition.note,
        clinicalStatus: condition.clinicalStatus,
        onsetDate: condition.onsetDate ? condition.onsetDate.toISOString().slice(0, 10) : null,
        abatementDate: condition.abatementDate ? condition.abatementDate.toISOString().slice(0, 10) : null,
        provenanceSource: condition.provenanceSource,
        verification: condition.verification,
      },
      sections,
      medicines,
      results: trackedResults,
      measurements: trackedMeasurements,
      doctors,
      /**
       * Only questions the screen is not already answering elsewhere: a
       * medicine that names this condition as its reason is shown as the
       * stated fact it is, so re-asking about it would be noise.
       */
      suggestions: edges.filter(
        (e) => e.status === "suggested" && !(e.kind === "medicine_for_condition" && e.from.id && statedMedicationIds.has(e.from.id)),
      ),
      beforeAfter: await this.inlineBeforeAfter(profileId, medicines, trackedResults, trackedMeasurements, sections),
    };
  }

  private async medicinesFor(profileId: string, conditionId: string, confirmedIds: Set<string>) {
    const rows = await this.prisma.patientMedication.findMany({
      where: {
        patientProfileId: profileId,
        deletedAt: null,
        OR: [{ reasonConditionId: conditionId }, ...(confirmedIds.size ? [{ id: { in: [...confirmedIds] } }] : [])],
      },
      select: { id: true, enteredName: true, status: true, startDate: true, endDate: true, reasonConditionId: true, provenanceSource: true, verification: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return rows.map((m) => ({
      id: m.id,
      enteredName: m.enteredName,
      status: m.status,
      startDate: m.startDate ? m.startDate.toISOString().slice(0, 10) : null,
      endDate: m.endDate ? m.endDate.toISOString().slice(0, 10) : null,
      /**
       * `medicine_record` — the medicine itself names this condition as the
       * reason it is taken; `confirmed_link` — the patient answered yes to a
       * suggested edge. Never "we worked it out".
       */
      linkSource: m.reasonConditionId === conditionId ? ("medicine_record" as const) : ("confirmed_link" as const),
      provenanceSource: m.provenanceSource,
      verification: m.verification,
    }));
  }

  /** Analytes the patient has confirmed track this condition, with their latest value. */
  private async trackedResults(profileId: string, edges: ClinicalRelationshipDto[]) {
    const keys = edges
      .filter((e) => e.kind === "result_tracks_condition" && e.status === "confirmed" && e.from.key)
      .map((e) => e.from.key!);
    const out: Array<MeasureRef & { latest: { at: string; value: number } | null; points: number }> = [];
    for (const key of [...new Set(keys)]) {
      const analyte = getAnalyte(key);
      const trend = (await this.diagnostics.resultTrend(profileId, key, {})) as {
        points: Array<{ at: string; value: number }>;
      };
      const last = trend.points[trend.points.length - 1];
      out.push({
        kind: "result",
        key,
        label: analyte?.display ?? key,
        unit: analyte?.canonicalUnit ?? null,
        unitDisplay: analyte?.canonicalUnitDisplay ?? null,
        latest: last ? { at: last.at, value: last.value } : null,
        points: trend.points.length,
      });
    }
    return out;
  }

  private async trackedMeasurements(profileId: string, edges: ClinicalRelationshipDto[]) {
    const keys = edges
      .filter((e) => e.kind === "measurement_tracks_condition" && e.status === "confirmed" && e.from.key)
      .map((e) => e.from.key!);
    const out: Array<MeasureRef & { latest: { at: string; value: number; value2: number | null } | null; points: number }> = [];
    for (const key of [...new Set(keys)]) {
      const concept = getObservationConcept(key);
      const values = await this.observationValues(profileId, key as ObservationConcept);
      const last = values[values.length - 1];
      out.push({
        kind: "measurement",
        key,
        label: concept?.display ?? key,
        unit: concept?.canonicalUnit ?? null,
        unitDisplay: concept?.canonicalUnitDisplay ?? null,
        latest: last ? { at: last.at.toISOString(), value: last.value, value2: last.value2 ?? null } : null,
        points: values.length,
      });
    }
    return out;
  }

  /** Practitioners the patient has confirmed are involved in this condition's care. */
  private async doctorsFor(profileId: string, edges: ClinicalRelationshipDto[]) {
    const ids = [
      ...new Set(
        edges.filter((e) => e.kind === "provider_for_condition" && e.status === "confirmed" && e.from.id).map((e) => e.from.id!),
      ),
    ];
    if (ids.length === 0) return [];
    const rows = await this.prisma.practitioner.findMany({
      where: { id: { in: ids }, createdByProfileId: profileId, deletedAt: null },
      select: { id: true, displayName: true, speciality: true, verification: true },
    });
    return rows;
  }

  /**
   * Computes at most `MAX_INLINE_BEFORE_AFTER` views so the hub is one round
   * trip on a slow connection. Only medicines with a start date and only
   * measures the patient has confirmed track this condition qualify; a pair
   * with too few readings is dropped rather than shown as a gap.
   */
  private async inlineBeforeAfter(
    profileId: string,
    medicines: Array<{ id: string; enteredName: string; startDate: string | null }>,
    results: MeasureRef[],
    measurements: MeasureRef[],
    sections: SectionAccess,
  ): Promise<BeforeAfterPayload[]> {
    const out: BeforeAfterPayload[] = [];
    const measures = [...(sections.tests ? results : []), ...(sections.measurements ? measurements : [])];
    for (const medicine of medicines) {
      if (!medicine.startDate) continue;
      for (const measure of measures) {
        if (out.length >= MAX_INLINE_BEFORE_AFTER) return out;
        const view = await this.beforeAfterFor(profileId, { id: medicine.id, enteredName: medicine.enteredName, startDate: medicine.startDate }, measure);
        if (view.hasEnoughPoints) out.push(view);
      }
    }
    return out;
  }

  // ───────────────────────── before / after ─────────────────────────

  async beforeAfter(profileId: string, medicationId: string, query: BeforeAfterQuery): Promise<BeforeAfterPayload> {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id: medicationId, patientProfileId: profileId, deletedAt: null },
      select: { id: true, enteredName: true, startDate: true },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);
    if (!medication.startDate) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This medicine has no start date on file", 400, [
        { path: "startDate", message: "Add the date this medicine was started" },
      ]);
    }
    const measure = this.requireMeasure(query);
    return this.beforeAfterFor(
      profileId,
      { id: medication.id, enteredName: medication.enteredName, startDate: medication.startDate.toISOString().slice(0, 10) },
      measure,
    );
  }

  private requireMeasure(query: BeforeAfterQuery): MeasureRef {
    if (query.analyteKey) {
      const analyte = getAnalyte(query.analyteKey);
      if (!analyte) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown analyte", 400, [{ path: "analyteKey", message: "Not in the analyte table" }]);
      }
      return { kind: "result", key: analyte.key, label: analyte.display, unit: analyte.canonicalUnit, unitDisplay: analyte.canonicalUnitDisplay };
    }
    const concept = getObservationConcept(query.concept!);
    if (!concept) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown measurement", 400, [{ path: "concept", message: "Not in the observation-concept table" }]);
    }
    return { kind: "measurement", key: concept.key, label: concept.display, unit: concept.canonicalUnit, unitDisplay: concept.canonicalUnitDisplay };
  }

  private async beforeAfterFor(
    profileId: string,
    medication: { id: string; enteredName: string; startDate: string },
    measure: MeasureRef,
  ): Promise<BeforeAfterPayload> {
    const start = new Date(`${medication.startDate}T00:00:00.000Z`);
    const values =
      measure.kind === "result" ? await this.resultValues(profileId, measure.key) : await this.observationValues(profileId, measure.key as ObservationConcept);
    return { medication, measure, ...buildBeforeAfter(start, values) };
  }

  /**
   * Reuses the diagnostics trend aggregation (docs_v2/05 §6) rather than
   * re-reading `diagnostic_results`: unit conversion, superseded corrections
   * and unconvertible rows are already decided there, and a second copy of
   * that logic here is exactly how two screens end up disagreeing about the
   * same number (hazard H-35/H-39).
   */
  private async resultValues(profileId: string, analyteKey: string): Promise<DatedValue[]> {
    const trend = (await this.diagnostics.resultTrend(profileId, analyteKey, {})) as {
      points: Array<{ at: string; value: number }>;
    };
    return trend.points.map((p) => ({ at: new Date(p.at), value: p.value }));
  }

  private async observationValues(profileId: string, concept: ObservationConcept): Promise<DatedValue[]> {
    const rows = await this.observations.list(profileId, { concept });
    return rows
      .filter((o) => o.valueNumeric !== null)
      .map((o) => ({ at: new Date(o.measuredAt), value: Number(o.valueNumeric), value2: o.valueNumeric2 === null ? null : Number(o.valueNumeric2) }))
      .filter((v) => Number.isFinite(v.value))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }
}
