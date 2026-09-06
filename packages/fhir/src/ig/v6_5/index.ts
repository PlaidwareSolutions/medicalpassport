import type { IgModule } from "../../common/ig-module.js";
import { parseAllergyIntolerance, serializeAllergyIntolerance } from "./allergy-intolerance.js";
import { IG_LABEL, IG_VERSION, PROFILES } from "./profiles.js";
import { serializeProvenance } from "./provenance.js";

export { IG_LABEL, IG_VERSION, PROFILES } from "./profiles.js";
export { parseAllergyIntolerance, serializeAllergyIntolerance } from "./allergy-intolerance.js";
export { serializeProvenance } from "./provenance.js";

export const ig: IgModule = Object.freeze({
  version: IG_VERSION,
  fhirVersion: "4.0.1",
  label: IG_LABEL,
  profiles: PROFILES,
  serializeAllergyIntolerance,
  parseAllergyIntolerance,
  serializeProvenance,
});
