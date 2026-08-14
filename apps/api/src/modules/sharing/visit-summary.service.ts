import { Injectable } from "@nestjs/common";
import { REPORT_ANALYTE_IDS, reportAnalyteById } from "@medpass/domain";
import { PrismaService } from "../../common/prisma.service";

export interface VisitSummarySections {
  medications: boolean;
  allergies: boolean;
  conditions: boolean;
  recentChanges: boolean;
  concerns: boolean;
  glucoseReadings: boolean;
  checkups: boolean;
  prescriptions: boolean;
  reports: boolean;
}

export const ALL_SECTIONS: VisitSummarySections = {
  medications: true,
  allergies: true,
  conditions: true,
  recentChanges: true,
  concerns: true,
  glucoseReadings: true,
  checkups: true,
  prescriptions: true,
  reports: true,
};

export interface VisitSummaryDto {
  /** timezone: the profile's IANA zone — the share landing formats clinical times in the PATIENT's day (docs/16). */
  profile: { displayName: string; yearOfBirth: number | null; sex: string | null; timezone: string };
  /** Always present — proves the summary was built just now, not cached stale (docs/12 H-12). */
  generatedAt: string;
  allergies?: Array<{ label: string; severity: string; reactionNote: string | null }>;
  conditions?: Array<{ label: string; note: string | null }>;
  currentMedications?: Array<{
    name: string;
    ingredients: string[];
    strengthLabel: string | null;
    instructionSummary: string;
    prescriberName: string | null;
    startDate: string | null;
  }>;
  recentChanges?: Array<{ medicationName: string; change: string; occurredAt: string }>;
  unresolvedConcerns?: Array<{ category: string; severity: string; summary: string }>;
  /**
   * The trend a doctor reads first, then the individual readings behind it —
   * the per-time-of-day breakdown mirrors how the paper diary this digitizes
   * is itself laid out (docs/07 screen 42).
   */
  glucoseReadings?: {
    readingCount: number;
    averageMgDl: number | null;
    lowestMgDl: number | null;
    highestMgDl: number | null;
    byContext: Array<{ context: string; count: number; averageMgDl: number }>;
    recent: Array<{ valueMgDl: number; context: string; measuredAt: string; note: string | null }>;
  };
  /** Every metric is nullable and stays null when not measured — never zero-filled. */
  checkups?: Array<{
    checkupDate: string;
    fastingGlucoseMgDl: number | null;
    postPrandialGlucoseMgDl: number | null;
    hba1cPercent: string | null;
    bloodPressureSystolic: number | null;
    bloodPressureDiastolic: number | null;
    weightKg: string | null;
    waistCircumferenceCm: string | null;
    cholesterolMgDl: number | null;
    treatmentChanges: string | null;
    nextAppointmentDate: string | null;
  }>;
  /**
   * Metadata only — deliberately no document ids or download URLs. The public
   * share view (docs/07 screen 29) is unauthenticated, so anything here is
   * readable by whoever holds the token; prescription images stay behind the
   * authenticated download endpoint.
   */
  prescriptions?: Array<{
    prescribedAt: string | null;
    practitionerName: string | null;
    notes: string | null;
    documentCount: number;
    medicationCount: number;
  }>;
  /** Metadata only, same reasoning as prescriptions — no document handles on an unauthenticated path. */
  reports?: Array<{
    kind: string;
    label: string | null;
    facilityName: string | null;
    practitionerName: string | null;
    testedAt: string | null;
    notes: string | null;
    documentCount: number;
    /**
     * Structured values transcribed off the report — label/unit resolved
     * server-side from the closed vocabulary so the worker's duplicated
     * renderer never needs the analyte mapping. enteredValue verbatim, no
     * flags, no value ids (public share path is unauthenticated).
     */
    values?: Array<{ label: string; enteredValue: string; unit: string | null; referenceText: string | null }>;
  }>;
}

const RECENT_DAYS = 90;
/** The aggregate covers every reading in the window; only this listing is capped. */
const GLUCOSE_RECENT_LIMIT = 10;

/**
 * Doctor-visit mode data (docs/07 screen 28) and the public share payload
 * (docs/07 screen 29) are the same aggregation — the only difference is
 * which `sections` are included. Always computed live from current data,
 * never served from a frozen snapshot (docs/12).
 */
