import type { HealthEventKind, RecordSource, VerificationState } from "@medpass/database";
import type { HealthEventInput } from "./index";
import { localIso } from "./local-time";

/**
 * Projection rules: how each clinical row becomes a timeline event
 * (docs_v2/04 §9.1). Pure functions — the caller supplies the row and the
 * patient's timezone and passes the result to `emitHealthEvent`. Summaries
 * carry only what the same reader already sees on the source row.
 */

interface ProvenanceBits {
  provenanceSource?: RecordSource | null;
  verification?: VerificationState | null;
  recordedByUserId?: string | null;
}

interface Ctx {
  patientProfileId: string;
  timezone: string;
  actorUserId?: string | null;
  actorType?: HealthEventInput["actorType"];
}

function base(ctx: Ctx, row: ProvenanceBits, kind: HealthEventKind, entityType: string, entityId: string, occurredAt: Date, summary: Record<string, unknown>, encounterId?: string | null): HealthEventInput {
  return {
    patientProfileId: ctx.patientProfileId,
    kind,
    entityType,
    entityId,
    occurredAt,
    occurredAtLocal: localIso(occurredAt, ctx.timezone),
    summary,
    encounterId: encounterId ?? null,
    actorUserId: ctx.actorUserId ?? row.recordedByUserId ?? null,
    actorType: ctx.actorType ?? "patient",
    provenanceSource: row.provenanceSource ?? null,
    verification: row.verification ?? null,
  };
}

/** Date-only columns (@db.Date) arrive as UTC midnight; anchor them to noon in the patient's zone so they sort inside the right local day. */
export function dateOnlyToInstant(date: Date, timezone: string): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  // Find the UTC instant of 12:00 local on that calendar day.
  const guess = new Date(Date.UTC(y, m, d, 12, 0, 0));
  const local = localIso(guess, timezone); // e.g. 2026-09-06T17:30:00
  const [, hh, mm] = /T(\d{2}):(\d{2})/.exec(local) ?? [];
  const offsetMin = (Number(hh) - 12) * 60 + Number(mm);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

export function projectAllergy(ctx: Ctx, row: ProvenanceBits & { id: string; label: string; severity: string; category?: string | null; createdAt: Date }): HealthEventInput {
  return base(ctx, row, "allergy_recorded", "patient_allergy", row.id, row.createdAt, {
    label: row.label,
    severity: row.severity,
    category: row.category ?? null,
  });
}

export function projectCondition(
  ctx: Ctx,
  row: ProvenanceBits & { id: string; label: string; clinicalStatus?: string | null; onsetDate?: Date | null; createdAt: Date; encounterId?: string | null },
): HealthEventInput {
  const occurredAt = row.onsetDate ? dateOnlyToInstant(row.onsetDate, ctx.timezone) : row.createdAt;
  return base(ctx, row, "condition_recorded", "patient_condition", row.id, occurredAt, {
    label: row.label,
    clinicalStatus: row.clinicalStatus ?? null,
    dateSource: row.onsetDate ? "onset" : "recorded",
  }, row.encounterId);
}

export function projectPrescription(
  ctx: Ctx,
  row: ProvenanceBits & { id: string; prescribedAt?: Date | null; createdAt: Date; encounterId?: string | null; practitionerName?: string | null; medicineCount?: number },
): HealthEventInput {
  const occurredAt = row.prescribedAt ? dateOnlyToInstant(row.prescribedAt, ctx.timezone) : row.createdAt;
  return base(ctx, row, "prescription", "prescription", row.id, occurredAt, {
    practitionerName: row.practitionerName ?? null,
    medicineCount: row.medicineCount ?? null,
    dateSource: row.prescribedAt ? "prescribed" : "filed",
  }, row.encounterId);
}

const MEDICATION_CHANGE_KINDS: Record<string, HealthEventKind> = {
  created: "medicine_started",
  started: "medicine_started",
  instruction_updated: "medicine_changed",
  dose_changed: "medicine_changed",
  frequency_changed: "medicine_changed",
  updated: "medicine_changed",
  dose_unit_confirmed: "medicine_changed",
  paused: "medicine_paused",
  resumed: "medicine_resumed",
  stopped: "medicine_stopped",
  completed: "medicine_completed",
  deleted: "medicine_stopped",
  reconciled_continue: "reconciliation",
  reconciled_stop: "medicine_stopped",
  reconciled_change: "medicine_changed",
};

