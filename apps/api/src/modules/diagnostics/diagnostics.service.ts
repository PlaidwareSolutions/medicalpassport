import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, MEDICAL_REPORT_KIND_TO_DIAGNOSTIC_KIND, type MedicalReportKind } from "@medpass/domain";
import { emitHealthEvent, projectDiagnosticReport, supersedeHealthEvents } from "@medpass/health-events";
import {
  LOINC_SYSTEM,
  UnitConversionError,
  convertUnit,
  getAnalyte,
  listAllowedUnits,
  listAnalytes,
  type AnalyteEntry,
} from "@medpass/terminology";
import {
  parseReportNumericValue,
  type AddDiagnosticResultInput,
  type CorrectDiagnosticResultInput,
  type CreateDiagnosticReportInput,
  type DiagnosticReportsQuery,
  type DiagnosticResultsQuery,
  type ResultTrendQuery,
  type UpdateDiagnosticReportInput,
} from "@medpass/validation";
import type { DiagnosticReport, DiagnosticResult, Prisma } from "@medpass/database";
import { ApiProblem } from "../../common/errors";
import { eventCtx } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import { rejectClientInterpretation } from "../../common/provenance";
import { stampProvenanceFor, type ProvenanceActor } from "../../common/provenance-actor";
import { EncountersService } from "../encounters/encounters.service";
import { queueCaregiverNotification } from "../notifications/caregiver-notifications";
import { PractitionersService } from "../practitioners/practitioners.service";

interface Actor extends ProvenanceActor {
  correlationId?: string;
}

/** Prisma transaction client — the subset this service actually uses. */
type Tx = Prisma.TransactionClient;

/** Why a result cannot join its analyte's trend line (docs_v2/04 §6.4). */
export type UnconvertibleReason = "not_numeric" | "unsupported_unit" | "no_canonical_unit";

interface ResolvedValue {
  /** Value in the analyte's canonical unit, or null when it could not be brought there. */
  canonicalValue: string | null;
  /** The canonical unit actually stored, or null when the entry has none / the unit is unknown. */
  unit: string | null;
  reason: UnconvertibleReason | null;
}

/**
 * Brings one transcribed value to its analyte's canonical unit — or refuses,
 * explicitly, and says why.
 *
 * The refusal path is the important one (hazard H-35/H-39): a value the
 * converter cannot place is stored exactly as it was typed with `unit = null`,
 * and the trend endpoint reports it in `unconvertible[]` instead of dropping
 * it into a series it does not belong to. A patient who typed "mg/l" for an
 * analyte printed in mg/dL must not silently get a point ten times too low.
 *
 * Unknown units are accepted rather than refused at the door: the patient is
 * transcribing a piece of paper, and the paper wins. What must never happen
 * is that the unknown unit gets *merged*.
 */
function resolveValue(analyte: AnalyteEntry, enteredValueText: string, enteredUnit: string | undefined): ResolvedValue {
  const numeric = parseReportNumericValue(enteredValueText);
  if (numeric === null) return { canonicalValue: null, unit: null, reason: "not_numeric" };
  if (analyte.canonicalUnit === null) return { canonicalValue: numeric, unit: null, reason: "no_canonical_unit" };
  if (!enteredUnit) {
    // No unit typed means "as printed", and the vocabulary's canonical unit
    // is exactly what the paper prints for this analyte (report-analytes.ts).
    return { canonicalValue: numeric, unit: analyte.canonicalUnit, reason: null };
  }
  try {
    const converted = convertUnit(Number(numeric), enteredUnit, analyte.canonicalUnit, analyte.key);
    return { canonicalValue: roundTo(converted, 4), unit: analyte.canonicalUnit, reason: null };
  } catch (err) {
    if (err instanceof UnitConversionError) return { canonicalValue: null, unit: null, reason: "unsupported_unit" };
    throw err;
  }
}

/** Decimal(14,4) on DiagnosticResult.valueNumeric — round rather than let Prisma refuse the row. */
function roundTo(value: number, places: number): string {
  return value.toFixed(places).replace(/0+$/, "").replace(/\.$/, "");
}

function requireAnalyte(analyteKey: string): AnalyteEntry {
  const analyte = getAnalyte(analyteKey);
  if (!analyte) {
    throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown test", 400, [
      { path: "analyteKey", message: "Not a test this app knows; use 'other' with a label" },
    ]);
  }
  return analyte;
}

