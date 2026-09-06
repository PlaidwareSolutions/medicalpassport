import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalAllergy } from "../src/index.js";

// vitest (vite-node) provides __dirname; the package is CommonJS so import.meta is unavailable.
const FIXTURES = join(__dirname, "conformance", "fixtures");

export function loadFixture<T>(relative: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, relative), "utf8")) as T;
}

export function loadCanonicalAllergy(name: string): CanonicalAllergy {
  return loadFixture<CanonicalAllergy>(join("canonical", `${name}.json`));
}

/** Deep clone so a test can mutate a fixture without touching the shared copy. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const CANONICAL_ALLERGY_FIXTURES = ["allergy-clinic-verified", "allergy-patient-entered", "allergy-ocr-extracted"] as const;