/** Maps a V1 `MedicationChange.change` string onto a timeline kind; unknown strings become `medicine_changed`. */
export function medicationChangeKind(change: string, detail?: Record<string, unknown> | null): HealthEventKind {
  const direct = MEDICATION_CHANGE_KINDS[change];
  if (direct) return direct;
  if (change === "status_changed" || change.startsWith("status")) {
    const to = typeof detail?.to === "string" ? detail.to : typeof detail?.status === "string" ? detail.status : "";
    if (to === "paused") return "medicine_paused";
    if (to === "current") return "medicine_resumed";
    if (to === "stopped") return "medicine_stopped";
    if (to === "completed") return "medicine_completed";
  }
  return "medicine_changed";
}

export function projectMedicationChange(
  ctx: Ctx,
  medication: ProvenanceBits & { id: string; enteredName: string; displayName?: string | null },
  change: { id: string; change: string; detail?: Record<string, unknown> | null; actorUserId: string; occurredAt: Date },
): HealthEventInput {
  const kind = medicationChangeKind(change.change, change.detail ?? null);
  return {
    ...base({ ...ctx, actorUserId: change.actorUserId }, medication, kind, "medication_change", change.id, change.occurredAt, {
      medicationId: medication.id,
      name: medication.displayName ?? medication.enteredName,
      change: change.change,
      detail: change.detail ?? null,
    }),
  };
}

export function projectReport(
  ctx: Ctx,
  row: ProvenanceBits & { id: string; kind: string; label?: string | null; facilityName?: string | null; testedAt?: Date | null; createdAt: Date; encounterId?: string | null; valueCount?: number },
): HealthEventInput {
  const occurredAt = row.testedAt ? dateOnlyToInstant(row.testedAt, ctx.timezone) : row.createdAt;
  const kind: HealthEventKind = row.kind === "imaging" ? "imaging_report" : "test_result";
  return base(ctx, row, kind, "medical_report", row.id, occurredAt, {
    reportKind: row.kind,
    label: row.label ?? null,
    facilityName: row.facilityName ?? null,
    valueCount: row.valueCount ?? null,
    dateSource: row.testedAt ? "tested" : "filed",
  }, row.encounterId);
}

export function projectReading(
  ctx: Ctx,
  concept: "blood_glucose" | "blood_pressure" | "body_weight",
  row: ProvenanceBits & { id: string; measuredAt: Date; summary: Record<string, unknown> },
): HealthEventInput {
  const entityType = concept === "blood_glucose" ? "glucose_reading" : concept === "blood_pressure" ? "blood_pressure_reading" : "weight_reading";
  return base(ctx, row, "measurement", entityType, row.id, row.measuredAt, { concept, ...row.summary });
}

export function projectCheckup(
  ctx: Ctx,
  row: ProvenanceBits & { id: string; checkupDate: Date; createdAt: Date; practitionerName?: string | null; metrics?: Record<string, unknown> },
): HealthEventInput {
  return base(ctx, row, "doctor_visit", "checkup_record", row.id, dateOnlyToInstant(row.checkupDate, ctx.timezone), {
    practitionerName: row.practitionerName ?? null,
    metrics: row.metrics ?? null,
  });
}

export function projectEncounter(
  ctx: Ctx,
  row: ProvenanceBits & { id: string; kind: string; startedAt: Date; endedAt?: Date | null; organizationName?: string | null; practitionerName?: string | null; reasonText?: string | null },
): HealthEventInput[] {
  const events: HealthEventInput[] = [];
  const startKind: HealthEventKind = row.kind === "inpatient" ? "hospital_admission" : "doctor_visit";
  events.push(
    base(ctx, row, startKind, "encounter", row.id, row.startedAt, {
      encounterKind: row.kind,
      organizationName: row.organizationName ?? null,
      practitionerName: row.practitionerName ?? null,
      reasonText: row.reasonText ?? null,
    }, row.id),
  );
  if (row.kind === "inpatient" && row.endedAt) {
    events.push(base(ctx, row, "discharge", "encounter", row.id, row.endedAt, { encounterKind: row.kind, organizationName: row.organizationName ?? null }, row.id));
  }
  return events;
}

