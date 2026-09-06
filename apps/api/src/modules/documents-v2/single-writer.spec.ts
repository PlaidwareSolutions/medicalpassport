import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * docs_v2/09 §1 rule 3: "There is exactly one code path that materializes
 * candidates … and a test asserts no other writer exists."
 *
 * This is that test. It reads every source file in `documents-v2/` and fails
 * if a clinical table is written anywhere except `materialize-candidate.ts`.
 * A second writer would mean a value could reach the patient's record without
 * the provenance stamp, the confirmation, or the `resultingEntityId` trail
 * that the single path guarantees — which is exactly the failure the rule
 * exists to make impossible.
 *
 * It is deliberately a text scan, not a type-level trick: a future
 * contributor adding `tx.patientMedication.create(...)` to the service gets a
 * red test naming the file and line, whatever clever indirection they used to
 * get the Prisma client.
 */

const MODULE_DIR = __dirname;
const SINGLE_WRITER = "materialize-candidate.ts";

/**
 * Prisma models that hold clinical facts about a patient. `PatientDocument`,
 * `DocumentPage`, `DocumentExtraction`, `DocumentCandidate`, `StoredObject`,
 * `ObjectAccessEvent` and `BackgroundJob` are deliberately absent: they are
 * the pipeline's own bookkeeping, not the patient's record.
 */
const CLINICAL_MODELS = [
  "patientMedication",
  "medicationInstruction",
  "medicationChange",
  "medicationSchedule",
  "doseEvent",
  "prescription",
  "prescriptionItem",
  "patientCondition",
  "patientAllergy",
  "immunization",
  "procedure",
  "encounter",
  "practitioner",
  "organization",
  "diagnosticReport",
  "diagnosticResult",
  "medicalReport",
  "reportValue",
  "observation",
  "glucoseReading",
  "bloodPressureReading",
  "weightReading",
  "checkupRecord",
  "familyHistory",
] as const;

/** `tx.patientMedication.create(`, `this.prisma.prescription.createMany(`, `medications.create(`, … */
const WRITE_CALL = new RegExp(
  String.raw`\.(?:${CLINICAL_MODELS.join("|")})\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(`,
  "g",
);

/**
 * The medication path is the one clinical write that is delegated rather than
 * issued directly (it must go through MedicationsService for scheduling and
 * safety), so calling that service counts as a clinical write too.
 */
const DELEGATED_WRITE = /\bmedications\s*\.\s*create\s*\(/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function offendingLines(path: string): string[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const hits: string[] = [];
  lines.forEach((line, index) => {
    WRITE_CALL.lastIndex = 0;
    DELEGATED_WRITE.lastIndex = 0;
    if (WRITE_CALL.test(line) || DELEGATED_WRITE.test(line)) {
      hits.push(`${path}:${index + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

describe("documents-v2 has exactly one clinical writer", () => {
  const files = sourceFiles(MODULE_DIR);

  it("finds the module's sources", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files.some((f) => f.endsWith(SINGLE_WRITER))).toBe(true);
  });

  it("writes clinical rows only from materialize-candidate.ts", () => {
    const offenders = files
      .filter((file) => !file.endsWith(SINGLE_WRITER) && !file.endsWith("single-writer.spec.ts"))
      .flatMap(offendingLines);

    if (offenders.length > 0) {
      throw new Error(
        "docs_v2/09 §1 rule 3 — a clinical row may only be written by materializeCandidate().\n" +
          `Move these writes into ${SINGLE_WRITER}:\n  ${offenders.join("\n  ")}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("the single writer really does write (the guard is not vacuous)", () => {
    const hits = offendingLines(join(MODULE_DIR, SINGLE_WRITER));
    expect(hits.length).toBeGreaterThan(5);
  });

  it("never writes a field the catalogue marks never-auto-proposed", async () => {
    const { NEVER_AUTO_PROPOSED } = (await import("@medpass/document-intelligence")) as typeof import("@medpass/document-intelligence");
    const writer = readFileSync(join(MODULE_DIR, SINGLE_WRITER), "utf8");
    for (const [entity, fields] of Object.entries(NEVER_AUTO_PROPOSED)) {
      for (const field of fields ?? []) {
        // `interpretation` and `doseQuantity` must never be read off a
        // candidate. The medication branch does take a doseQuantity, but only
        // from the typed `medication` override, never from `fieldValue(...)`.
        expect(writer).not.toContain(`fieldValue<number>(params, "${field}")`);
        expect(writer).not.toContain(`fieldValue<string>(params, "${field}")`);
        expect(entity).toBeTruthy();
      }
    }
  });
});
