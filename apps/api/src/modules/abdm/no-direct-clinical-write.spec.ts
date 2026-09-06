import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * docs_v2/08 §7: "A test asserts no code path writes clinical tables from `AbdmDataBundle`
 * directly." This is that test.
 *
 * Two guards, both text scans (like documents-v2/single-writer.spec.ts, so a clever indirection
 * cannot hide a write):
 *  1. the ABDM and FHIR modules never write a clinical table at all — inbound bundles become
 *     `DocumentCandidate` rows and only the documents-v2 single writer materializes them;
 *  2. no file anywhere in `src/` that reads `AbdmDataBundle` also writes a clinical table, so a
 *     future shortcut from bundle → row has to go through the candidate path.
 */

const SRC = join(__dirname, "..", "..");
const GUARDED_MODULES = [join(SRC, "modules", "abdm"), join(SRC, "modules", "fhir")];

/** Prisma models that hold clinical facts about a patient (mirrors documents-v2/single-writer.spec.ts). */
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

const WRITE_CALL = new RegExp(
  String.raw`\.(?:${CLINICAL_MODELS.join("|")})\s*\.\s*(create|createMany|createManyAndReturn|upsert|update|updateMany)\s*\(`,
  "g",
);
const RAW_SQL_WRITE = /\$(executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)\s*(\(|`)/g;
const BUNDLE_READ = /\babdmDataBundle\b|\bAbdmDataBundle\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") && !entry.name.endsWith(".e2e-spec.ts") ? [path] : [];
  });
}

function offendingLines(path: string): string[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const hits: string[] = [];
  lines.forEach((line, index) => {
    WRITE_CALL.lastIndex = 0;
    RAW_SQL_WRITE.lastIndex = 0;
    if (WRITE_CALL.test(line) || RAW_SQL_WRITE.test(line)) hits.push(`${relative(SRC, path)}:${index + 1}: ${line.trim()}`);
  });
  return hits;
}

describe("ABDM import policy (docs_v2/08 §7): bundles never write clinical tables directly", () => {
  it("the abdm and fhir modules exist and have sources", () => {
    for (const dir of GUARDED_MODULES) expect(sourceFiles(dir).length).toBeGreaterThan(0);
  });

  it("the abdm and fhir modules never write a clinical table", () => {
    const offenders = GUARDED_MODULES.flatMap(sourceFiles).flatMap(offendingLines);
    if (offenders.length > 0) {
      throw new Error(
        "docs_v2/08 §7 — inbound ABDM data becomes DocumentCandidate rows only; clinical rows are written by documents-v2/materialize-candidate.ts after a confirmation.\n" +
          `Remove these writes:\n  ${offenders.join("\n  ")}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("no file that touches AbdmDataBundle writes a clinical table", () => {
    const readers = sourceFiles(SRC).filter((file) => BUNDLE_READ.test(readFileSync(file, "utf8")));
    expect(readers.length).toBeGreaterThan(0);
    const offenders = readers.flatMap(offendingLines);
    expect(offenders).toEqual([]);
  });

  it("the import service really does create candidates (the guard is not vacuous)", () => {
    const importer = readFileSync(join(SRC, "modules", "abdm", "abdm-import.service.ts"), "utf8");
    expect(importer).toMatch(/documentCandidate\s*\.\s*create\s*\(/);
    expect(importer).toMatch(/documentExtraction\s*\.\s*create\s*\(/);
    expect(importer).toContain('provenanceSource: "abdm_imported"');
    expect(importer).toContain('verification: "source_authenticated"');
  });

  it("the single writer stamps ABDM provenance onto confirmed rows from an imported document", () => {
    const writer = readFileSync(join(SRC, "modules", "documents-v2", "materialize-candidate.ts"), "utf8");
    expect(writer).toContain("importProvenance");
    expect(writer).toContain("sourceAbdmTxnId");
  });
});
