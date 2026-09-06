import { buildFolderSerializers } from "../../common/folder-serializers.js";
import type { IgModule } from "../../common/ig-module.js";
import { ALTERNATE_PROFILES, EXTRA_PROFILES, IG_LABEL, IG_VERSION, PROFILES, vitalProfileFor } from "./profiles.js";

export { ALTERNATE_PROFILES, EXTRA_PROFILES, IG_LABEL, IG_VERSION, PROFILES } from "./profiles.js";
export { parseAllergyIntolerance, serializeAllergyIntolerance } from "./allergy-intolerance.js";
export { serializeProvenance } from "./provenance.js";

/** No Indian Patient Summary in v6.5 (ADR-V2-003: "The Indian Patient Summary is a v7.x-only capability"). */
export const ig: IgModule = Object.freeze({
  version: IG_VERSION,
  fhirVersion: "4.0.1",
  label: IG_LABEL,
  profiles: PROFILES,
  alternateProfiles: ALTERNATE_PROFILES,
  supportsPatientSummary: false,
  ...buildFolderSerializers({
    igVersion: IG_VERSION,
    profiles: PROFILES,
    extra: { diagnosticReportImaging: EXTRA_PROFILES.diagnosticReportImaging, diagnosticReportRecord: EXTRA_PROFILES.diagnosticReportRecord },
    vitalProfileFor,
  }),
});
