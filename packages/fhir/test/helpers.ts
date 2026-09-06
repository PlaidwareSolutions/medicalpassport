import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalAllergy, IgVersion } from "../src/index.js";

// vitest (vite-node) provides __dirname; the package is CommonJS so import.meta is unavailable.
const FIXTURES = join(__dirname, "conformance", "fixtures");

export function loadFixture<T>(relative: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, relative), "utf8")) as T;
}

/** Any canonical fixture by name (`canonical/<name>.json`). */
export function loadCanonical<T>(name: string): T {
  return loadFixture<T>(join("canonical", `${name}.json`));
}

export function loadCanonicalAllergy(name: string): CanonicalAllergy {
  return loadCanonical<CanonicalAllergy>(name);
}

/** Golden resource for one IG folder (`v6_5/<file>` / `v7_0/<file>`). */
export function loadGolden<T>(version: IgVersion, file: string): T {
  return loadFixture<T>(join(FOLDER[version], file));
}

export const FOLDER: Record<IgVersion, string> = { "6.5": "v6_5", "7.0": "v7_0" };

/** Deep clone so a test can mutate a fixture without touching the shared copy. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const CANONICAL_ALLERGY_FIXTURES = ["allergy-clinic-verified", "allergy-patient-entered", "allergy-ocr-extracted"] as const;
