import { Injectable } from "@nestjs/common";
import { REPORT_ANALYTE_IDS, reportAnalyteById } from "@medpass/domain";
import { getAnalyte, getObservationConcept } from "@medpass/terminology";
import { PrismaService } from "../../common/prisma.service";

/**
 * Sections a summary/share can carry (docs_v2/04 §11). `full_passport` is
 * not a section of its own: at share creation it expands to every other key
 * being true (documents included) and is stored alongside them so the list
 * screen can still say "full passport" — the builder never reads it.
 */
export interface VisitSummarySections {
  medications: boolean;
  allergies: boolean;
  conditions: boolean;
  recentChanges: boolean;
  concerns: boolean;
  glucoseReadings: boolean;
  bloodPressureReadings: boolean;
  weightReadings: boolean;
  checkups: boolean;
  prescriptions: boolean;
  reports: boolean;
  /** V2: Observation aggregates per concept (30 days). */
  measurements: boolean;
  /** V2: document metadata, and page access through the public document route. */
  documents: boolean;
  /** V2: recent encounters. */
  encounters: boolean;
}

/** Everything — the patient's own authenticated view, and a `full_passport` share. */
export const ALL_SECTIONS: VisitSummarySections = {
  medications: true,
  allergies: true,
  conditions: true,
  recentChanges: true,
  concerns: true,
  glucoseReadings: true,
  bloodPressureReadings: true,
  weightReadings: true,
  checkups: true,
  prescriptions: true,
  reports: true,
  measurements: true,
  documents: true,
  encounters: true,
};

/**
 * What a share gets when the patient sends `sections: {}`. Every V1 section
 * plus measurements and encounters — but NOT documents. Sharing the actual
 * uploaded pages is a new surface (docs_v2/06 P7-4): a recipient holding
 * the link can open every page of every document, so that has to be chosen
 * by name (or via `full_passport`), never inherited from "share everything
 * I used to share".
 */
export const DEFAULT_SHARE_SECTIONS: VisitSummarySections = { ...ALL_SECTIONS, documents: false };

/**
 * Turns the client's partial section map into the frozen booleans a share
 * stores. `full_passport` wins over every individual flag.
 */
export function resolveShareSections(input: Partial<VisitSummarySections> & { full_passport?: boolean }): VisitSummarySections & { full_passport: boolean } {
  const { full_passport, ...flags } = input;
  if (full_passport) return { ...ALL_SECTIONS, full_passport: true };
  return { ...DEFAULT_SHARE_SECTIONS, ...flags, full_passport: false };
}

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
  /**
   * `change` stays the raw kind — every renderer has its own label table for
   * it (the app translates, the PDF/text exports print English), and a
   * pre-rendered sentence here would be English on a Telugu screen.
   * `statusTo` carries the one detail a label cannot say on its own: which
   * status a `status_changed` entry moved to. Nothing else from `detail`
   * comes along — this payload is read by whoever holds an unauthenticated
   * link.
   */
  recentChanges?: Array<{ medicationName: string; change: string; statusTo: string | null; occurredAt: string }>;
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
  /** Same shape philosophy as glucoseReadings: window aggregate first, capped row list behind it. */
  bloodPressureReadings?: {
    readingCount: number;
    averageSystolic: number | null;
    averageDiastolic: number | null;
    recent: Array<{ systolic: number; diastolic: number; pulseBpm: number | null; measuredAt: string; note: string | null }>;
  };
  weightReadings?: {
    readingCount: number;
    /** Prisma Decimal stringified; null when no readings in the window. */
    latestKg: string | null;
    /** Signed latest-minus-earliest across the window (1 dp) — arithmetic only, never a trend judgment. */
    changeKg: string | null;
    recent: Array<{ weightKg: string; measuredAt: string; note: string | null }>;
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
  /**
   * V1 `MedicalReport` rows and V2 `DiagnosticReport` rows in one list,
   * newest first. Metadata only, same reasoning as prescriptions — no
   * document handles on an unauthenticated path.
   *
   * `kind` is whichever vocabulary the row came from: `MedicalReportKind`
   * (blood_test, urine_test, discharge_summary, …) or `DiagnosticReportKind`
   * (laboratory, echo, microbiology, genetics, …). The two overlap on
   * imaging/ecg/pathology/other and are otherwise disjoint, so a renderer
   * can key one label table off the value without needing to know which
   * table the row came from.
   */
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
  /**
   * V2 Observation aggregates per concept over the last 30 days (docs_v2/05
   * §9 "30-day measurements"). Arithmetic only — count/min/max/average of
   * what the patient recorded, in the concept's canonical unit; never an
   * interpretation (hazard H-25). Blood pressure carries both components.
   */
  measurements?: Array<{
    concept: string;
    label: string;
    unit: string;
    count: number;
    latest: { value: string; value2: string | null; measuredAt: string; context: string | null } | null;
    minimum: string | null;
    maximum: string | null;
    average: string | null;
    average2: string | null;
  }>;
  /**
   * V2 documents (docs_v2/05 §9). Metadata plus the document id — the one
   * place an id is allowed on the public payload, because the recipient
   * needs it for `public/shares/:token/documents/:id/pages/:n`, and it is
   * useless without the token. Only present when the share chose
   * `documents` explicitly; never on the default share.
   */
  documents?: Array<{
    id: string;
    kind: string;
    title: string | null;
    documentDate: string | null;
    pageCount: number;
    uploadedAt: string;
  }>;
  /** V2 encounters — visits and admissions, newest first. */
  encounters?: Array<{
    kind: string;
    startedAt: string;
    endedAt: string | null;
    organizationName: string | null;
    practitionerName: string | null;
    reasonText: string | null;
    diagnosisText: string | null;
  }>;
}