@Injectable()
export class VisitSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async build(profileId: string, sections: VisitSummarySections): Promise<VisitSummaryDto> {
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: profileId } });
    const summary: VisitSummaryDto = {
      profile: { displayName: profile.displayName, yearOfBirth: profile.yearOfBirth, sex: profile.sex, timezone: profile.timezone },
      generatedAt: new Date().toISOString(),
    };

    // Each section is independent, so they run concurrently rather than as a
    // chain of awaits — with eight of them the serial version noticeably
    // slowed the PDF path, which polls on an 8s timeout.
    await Promise.all([
      this.addAllergies(profileId, sections, summary),
      this.addConditions(profileId, sections, summary),
      this.addMedications(profileId, sections, summary),
      this.addRecentChanges(profileId, sections, summary),
      this.addConcerns(profileId, sections, summary),
      this.addGlucoseReadings(profileId, sections, summary),
      this.addCheckups(profileId, sections, summary),
      this.addPrescriptions(profileId, sections, summary),
      this.addReports(profileId, sections, summary),
    ]);

    return summary;
  }

  private async addAllergies(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (sections.allergies) {
      const allergies = await this.prisma.patientAllergy.findMany({
        where: { patientProfileId: profileId, active: true, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      summary.allergies = allergies.map((a) => ({ label: a.label, severity: a.severity, reactionNote: a.reactionNote }));
    }
  }

  private async addConditions(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (sections.conditions) {
      const conditions = await this.prisma.patientCondition.findMany({
        where: { patientProfileId: profileId, active: true, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      summary.conditions = conditions.map((c) => ({ label: c.label, note: c.note }));
    }
  }

  private async addMedications(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (sections.medications) {
      const meds = await this.prisma.patientMedication.findMany({
        where: { patientProfileId: profileId, status: "current", deletedAt: null },
        include: {
          product: { include: { brand: true, ingredients: { include: { ingredient: true } } } },
          practitioner: true,
          instructions: { where: { supersededAt: null }, take: 1 },
        },
        orderBy: { createdAt: "asc" },
      });
      summary.currentMedications = meds.map((m) => {
        const instruction = m.instructions[0];
        return {
          // No internal medication id on this payload: it also feeds the
          // unauthenticated public share path, and the recipient never needs
          // the DB identifier (Stage-7 security review, data minimization).
          name: m.product?.brand?.name ?? m.enteredName,
          ingredients: m.product?.ingredients.map((i) => i.ingredient.name) ?? [],
          strengthLabel: m.product?.strengthLabel ?? null,
          // A recorded pattern IS the schedule ("1-0-1"); show it directly on
          // this doctor-facing summary rather than the internal enum prefix
          // ("PATTERN 1-0-1"). Non-pattern codes (OD/BD/…) are standard
          // clinical shorthand and stay as-is. Same rule as patient-web's
          // instructionSummary.
          instructionSummary: instruction
            ? `${instruction.doseQuantity} ${instruction.doseUnit} · ${instruction.pattern ?? instruction.frequencyCode} · ${instruction.foodInstruction}`
            : "",
          prescriberName: m.practitioner?.displayName ?? null,
          startDate: m.startDate?.toISOString().slice(0, 10) ?? null,
        };
      });
    }
  }

  private async addRecentChanges(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (sections.recentChanges) {
      const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
      const changes = await this.prisma.medicationChange.findMany({
        where: { occurredAt: { gte: cutoff }, patientMedication: { patientProfileId: profileId } },
        include: { patientMedication: { select: { enteredName: true } } },
        orderBy: { occurredAt: "desc" },
        take: 20,
      });
      summary.recentChanges = changes.map((c) => ({
        medicationName: c.patientMedication.enteredName,
        change: c.change,
        occurredAt: c.occurredAt.toISOString(),
      }));
    }
  }

  private async addConcerns(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (sections.concerns) {
      const latestEvaluation = await this.prisma.safetyEvaluation.findFirst({
        where: { patientProfileId: profileId },
        orderBy: { startedAt: "desc" },
      });
      const findings = latestEvaluation
        ? await this.prisma.safetyFinding.findMany({
            where: { evaluationId: latestEvaluation.id, status: { in: ["open", "acknowledged"] } },
            orderBy: { severity: "desc" },
          })
        : [];
      summary.unresolvedConcerns = findings.map((f) => ({
        category: f.category,
        severity: f.severity,
        summary: (f.detail as { medicationNames?: string[]; medicationName?: string } | null)?.medicationNames?.join(" + ") ??
          (f.detail as { medicationName?: string } | null)?.medicationName ??
          f.category,
      }));
    }
  }

  /**
   * Aggregate first, then the individual readings behind it (docs/07 screen
   * 42). A diabetic patient can have hundreds of readings, so both the window
   * and the row list are bounded — the aggregate still counts every reading
   * in the window, only the listed rows are capped.
   */
  private async addGlucoseReadings(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.glucoseReadings) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const readings = await this.prisma.glucoseReading.findMany({
      where: { patientProfileId: profileId, deletedAt: null, measuredAt: { gte: cutoff } },
      orderBy: { measuredAt: "desc" },
    });

    const values = readings.map((r) => r.valueMgDl);
    const byContext = new Map<string, number[]>();
    for (const r of readings) {
      const bucket = byContext.get(r.context) ?? [];
      bucket.push(r.valueMgDl);
      byContext.set(r.context, bucket);
    }
    const mean = (nums: number[]) => Math.round(nums.reduce((sum, n) => sum + n, 0) / nums.length);

    summary.glucoseReadings = {
      readingCount: readings.length,
      averageMgDl: values.length ? mean(values) : null,
      lowestMgDl: values.length ? Math.min(...values) : null,
      highestMgDl: values.length ? Math.max(...values) : null,
      byContext: [...byContext.entries()].map(([context, nums]) => ({
        context,
        count: nums.length,
        averageMgDl: mean(nums),
      })),
      recent: readings.slice(0, GLUCOSE_RECENT_LIMIT).map((r) => ({
        valueMgDl: r.valueMgDl,
        context: r.context,
        measuredAt: r.measuredAt.toISOString(),
        note: r.note,
      })),
    };
  }

  private async addCheckups(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.checkups) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const checkups = await this.prisma.checkupRecord.findMany({
      where: { patientProfileId: profileId, deletedAt: null, checkupDate: { gte: cutoff } },
      orderBy: { checkupDate: "desc" },
      take: 5,
    });
    // Decimals are stringified explicitly rather than left to the JSON
    // serializer, so every renderer downstream gets a predictable shape.
    summary.checkups = checkups.map((c) => ({
      checkupDate: c.checkupDate.toISOString().slice(0, 10),
      fastingGlucoseMgDl: c.fastingGlucoseMgDl,
      postPrandialGlucoseMgDl: c.postPrandialGlucoseMgDl,
      hba1cPercent: c.hba1cPercent?.toString() ?? null,
      bloodPressureSystolic: c.bloodPressureSystolic,
      bloodPressureDiastolic: c.bloodPressureDiastolic,
      weightKg: c.weightKg?.toString() ?? null,
      waistCircumferenceCm: c.waistCircumferenceCm?.toString() ?? null,
      cholesterolMgDl: c.cholesterolMgDl,
      treatmentChanges: c.treatmentChanges,
      nextAppointmentDate: c.nextAppointmentDate?.toISOString().slice(0, 10) ?? null,
    }));
  }

  private async addPrescriptions(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.prescriptions) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const prescriptions = await this.prisma.prescription.findMany({
      // A prescription with no date recorded still belongs in the window —
      // fall back to when it was filed rather than dropping it silently.
      where: {
        patientProfileId: profileId,
        deletedAt: null,
        OR: [{ prescribedAt: { gte: cutoff } }, { prescribedAt: null, createdAt: { gte: cutoff } }],
      },
      include: { practitioner: true, _count: { select: { documents: true, medications: true } } },
      orderBy: [{ prescribedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
    });
    summary.prescriptions = prescriptions.map((p) => ({
      prescribedAt: p.prescribedAt?.toISOString().slice(0, 10) ?? null,
      practitionerName: p.practitioner?.displayName ?? null,
      notes: p.notes,
      documentCount: p._count.documents,
      medicationCount: p._count.medications,
    }));
  }

  private async addReports(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.reports) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const reports = await this.prisma.medicalReport.findMany({
      // A report with no test date recorded still belongs in the window —
      // fall back to when it was filed rather than dropping it silently.
      where: {
        patientProfileId: profileId,
        deletedAt: null,
        OR: [{ testedAt: { gte: cutoff } }, { testedAt: null, createdAt: { gte: cutoff } }],
      },
      include: {
        practitioner: true,
        _count: { select: { documents: true } },
        // Cap 30 = the vocabulary size: a genuine full-panel report is never
        // truncated, only `other`-spam is (a 50/report write guard exists too).
        values: { where: { deletedAt: null }, take: 30 },
      },
      orderBy: [{ testedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
    });
    const vocabularyOrder = new Map(REPORT_ANALYTE_IDS.map((id, i) => [id, i]));
    summary.reports = reports.map((r) => ({
      kind: r.kind,
      label: r.label,
      facilityName: r.facilityName,
      practitionerName: r.practitioner?.displayName ?? null,
      testedAt: r.testedAt?.toISOString().slice(0, 10) ?? null,
      notes: r.notes,
      documentCount: r._count.documents,
      values: [...r.values]
        .sort((a, b) => (vocabularyOrder.get(a.analyte) ?? 999) - (vocabularyOrder.get(b.analyte) ?? 999))
        .map((v) => ({
          // Label/unit resolved here, server-side, so the worker's duplicated
          // renderer never needs the analyte mapping. enteredValue verbatim —
          // the parsed numericValue is never rendered anywhere.
          label: v.analyte === "other" ? (v.otherLabel ?? "Other test value") : (reportAnalyteById(v.analyte)?.label ?? v.analyte),
          enteredValue: v.enteredValue,
          unit: reportAnalyteById(v.analyte)?.unit ?? null,
          referenceText: v.referenceText,
        })),
    }));
  }
}