function resultDto(r: DiagnosticResult) {
  const analyte = getAnalyte(r.analyteKey);
  return {
    id: r.id,
    diagnosticReportId: r.diagnosticReportId,
    analyteKey: r.analyteKey,
    label: r.analyteKey === "other" ? (r.analyteLabelText ?? "Other test value") : (analyte?.display ?? r.analyteKey),
    analyteLabelText: r.analyteLabelText,
    loincCode: r.loincCode,
    enteredValueText: r.enteredValueText,
    // Prisma Decimal serializes as an object over JSON — stringify explicitly.
    valueNumeric: r.valueNumeric?.toString() ?? null,
    valueText: r.valueText,
    comparator: r.comparator,
    unit: r.unit,
    enteredUnit: r.enteredUnit,
    referenceLow: r.referenceLow?.toString() ?? null,
    referenceHigh: r.referenceHigh?.toString() ?? null,
    referenceText: r.referenceText,
    interpretation: r.interpretation,
    specimenType: r.specimenType,
    sequence: r.sequence,
    supersededById: r.supersededById,
    legacyReportValueId: r.legacyReportValueId,
    provenanceSource: r.provenanceSource,
    verification: r.verification,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * `DiagnosticReport` carries practitioner *ids* with no Prisma relation (the
 * directory is global and merge-able, so the join is done by the caller with
 * one lookup, not by a per-row include).
 */
function reportDto(r: DiagnosticReport, names: ReadonlyMap<string, string> = new Map()) {
  return {
    id: r.id,
    kind: r.kind,
    category: r.category,
    title: r.title,
    status: r.status,
    specimenCollectedAt: r.specimenCollectedAt?.toISOString() ?? null,
    reportedAt: r.reportedAt?.toISOString() ?? null,
    testedAt: r.testedAt?.toISOString().slice(0, 10) ?? null,
    organizationId: r.organizationId,
    facilityNameText: r.facilityNameText,
    orderingPractitionerId: r.orderingPractitionerId,
    reportingPractitionerId: r.reportingPractitionerId,
    orderingPractitionerName: (r.orderingPractitionerId && names.get(r.orderingPractitionerId)) || null,
    reportingPractitionerName: (r.reportingPractitionerId && names.get(r.reportingPractitionerId)) || null,
    modality: r.modality,
    bodySite: r.bodySite,
    impressionText: r.impressionText,
    findingsText: r.findingsText,
    conclusionText: r.conclusionText,
    encounterId: r.encounterId,
    legacyMedicalReportId: r.legacyMedicalReportId,
    provenanceSource: r.provenanceSource,
    verification: r.verification,
    rowVersion: r.rowVersion,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Diagnostics (docs_v2/04 §6, docs_v2/05 §6, ADR-V2-011's lab sibling) — the
 * V2 replacement for `MedicalReport`/`ReportValue`, covering labs and imaging
 * in one shape, with units, structured reference ranges, and corrections that
 * supersede instead of overwrite.
 *
 * V1 `reports` keeps working throughout: `mirrorLegacyReport`/
 * `mirrorLegacyResult` below are called from ReportsService inside its own
 * transaction so both models stay consistent until the sunset migration
 * (ADR-V2-007). Only the V1 write emits a timeline event — the mirror is the
 * same test, not a second one.
 */
@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly practitioners: PractitionersService,
  ) {}

  /** Guards the summary/PDF blast radius, mirroring ReportsService's cap. */
  private static readonly MAX_RESULTS_PER_REPORT = 200;

  // ───────────────────────── reports ─────────────────────────

  async create(profileId: string, input: CreateDiagnosticReportInput, actor: Actor) {
    const created = await this.prisma.$transaction(async (tx) => {
      const orderingPractitionerId = await this.practitioners.resolve(tx, profileId, input.orderingPractitionerName);
      const reportingPractitionerId = await this.practitioners.resolve(tx, profileId, input.reportingPractitionerName);
      if (input.encounterId) await EncountersService.requireEncounter(tx, profileId, input.encounterId);
      const report = await tx.diagnosticReport.create({
        data: {
          patientProfileId: profileId,
          kind: input.kind,
          category: input.category ?? null,
          title: input.title,
          status: input.status,
          specimenCollectedAt: input.specimenCollectedAt ?? null,
          reportedAt: input.reportedAt ?? null,
          testedAt: input.testedAt ?? null,
          organizationId: input.organizationId ?? null,
          facilityNameText: input.facilityNameText ?? null,
          orderingPractitionerId,
          reportingPractitionerId,
          modality: input.modality ?? null,
          bodySite: input.bodySite ?? null,
          impressionText: input.impressionText ?? null,
          findingsText: input.findingsText ?? null,
          conclusionText: input.conclusionText ?? null,
          encounterId: input.encounterId ?? null,
          ...stampProvenanceFor(actor),
        },
      });
      await writeAudit(tx, {
        action: "diagnostic_report.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "diagnostic_report",
        entityId: report.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { kind: input.kind },
      });
      await this.emitReportEvent(tx, profileId, actor, report.id, 0);
      // Caregivers entitled to read tests are told a report arrived
      // (docs_v2/06 P6-4) — never the person who filed it. Values added to
      // the report afterwards ride on this same notification (one report,
      // one alert), which is why it keys on the report id.
      await queueCaregiverNotification(tx, {
        patientProfileId: profileId,
        kind: "new_test_result",
        entityId: report.id,
        triggeredByUserId: actor.userId,
        triggeredByRole: actor.actorRole,
        correlationId: actor.correlationId,
      });
      return report;
    });
    return (await this.byId(profileId, created.id))!;
  }

  async list(profileId: string, query: DiagnosticReportsQuery) {
    const reports = await this.prisma.diagnosticReport.findMany({
      where: {
        patientProfileId: profileId,
        deletedAt: null,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.from || query.to
          ? { testedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : {}),
      },
      include: { _count: { select: { results: { where: { deletedAt: null, supersededById: null } } } } },
      // Newest test first; an undated report falls back to when it was filed
      // rather than sinking to the bottom forever (the V1 reports rule).
      orderBy: [{ testedAt: "desc" }, { createdAt: "desc" }],
    });
    const names = await this.practitionerNames(reports);
    return reports.map((r) => ({ ...reportDto(r, names), resultCount: r._count.results }));
  }

  async byId(profileId: string, id: string) {
    const report = await this.prisma.diagnosticReport.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: { results: { where: { deletedAt: null }, orderBy: [{ sequence: "asc" }, { createdAt: "asc" }] } },
    });
    if (!report) return null;
    return {
      ...reportDto(report, await this.practitionerNames([report])),
      resultCount: report.results.filter((r) => r.supersededById === null).length,
      results: report.results.map(resultDto),
    };
  }

  async update(profileId: string, id: string, input: UpdateDiagnosticReportInput, actor: Actor) {
    await this.requireOwnReport(this.prisma, profileId, id);
    await this.prisma.$transaction(async (tx) => {
      const orderingPractitionerId =
        input.orderingPractitionerName === undefined
          ? undefined
          : await this.practitioners.resolve(tx, profileId, input.orderingPractitionerName);
      const reportingPractitionerId =
        input.reportingPractitionerName === undefined
          ? undefined
          : await this.practitioners.resolve(tx, profileId, input.reportingPractitionerName);
      if (input.encounterId) await EncountersService.requireEncounter(tx, profileId, input.encounterId);
      await tx.diagnosticReport.update({
        where: { id },
        data: {
          ...pick(input, [
            "kind",
            "category",
            "title",
            "status",
            "specimenCollectedAt",
            "reportedAt",
            "testedAt",
            "organizationId",
            "facilityNameText",
            "modality",
            "bodySite",
            "impressionText",
            "findingsText",
            "conclusionText",
            "encounterId",
          ]),
          ...(orderingPractitionerId === undefined ? {} : { orderingPractitionerId }),
          ...(reportingPractitionerId === undefined ? {} : { reportingPractitionerId }),
          rowVersion: { increment: 1 },
        },
      });
      await writeAudit(tx, {
        action: "diagnostic_report.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "diagnostic_report",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { fields: Object.keys(input) },
      });
      const liveResults = await tx.diagnosticResult.count({ where: { diagnosticReportId: id, deletedAt: null, supersededById: null } });
      await this.emitReportEvent(tx, profileId, actor, id, liveResults);
    });
    return (await this.byId(profileId, id))!;
  }

  /**
   * Soft-delete only, mirroring reports/prescriptions. Results keep their
   * `diagnosticReportId` — this app never cascades a soft-delete into child
   * rows; reads simply stop surfacing the deleted parent.
   */
  async softDelete(profileId: string, id: string, actor: Actor) {
    await this.requireOwnReport(this.prisma, profileId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.diagnosticReport.update({ where: { id }, data: { deletedAt: new Date() } });
      await supersedeHealthEvents(tx, "diagnostic_report", id);
      await writeAudit(tx, {
        action: "diagnostic_report.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "diagnostic_report",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }

  // ───────────────────────── results ─────────────────────────

  async listResults(profileId: string, reportId: string) {
    await this.requireOwnReport(this.prisma, profileId, reportId);
    const results = await this.prisma.diagnosticResult.findMany({
      where: { diagnosticReportId: reportId, deletedAt: null },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    });
    return results.map(resultDto);
  }

  async addResult(profileId: string, reportId: string, input: AddDiagnosticResultInput, actor: Actor) {
    await this.requireOwnReport(this.prisma, profileId, reportId);
    const analyte = requireAnalyte(input.analyteKey);
    const stamp = stampProvenanceFor(actor);
    rejectClientInterpretation(input.interpretation, stamp.provenanceSource);

    const created = await this.prisma.$transaction(async (tx) => {
      const count = await tx.diagnosticResult.count({ where: { diagnosticReportId: reportId, deletedAt: null } });
      if (count >= DiagnosticsService.MAX_RESULTS_PER_REPORT) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This report already has the maximum number of values", 400);
      }
      const row = await tx.diagnosticResult.create({
        data: this.resultData(profileId, reportId, analyte, input, input.sequence ?? count + 1, stamp),
      });
      await writeAudit(tx, {
        action: "diagnostic_result.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "diagnostic_result",
        entityId: row.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        // The analyte key is not PHI; the value itself never goes in context.
        context: { analyteKey: analyte.key },
      });
      await this.emitReportEvent(tx, profileId, actor, reportId, count + 1);
      return row;
    });
    return resultDto(created);
  }

  /**
   * A correction (docs_v2/04 §6.3). The original row is *never* edited: it
   * gets a `supersededById` pointing at the replacement, so the value a
   * doctor read last month is still exactly what they read. `analyteKey`
   * and `sequence` carry over from the original — a different analyte is a
   * different test, not a correction of this one.
   */
  async correctResult(profileId: string, resultId: string, input: CorrectDiagnosticResultInput, actor: Actor) {
    const original = await this.requireOwnResult(profileId, resultId);
    if (original.supersededById) {
      throw new ApiProblem(
        ERROR_CODES.CONFLICT_ROW_VERSION,
        "This value has already been corrected — correct the newer one instead",
        409,
      );
    }
    const analyte = requireAnalyte(original.analyteKey);
    const stamp = stampProvenanceFor(actor);
    rejectClientInterpretation(input.interpretation, stamp.provenanceSource);

    const replacement = await this.prisma.$transaction(async (tx) => {
      const row = await tx.diagnosticResult.create({
        data: {
          ...this.resultData(
            profileId,
            original.diagnosticReportId,
            analyte,
            { ...input, analyteKey: original.analyteKey, analyteLabelText: input.analyteLabelText ?? original.analyteLabelText ?? undefined },
            original.sequence,
            stamp,
          ),
        },
      });
      await tx.diagnosticResult.update({ where: { id: original.id }, data: { supersededById: row.id } });
      await writeAudit(tx, {
        action: "diagnostic_result.corrected",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "diagnostic_result",
        entityId: row.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { analyteKey: analyte.key, supersedes: original.id, reason: input.correctionReason ?? null },
      });
      const live = await tx.diagnosticResult.count({
        where: { diagnosticReportId: original.diagnosticReportId, deletedAt: null, supersededById: null },
      });
      await this.emitReportEvent(tx, profileId, actor, original.diagnosticReportId, live);
      return row;
    });
    return resultDto(replacement);
  }

  async deleteResult(profileId: string, resultId: string, actor: Actor) {
    const result = await this.requireOwnResult(profileId, resultId);
    await this.prisma.$transaction(async (tx) => {
      await tx.diagnosticResult.update({ where: { id: result.id }, data: { deletedAt: new Date() } });
      await writeAudit(tx, {
        action: "diagnostic_result.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "diagnostic_result",
        entityId: result.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { analyteKey: result.analyteKey },
      });
      const live = await tx.diagnosticResult.count({
        where: { diagnosticReportId: result.diagnosticReportId, deletedAt: null, supersededById: null },
      });
      await this.emitReportEvent(tx, profileId, actor, result.diagnosticReportId, live);
    });
  }

  /** `?analyteKey&loinc&from&to` across every report (docs_v2/05 §6). Superseded rows are excluded. */
  async searchResults(profileId: string, query: DiagnosticResultsQuery) {
    const results = await this.prisma.diagnosticResult.findMany({
      where: {
        patientProfileId: profileId,
        deletedAt: null,
        supersededById: null,
        diagnosticReport: { deletedAt: null },
        ...(query.analyteKey ? { analyteKey: query.analyteKey } : {}),
        ...(query.loinc ? { loincCode: query.loinc } : {}),
      },
      include: { diagnosticReport: { select: { id: true, kind: true, title: true, facilityNameText: true, testedAt: true, reportedAt: true, createdAt: true } } },
    });
    const withDates = results
      .map((r) => ({ row: r, at: effectiveAt(r.diagnosticReport) }))
      .filter(({ at }) => (query.from ? at >= query.from : true) && (query.to ? at <= query.to : true))
      // A true coalesce sort in JS: Postgres DESC puts NULL testedAt first,
      // which would pin undated reports to the top of the history forever.
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.row.createdAt.getTime() - a.row.createdAt.getTime());
    return withDates.map(({ row, at }) => ({
      ...resultDto(row),
      reportId: row.diagnosticReport.id,
      reportKind: row.diagnosticReport.kind,
      reportTitle: row.diagnosticReport.title,
      facilityName: row.diagnosticReport.facilityNameText,
      testedAt: row.diagnosticReport.testedAt?.toISOString().slice(0, 10) ?? null,
      at: at.toISOString(),
    }));
  }

  /**
   * One analyte's trend (docs_v2/04 §6.4, docs_v2/05 §6). Every point is in
   * the analyte's canonical unit, converted from what the patient typed.
   *
   * Points the terminology layer cannot place — a qualitative entry
   * ("Negative"), a unit outside the analyte's table, an analyte with no
   * canonical unit at all — are returned in `unconvertible[]`, never mixed
   * into `points`. Hazard H-35/H-39: an mmol/L reading plotted on an mg/dL
   * axis is a wrong clinical value, and dropping it silently is a lost one.
   * Both failure modes are visible instead.
   */
  async resultTrend(profileId: string, analyteKey: string, query: ResultTrendQuery) {
    const analyte = requireAnalyte(analyteKey);
    const rows = await this.prisma.diagnosticResult.findMany({
      where: {
        patientProfileId: profileId,
        analyteKey: analyte.key,
        deletedAt: null,
        supersededById: null,
        diagnosticReport: { deletedAt: null },
      },
      include: { diagnosticReport: { select: { id: true, title: true, facilityNameText: true, testedAt: true, reportedAt: true, createdAt: true } } },
    });

    const dated = rows
      .map((r) => ({ row: r, at: effectiveAt(r.diagnosticReport) }))
      .filter(({ at }) => (query.from ? at >= query.from : true) && (query.to ? at <= query.to : true))
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.row.createdAt.getTime() - b.row.createdAt.getTime());

    const points: unknown[] = [];
    const unconvertible: unknown[] = [];
    for (const { row, at } of dated) {
      const common = {
        resultId: row.id,
        reportId: row.diagnosticReport.id,
        reportTitle: row.diagnosticReport.title,
        facilityName: row.diagnosticReport.facilityNameText,
        at: at.toISOString(),
        enteredValueText: row.enteredValueText,
        enteredUnit: row.enteredUnit,
      };
      // Re-derive rather than trust the stored twin: a row written before a
      // terminology fix, or backfilled from V1 with no unit at all, must be
      // judged by today's table.
      const resolved = resolveValue(analyte, row.enteredValueText, row.enteredUnit ?? undefined);
      if (resolved.reason !== null || resolved.canonicalValue === null || resolved.unit === null) {
        unconvertible.push({ ...common, reason: resolved.reason ?? "not_numeric" });
        continue;
      }
      points.push({
        ...common,
        value: Number(resolved.canonicalValue),
        unit: resolved.unit,
        comparator: row.comparator,
        referenceLow: row.referenceLow?.toString() ?? null,
        referenceHigh: row.referenceHigh?.toString() ?? null,
        referenceText: row.referenceText,
        interpretation: row.interpretation,
        provenanceSource: row.provenanceSource,
        verification: row.verification,
      });
    }

    return {
      analyteKey: analyte.key,
      label: analyte.display,
      loincCode: analyte.loincCode,
      canonicalUnit: analyte.canonicalUnit,
      canonicalUnitDisplay: analyte.canonicalUnitDisplay,
      allowedEnteredUnits: analyte.canonicalUnit === null ? [] : listAllowedUnits(analyte.key),
      points,
      unconvertible,
    };
  }

  /**
   * The analyte vocabulary with LOINC codes, canonical unit and allowed
   * entered units (docs_v2/05 §6). Public and PHI-free by construction: it
   * is a static code table, identical for every caller, so the unit picker
   * and the OCR mapper can read it without a session.
   */
  static analyteTerminology() {
    return {
      system: LOINC_SYSTEM,
      items: listAnalytes().map((a) => ({
        key: a.key,
        display: a.display,
        group: a.group,
        loincCode: a.loincCode,
        loincDisplay: a.loincDisplay,
        canonicalUnit: a.canonicalUnit,
        canonicalUnitDisplay: a.canonicalUnitDisplay,
        allowedEnteredUnits: a.canonicalUnit === null ? [] : listAllowedUnits(a.key),
        openEntry: a.openEntry === true,
      })),
    };
  }

  // ───────────────────────── V1 dual-write mirror ─────────────────────────

  /**
   * Creates the `DiagnosticReport` twin of a V1 `MedicalReport`, inside the
   * V1 write's own transaction (task 3 / ADR-V2-007). Deliberately silent on
   * the timeline: the V1 write already emitted the event for this test, and
   * a second one would show the same blood test twice.
   */
  async mirrorLegacyReport(
    tx: Tx,
    profileId: string,
    report: {
      id: string;
      kind: string;
      label: string | null;
      facilityName: string | null;
      practitionerId: string | null;
      testedAt: Date | null;
      encounterId: string | null;
      provenanceSource: string | null;
      verification: string | null;
      recordedVia: string | null;
      recordedByUserId: string | null;
    },
  ): Promise<{ id: string }> {
    const kind = MEDICAL_REPORT_KIND_TO_DIAGNOSTIC_KIND[report.kind as MedicalReportKind] ?? "other";
    return tx.diagnosticReport.upsert({
      where: { legacyMedicalReportId: report.id },
      create: {
        patientProfileId: profileId,
        legacyMedicalReportId: report.id,
        kind,
        // V1 has no title column; the label is what the patient wrote, and
        // the report kind is the honest fallback rather than an invented name.
        title: report.label?.trim() || v1KindTitle(report.kind),
        facilityNameText: report.facilityName,
        reportingPractitionerId: report.practitionerId,
        testedAt: report.testedAt,
        encounterId: report.encounterId,
        modality: report.kind === "imaging" ? "other" : null,
        provenanceSource: report.provenanceSource as never,
        verification: report.verification as never,
        recordedVia: report.recordedVia,
        recordedByUserId: report.recordedByUserId,
      },
      update: {},
      select: { id: true },
    });
  }

  /** Creates the `DiagnosticResult` twin of a V1 `ReportValue` (task 3). */
  async mirrorLegacyResult(
    tx: Tx,
    profileId: string,
    diagnosticReportId: string,
    value: {
      id: string;
      analyte: string;
      otherLabel: string | null;
      enteredValue: string;
      numericValue: { toString(): string } | null;
      referenceText: string | null;
      provenanceSource: string | null;
      verification: string | null;
      recordedVia: string | null;
      recordedByUserId: string | null;
    },
  ): Promise<{ id: string }> {
    const analyte = getAnalyte(value.analyte);
    const sequence = (await tx.diagnosticResult.count({ where: { diagnosticReportId } })) + 1;
    return tx.diagnosticResult.upsert({
      where: { legacyReportValueId: value.id },
      create: {
        diagnosticReportId,
        patientProfileId: profileId,
        legacyReportValueId: value.id,
        analyteKey: value.analyte,
        analyteLabelText: value.otherLabel,
        loincCode: analyte?.loincCode ?? null,
        enteredValueText: value.enteredValue,
        valueNumeric: value.numericValue?.toString() ?? null,
        // V1 has no unit column at all: whatever the patient typed was, by
        // the vocabulary's own rule, in the analyte's printed unit.
        unit: analyte?.canonicalUnit ?? null,
        enteredUnit: null,
        referenceText: value.referenceText,
        sequence,
        provenanceSource: value.provenanceSource as never,
        verification: value.verification as never,
        recordedVia: value.recordedVia,
        recordedByUserId: value.recordedByUserId,
      },
      update: {},
      select: { id: true },
    });
  }

  /** V1 soft-delete → the mirror is soft-deleted too, in the same transaction. */
  async softDeleteMirroredReport(tx: Tx, legacyMedicalReportId: string): Promise<void> {
    await tx.diagnosticReport.updateMany({
      where: { legacyMedicalReportId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async softDeleteMirroredResult(tx: Tx, legacyReportValueId: string): Promise<void> {
    await tx.diagnosticResult.updateMany({
      where: { legacyReportValueId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  // ───────────────────────── internals ─────────────────────────

  private resultData(
    profileId: string,
    diagnosticReportId: string,
    analyte: AnalyteEntry,
    input: Omit<AddDiagnosticResultInput, "sequence">,
    sequence: number,
    stamp: ReturnType<typeof stampProvenanceFor>,
  ) {
    const resolved = resolveValue(analyte, input.enteredValueText, input.enteredUnit);
    return {
      diagnosticReportId,
      patientProfileId: profileId,
      analyteKey: analyte.key,
      analyteLabelText: input.analyteLabelText ?? null,
      loincCode: analyte.loincCode,
      enteredValueText: input.enteredValueText,
      valueNumeric: resolved.unit === null ? null : resolved.canonicalValue,
      // A qualitative entry ("Negative", "Trace") keeps its words; nothing
      // downstream ever renders the numeric twin (docs/02).
      valueText: resolved.reason === "not_numeric" ? input.enteredValueText : null,
      comparator: input.comparator ?? null,
      unit: resolved.unit,
      enteredUnit: input.enteredUnit ?? null,
      referenceLow: input.referenceLow ?? null,
      referenceHigh: input.referenceHigh ?? null,
      referenceText: input.referenceText ?? null,
      interpretation: input.interpretation ?? null,
      specimenType: input.specimenType ?? null,
      sequence,
      ...stamp,
    };
  }

  /** Projects (or refreshes) the report's timeline event with its live result count (ADR-V2-008). */
  private async emitReportEvent(tx: Tx, profileId: string, actor: Actor, reportId: string, resultCount: number): Promise<void> {
    const report = await tx.diagnosticReport.findUniqueOrThrow({ where: { id: reportId } });
    if (report.deletedAt) return;
    await emitHealthEvent(tx, projectDiagnosticReport(await eventCtx(tx, profileId, actor), { ...report, resultCount }));
  }

  /** One lookup for every practitioner id on a page of reports (no per-row join). */
  private async practitionerNames(
    reports: readonly { orderingPractitionerId: string | null; reportingPractitionerId: string | null }[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = [...new Set(reports.flatMap((r) => [r.orderingPractitionerId, r.reportingPractitionerId]).filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.practitioner.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    return new Map(rows.map((p) => [p.id, p.displayName]));
  }

  private async requireOwnReport(tx: Tx | PrismaService, profileId: string, reportId: string) {
    const report = await tx.diagnosticReport.findFirst({
      where: { id: reportId, patientProfileId: profileId, deletedAt: null },
    });
    if (!report) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Report not found", 404);
    return report;
  }

  /** A result is reachable only through its own profile — a foreign id is a 404, never a peek. */
  private async requireOwnResult(profileId: string, resultId: string) {
    const result = await this.prisma.diagnosticResult.findFirst({
      where: { id: resultId, patientProfileId: profileId, deletedAt: null, diagnosticReport: { deletedAt: null } },
    });
    if (!result) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Value not found", 404);
    return result;
  }
}

/** The date a result trends against: the test date, else when the lab reported, else when it was filed. */
function effectiveAt(report: { testedAt: Date | null; reportedAt: Date | null; createdAt: Date }): Date {
  return report.testedAt ?? report.reportedAt ?? report.createdAt;
}

const V1_KIND_TITLES: Record<string, string> = {
  blood_test: "Blood test",
  urine_test: "Urine test",
  imaging: "Imaging",
  ecg: "ECG",
  pathology: "Pathology",
  discharge_summary: "Discharge summary",
  other: "Report",
};

function v1KindTitle(kind: string): string {
  return V1_KIND_TITLES[kind] ?? "Report";
}

/** Copies only the keys the caller actually sent, so `undefined` never blanks a column. */
function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}