const RECENT_DAYS = 90;
/** The aggregate covers every reading in the window; only this listing is capped. */
const GLUCOSE_RECENT_LIMIT = 10;
/** docs_v2/05 §9: measurements are summarised over the last 30 days. */
const MEASUREMENT_DAYS = 30;
const DOCUMENTS_LIMIT = 20;
const ENCOUNTERS_LIMIT = 10;
/** Shared by the V1 and V2 report queries and by the merged list. */
const REPORTS_LIMIT = 10;

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
      this.addBloodPressureReadings(profileId, sections, summary),
      this.addWeightReadings(profileId, sections, summary),
      this.addCheckups(profileId, sections, summary),
      this.addPrescriptions(profileId, sections, summary),
      this.addReports(profileId, sections, summary),
      this.addMeasurements(profileId, sections, summary),
      this.addDocuments(profileId, sections, summary),
      this.addEncounters(profileId, sections, summary),
    ]);

    return summary;
  }

  /**
   * 30-day Observation aggregates per concept (docs_v2/04 §5, ADR-V2-011).
   * Every number is arithmetic on the canonical column; a concept with no
   * numeric value (`other`, free text) is counted but never averaged.
   */
  private async addMeasurements(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.measurements) return;
    const cutoff = new Date(Date.now() - MEASUREMENT_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.observation.findMany({
      where: { patientProfileId: profileId, deletedAt: null, measuredAt: { gte: cutoff } },
      orderBy: { measuredAt: "desc" },
      select: { concept: true, valueNumeric: true, valueNumeric2: true, unit: true, measuredAt: true, context: true },
    });
    const byConcept = new Map<string, typeof rows>();
    for (const r of rows) {
      const bucket = byConcept.get(r.concept) ?? [];
      bucket.push(r);
      byConcept.set(r.concept, bucket);
    }
    const stat = (nums: number[], f: (n: number[]) => number) => (nums.length ? String(Math.round(f(nums) * 100) / 100) : null);
    summary.measurements = [...byConcept.entries()].map(([concept, list]) => {
      const entry = getObservationConcept(concept);
      const values = list.map((r) => (r.valueNumeric == null ? null : Number(r.valueNumeric))).filter((n): n is number => n !== null);
      const values2 = list.map((r) => (r.valueNumeric2 == null ? null : Number(r.valueNumeric2))).filter((n): n is number => n !== null);
      const latest = list[0]!;
      return {
        concept,
        label: entry?.display ?? concept,
        // The human unit ("mmHg"), not the stored UCUM code ("mm[Hg]") — this is read by people, not by a converter.
        unit: entry?.canonicalUnitDisplay ?? latest.unit,
        count: list.length,
        latest: {
          value: latest.valueNumeric?.toString() ?? "",
          value2: latest.valueNumeric2?.toString() ?? null,
          measuredAt: latest.measuredAt.toISOString(),
          context: latest.context,
        },
        minimum: stat(values, (n) => Math.min(...n)),
        maximum: stat(values, (n) => Math.max(...n)),
        average: stat(values, (n) => n.reduce((a, b) => a + b, 0) / n.length),
        average2: stat(values2, (n) => n.reduce((a, b) => a + b, 0) / n.length),
      };
    });
  }

  /** Uploaded V2 documents, newest first — metadata and the id the public page route needs. */
  private async addDocuments(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.documents) return;
    const documents = await this.prisma.patientDocument.findMany({
      where: { patientProfileId: profileId, deletedAt: null, status: { notIn: ["pending_upload", "deleted"] } },
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
      take: DOCUMENTS_LIMIT,
      select: { id: true, kind: true, title: true, documentDate: true, pageCount: true, createdAt: true },
    });
    summary.documents = documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      documentDate: d.documentDate?.toISOString().slice(0, 10) ?? null,
      pageCount: d.pageCount,
      uploadedAt: d.createdAt.toISOString(),
    }));
  }

  private async addEncounters(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.encounters) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const encounters = await this.prisma.encounter.findMany({
      where: { patientProfileId: profileId, deletedAt: null, startedAt: { gte: cutoff } },
      include: { organization: { select: { displayName: true } }, practitioner: { select: { displayName: true } } },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      take: ENCOUNTERS_LIMIT,
    });
    summary.encounters = encounters.map((e) => ({
      kind: e.kind,
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt?.toISOString() ?? null,
      organizationName: e.organization?.displayName ?? null,
      practitionerName: e.practitioner?.displayName ?? null,
      reasonText: e.reasonText,
      diagnosisText: e.diagnosisText,
    }));
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
      summary.recentChanges = changes.map((c) => {
        // Only `to` is carried across, and only for a status change. The rest
        // of `detail` (who, why, which fields) has no place on a payload the
        // holder of a link can read.
        const to = (c.detail as { to?: unknown } | null)?.to;
        return {
          medicationName: c.patientMedication.enteredName,
          change: c.change,
          statusTo: c.change === "status_changed" && typeof to === "string" ? to : null,
          occurredAt: c.occurredAt.toISOString(),
        };
      });
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

  private async addBloodPressureReadings(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.bloodPressureReadings) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const readings = await this.prisma.bloodPressureReading.findMany({
      where: { patientProfileId: profileId, deletedAt: null, measuredAt: { gte: cutoff } },
      orderBy: { measuredAt: "desc" },
    });

    const mean = (nums: number[]) => Math.round(nums.reduce((sum, n) => sum + n, 0) / nums.length);
    summary.bloodPressureReadings = {
      readingCount: readings.length,
      averageSystolic: readings.length ? mean(readings.map((r) => r.systolic)) : null,
      averageDiastolic: readings.length ? mean(readings.map((r) => r.diastolic)) : null,
      recent: readings.slice(0, GLUCOSE_RECENT_LIMIT).map((r) => ({
        systolic: r.systolic,
        diastolic: r.diastolic,
        pulseBpm: r.pulseBpm,
        measuredAt: r.measuredAt.toISOString(),
        note: r.note,
      })),
    };
  }

  private async addWeightReadings(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.weightReadings) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const readings = await this.prisma.weightReading.findMany({
      where: { patientProfileId: profileId, deletedAt: null, measuredAt: { gte: cutoff } },
      orderBy: { measuredAt: "desc" },
    });

    // latest minus earliest within the window, signed — plain arithmetic on
    // what the patient recorded, deliberately never labelled gain/loss.
    const latest = readings[0];
    const earliest = readings[readings.length - 1];
    const changeKg =
      readings.length >= 2 ? (Number(latest!.weightKg) - Number(earliest!.weightKg)).toFixed(1) : null;

    summary.weightReadings = {
      readingCount: readings.length,
      latestKg: latest ? latest.weightKg.toString() : null,
      changeKg,
      recent: readings.slice(0, GLUCOSE_RECENT_LIMIT).map((r) => ({
        weightKg: r.weightKg.toString(),
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
      include: {
        practitioner: true,
        // `documents`/`medications` are the V1 relations; `items` is where a
        // V2 prescription's lines actually live, and its evidence is a
        // PatientDocument, not a PrescriptionDocument. Counting only the V1
        // pair is why a two-line prescription read "0 medicine(s) · 0
        // file(s)" — the same bug just fixed in reprojectPrescription.
        _count: { select: { documents: true, medications: true, items: { where: { deletedAt: null } } } },
      },
      orderBy: [{ prescribedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
    });
    const v2DocumentCounts = await this.countDocumentsBy("prescriptionId", prescriptions.map((p) => p.id));
    summary.prescriptions = prescriptions.map((p) => ({
      prescribedAt: p.prescribedAt?.toISOString().slice(0, 10) ?? null,
      practitionerName: p.practitioner?.displayName ?? null,
      notes: p.notes,
      documentCount: p._count.documents + (v2DocumentCounts.get(p.id) ?? 0),
      // The lines as written on the paper are the medicine count; the V1
      // linkage to started medicines is the fallback for rows that predate
      // prescription lines.
      medicationCount: p._count.items || p._count.medications,
    }));
  }

  /**
   * Test reports, V1 and V2 in one list (docs_v2/04 §6). `MedicalReport` is
   * the V1 table; `DiagnosticReport` is what the app writes now, and a
   * patient whose reports are all V2 was previously shown nothing at all
   * here — the share said "Test reports shared (0)" while holding two.
   *
   * Rows the V1 writer mirrored into V2 (`legacyMedicalReportId`) are taken
   * from the V1 side only, so a mirrored report is listed once, not twice.
   */
  private async addReports(profileId: string, sections: VisitSummarySections, summary: VisitSummaryDto): Promise<void> {
    if (!sections.reports) return;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const [legacy, diagnostic] = await Promise.all([
      this.legacyReports(profileId, cutoff),
      this.diagnosticReports(profileId, cutoff),
    ]);
    summary.reports = [...legacy, ...diagnostic]
      // Newest first on the date the patient recorded; a report with no test
      // date sorts on when it was filed rather than dropping to the bottom.
      .sort((a, b) => b.sortAt - a.sortAt)
      .slice(0, REPORTS_LIMIT)
      .map(({ sortAt: _sortAt, ...row }) => row);
  }

  /** V1 `MedicalReport` rows, with their transcribed values. */
  private async legacyReports(profileId: string, cutoff: Date) {
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
      take: REPORTS_LIMIT,
    });
    const vocabularyOrder = new Map(REPORT_ANALYTE_IDS.map((id, i) => [id, i]));
    return reports.map((r) => ({
      sortAt: (r.testedAt ?? r.createdAt).getTime(),
      kind: r.kind as string,
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

  /**
   * V2 `DiagnosticReport` rows. Practitioner names need their own lookup —
   * the model carries ids with no Prisma relation (the directory is global
   * and merge-able), and the evidence for a V2 report is a PatientDocument
   * keyed by `diagnosticReportId`, so that count is a second query too.
   */
  private async diagnosticReports(profileId: string, cutoff: Date) {
    const reports = await this.prisma.diagnosticReport.findMany({
      where: {
        patientProfileId: profileId,
        deletedAt: null,
        // A row mirrored from V1 is the same test as the V1 row, not a second one.
        legacyMedicalReportId: null,
        OR: [{ testedAt: { gte: cutoff } }, { testedAt: null, createdAt: { gte: cutoff } }],
      },
      include: {
        results: {
          where: { deletedAt: null, supersededById: null },
          orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
          take: 30,
        },
      },
      orderBy: [{ testedAt: "desc" }, { createdAt: "desc" }],
      take: REPORTS_LIMIT,
    });
    const practitionerIds = [...new Set(reports.map((r) => r.orderingPractitionerId ?? r.reportingPractitionerId).filter((id): id is string => !!id))];
    const [practitioners, documentCounts] = await Promise.all([
      practitionerIds.length
        ? this.prisma.practitioner.findMany({ where: { id: { in: practitionerIds } }, select: { id: true, displayName: true } })
        : Promise.resolve([]),
      this.countDocumentsBy("diagnosticReportId", reports.map((r) => r.id)),
    ]);
    const names = new Map(practitioners.map((p) => [p.id, p.displayName]));
    return reports.map((r) => {
      const who = r.orderingPractitionerId ?? r.reportingPractitionerId;
      return {
        sortAt: (r.testedAt ?? r.createdAt).getTime(),
        kind: r.kind as string,
        label: r.title,
        facilityName: r.facilityNameText,
        practitionerName: (who && names.get(who)) || null,
        testedAt: r.testedAt?.toISOString().slice(0, 10) ?? null,
        // The narrative blocks, verbatim as transcribed off the report. On an
        // imaging report this is the clinically important part, so it is
        // carried rather than dropped for want of a `notes` column.
        notes: [r.impressionText, r.findingsText, r.conclusionText].filter(Boolean).join(" · ") || null,
        documentCount: documentCounts.get(r.id) ?? 0,
        values: r.results.map((v) => ({
          label: v.analyteKey === "other" ? (v.analyteLabelText ?? "Other test value") : (getAnalyte(v.analyteKey)?.display ?? v.analyteLabelText ?? v.analyteKey),
          // Verbatim, and the unit as printed on the report in preference to
          // the canonical one it was converted into (H-39: what the patient
          // sees on the paper is what the doctor is shown).
          enteredValue: v.enteredValueText,
          unit: v.enteredUnit ?? v.unit,
          referenceText: v.referenceText,
        })),
      };
    });
  }

  /**
   * How many V2 documents point at each of these rows, in one query. Shared
   * by prescriptions and diagnostic reports; `PatientDocument` carries the
   * foreign key as a plain column with no back-relation on either model.
   */
  private async countDocumentsBy(field: "prescriptionId" | "diagnosticReportId", ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.patientDocument.groupBy({
      by: [field],
      where: { [field]: { in: ids }, deletedAt: null, status: { notIn: ["pending_upload", "deleted"] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r[field] as string, r._count._all]));
  }
}