export function projectImmunization(
  ctx: Ctx,
  row: ProvenanceBits & { id: string; vaccineText: string; doseNumber?: number | null; administeredOn: Date },
): HealthEventInput {
  return base(ctx, row, "immunization", "immunization", row.id, dateOnlyToInstant(row.administeredOn, ctx.timezone), {
    vaccine: row.vaccineText,
    doseNumber: row.doseNumber ?? null,
  });
}

export function projectProcedure(
  ctx: Ctx,
  row: ProvenanceBits & { id: string; procedureText: string; performedOn: Date; encounterId?: string | null },
): HealthEventInput {
  return base(ctx, row, "procedure", "procedure", row.id, dateOnlyToInstant(row.performedOn, ctx.timezone), { procedure: row.procedureText }, row.encounterId);
}

export function projectShare(
  ctx: Ctx,
  row: { id: string; createdAt: Date; sections: unknown; expiresAt?: Date | null; recordedByUserId?: string | null },
): HealthEventInput {
  return base(ctx, row, "share_created", "share_link", row.id, row.createdAt, {
    sections: Array.isArray(row.sections) ? row.sections : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  });
}

export function projectDocument(
  ctx: Ctx,
  row: ProvenanceBits & { id: string; kind: string; createdAt: Date; documentDate?: Date | null; pageCount?: number | null; prescriptionId?: string | null; reportId?: string | null },
): HealthEventInput {
  const occurredAt = row.documentDate ? dateOnlyToInstant(row.documentDate, ctx.timezone) : row.createdAt;
  return base(ctx, row, "document", "prescription_document", row.id, occurredAt, {
    documentKind: row.kind,
    pageCount: row.pageCount ?? null,
    linkedPrescriptionId: row.prescriptionId ?? null,
    linkedReportId: row.reportId ?? null,
    dateSource: row.documentDate ? "document" : "uploaded",
  });
}

/**
 * V2 diagnostics (docs_v2/04 §6.2, ADR-V2-011's sibling for labs). The
 * event key is `("diagnostic_report", id)`, never `("medical_report", id)`:
 * during the dual-write window a V1 report and its V2 mirror are two rows
 * describing one test, and only the V1 write emits — otherwise the timeline
 * would show the same blood test twice.
 */
export function projectDiagnosticReport(
  ctx: Ctx,
  row: ProvenanceBits & {
    id: string;
    kind: string;
    title?: string | null;
    facilityNameText?: string | null;
    testedAt?: Date | null;
    reportedAt?: Date | null;
    createdAt: Date;
    encounterId?: string | null;
    modality?: string | null;
    resultCount?: number;
  },
): HealthEventInput {
  const occurredAt = row.testedAt
    ? dateOnlyToInstant(row.testedAt, ctx.timezone)
    : (row.reportedAt ?? row.createdAt);
  const kind: HealthEventKind = row.kind === "imaging" ? "imaging_report" : "test_result";
  return base(
    ctx,
    row,
    kind,
    "diagnostic_report",
    row.id,
    occurredAt,
    {
      reportKind: row.kind,
      title: row.title ?? null,
      facilityName: row.facilityNameText ?? null,
      modality: row.modality ?? null,
      resultCount: row.resultCount ?? null,
      dateSource: row.testedAt ? "tested" : row.reportedAt ? "reported" : "filed",
    },
    row.encounterId,
  );
}

/**
 * One `Observation` row → one `measurement` event (docs_v2/04 §5.2). The
 * summary carries the canonical value and unit the same reader already sees
 * on the row itself — never an interpretation, which this app does not
 * compute (hazard H-25).
 */
export function projectObservation(
  ctx: Ctx,
  row: ProvenanceBits & {
    id: string;
    concept: string;
    valueNumeric?: { toString(): string } | null;
    valueNumeric2?: { toString(): string } | null;
    valueText?: string | null;
    unit: string;
    context?: string | null;
    measuredAt: Date;
    encounterId?: string | null;
    deviceId?: string | null;
  },
): HealthEventInput {
  return base(
    ctx,
    row,
    "measurement",
    "observation",
    row.id,
    row.measuredAt,
    {
      concept: row.concept,
      value: row.valueNumeric == null ? null : row.valueNumeric.toString(),
      value2: row.valueNumeric2 == null ? null : row.valueNumeric2.toString(),
      valueText: row.valueText ?? null,
      unit: row.unit,
      context: row.context ?? null,
      fromDevice: row.deviceId != null,
    },
    row.encounterId,
  );
}
