/**
 * Phase 4 diagnostics backfill (docs_v2/04 §6, ADR-V2-007): copies every V1
 * `MedicalReport` into `DiagnosticReport` and every `ReportValue` into
 * `DiagnosticResult`, so the V2 model holds the patient's whole history from
 * the day it goes live rather than only what was written after.
 *
 * Idempotent by construction: `legacyMedicalReportId` and
 * `legacyReportValueId` are unique columns, so a re-run — or a race with the
 * live dual-write in ReportsService — inserts nothing twice. Resumable: it
 * walks the V1 tables by id cursor in batches of 500 and can be killed and
 * restarted at any point.
 *
 * Emits no timeline events. The V1 rows already have theirs (Phase 1's
 * `backfill-health-events`), and a mirror is the same blood test, not a
 * second one.
 *
 * Logs counts only — never row content.
 */
import type { PrismaClient } from "@medpass/database";
import { MEDICAL_REPORT_KIND_TO_DIAGNOSTIC_KIND, type MedicalReportKind } from "@medpass/domain";
import { getAnalyte } from "@medpass/terminology";

export const BACKFILL_BATCH = 500;

export interface BackfillLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

/**
 * V1 has no `title` column. The patient's own label is the best title there
 * is; the report kind is the honest fallback rather than an invented name.
 */
const V1_KIND_TITLES: Record<string, string> = {
  blood_test: "Blood test",
  urine_test: "Urine test",
  imaging: "Imaging",
  ecg: "ECG",
  pathology: "Pathology",
  discharge_summary: "Discharge summary",
  other: "Report",
};

export function legacyReportTitle(kind: string, label: string | null): string {
  return label?.trim() || V1_KIND_TITLES[kind] || "Report";
}

export function legacyReportKind(kind: string) {
  return MEDICAL_REPORT_KIND_TO_DIAGNOSTIC_KIND[kind as MedicalReportKind] ?? "other";
}

export async function backfillDiagnostics(prisma: PrismaClient, log?: BackfillLogger): Promise<Record<string, number>> {
  const reports = await backfillReports(prisma, log);
  const results = await backfillResults(prisma, log);
  return { diagnostic_reports: reports, diagnostic_results: results };
}

async function backfillReports(prisma: PrismaClient, log?: BackfillLogger): Promise<number> {
  let created = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.medicalReport.findMany({
      take: BACKFILL_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    const mirrored = new Set(
      (
        await prisma.diagnosticReport.findMany({
          where: { legacyMedicalReportId: { in: batch.map((r) => r.id) } },
          select: { legacyMedicalReportId: true },
        })
      ).map((r) => r.legacyMedicalReportId),
    );
    const missing = batch.filter((r) => !mirrored.has(r.id));
    if (missing.length > 0) {
      const { count } = await prisma.diagnosticReport.createMany({
        data: missing.map((r) => ({
          patientProfileId: r.patientProfileId,
          legacyMedicalReportId: r.id,
          kind: legacyReportKind(r.kind),
          title: legacyReportTitle(r.kind, r.label),
          facilityNameText: r.facilityName,
          reportingPractitionerId: r.practitionerId,
          testedAt: r.testedAt,
          encounterId: r.encounterId,
          modality: r.kind === "imaging" ? ("other" as const) : null,
          provenanceSource: r.provenanceSource,
          verification: r.verification,
          recordedVia: r.recordedVia,
          recordedByUserId: r.recordedByUserId,
          // A V1 row that is already gone stays gone in V2 — the mirror
          // copies the lifecycle, not just the content.
          deletedAt: r.deletedAt,
          createdAt: r.createdAt,
        })),
        skipDuplicates: true,
      });
      created += count;
    }
    log?.info({ table: "diagnostic_reports", batch: batch.length, created: missing.length, total: created }, "diagnostics backfill batch");
    if (batch.length < BACKFILL_BATCH) break;
  }
  return created;
}

async function backfillResults(prisma: PrismaClient, log?: BackfillLogger): Promise<number> {
  let created = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.reportValue.findMany({
      take: BACKFILL_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    const mirrored = new Set(
      (
        await prisma.diagnosticResult.findMany({
          where: { legacyReportValueId: { in: batch.map((v) => v.id) } },
          select: { legacyReportValueId: true },
        })
      ).map((v) => v.legacyReportValueId),
    );
    const parents = new Map(
      (
        await prisma.diagnosticReport.findMany({
          where: { legacyMedicalReportId: { in: [...new Set(batch.map((v) => v.reportId))] } },
          select: { id: true, legacyMedicalReportId: true },
        })
      ).map((r) => [r.legacyMedicalReportId!, r.id]),
    );

    // Sequence continues from what the parent already holds, so a report
    // half-filled by the live dual-write never ends up with two "1"s.
    const nextSequence = new Map<string, number>();
    const rows: Array<Record<string, unknown>> = [];
    for (const v of batch) {
      if (mirrored.has(v.id)) continue;
      const parentId = parents.get(v.reportId);
      // Its report is not mirrored yet (created between the two passes).
      // Skipping is safe: the next run picks it up, and the unique legacy
      // key means the retry cannot double-insert.
      if (!parentId) continue;
      if (!nextSequence.has(parentId)) {
        nextSequence.set(parentId, (await prisma.diagnosticResult.count({ where: { diagnosticReportId: parentId } })) + 1);
      }
      const sequence = nextSequence.get(parentId)!;
      nextSequence.set(parentId, sequence + 1);
      const analyte = getAnalyte(v.analyte);
      rows.push({
        diagnosticReportId: parentId,
        patientProfileId: v.patientProfileId,
        legacyReportValueId: v.id,
        analyteKey: v.analyte,
        analyteLabelText: v.otherLabel,
        loincCode: analyte?.loincCode ?? null,
        enteredValueText: v.enteredValue,
        valueNumeric: v.numericValue,
        // V1 had no unit column: by the vocabulary's own rule the patient
        // typed the value in the analyte's printed unit, so that unit is the
        // canonical one. Nothing to convert, and nothing to guess.
        unit: analyte?.canonicalUnit ?? null,
        enteredUnit: null,
        referenceText: v.referenceText,
        sequence,
        provenanceSource: v.provenanceSource,
        verification: v.verification,
        recordedVia: v.recordedVia,
        recordedByUserId: v.recordedByUserId,
        deletedAt: v.deletedAt,
        createdAt: v.createdAt,
      });
    }
    if (rows.length > 0) {
      const { count } = await prisma.diagnosticResult.createMany({ data: rows as never, skipDuplicates: true });
      created += count;
    }
    log?.info({ table: "diagnostic_results", batch: batch.length, created: rows.length, total: created }, "diagnostics backfill batch");
    if (batch.length < BACKFILL_BATCH) break;
  }
  return created;
}
