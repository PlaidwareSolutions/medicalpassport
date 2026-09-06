import { buildFolderSerializers } from "../../common/folder-serializers.js";
import type { IgModule } from "../../common/ig-module.js";
import { serializePatientSummary as ips, type PatientSummarySerializer } from "./ips.js";
import { ALTERNATE_PROFILES, EXTRA_PROFILES, IG_LABEL, IG_VERSION, PROFILES, VITAL_PROFILES, vitalProfileFor } from "./profiles.js";

export { ALTERNATE_PROFILES, EXTRA_PROFILES, IG_LABEL, IG_VERSION, PROFILES, VITAL_PROFILES } from "./profiles.js";
export { parseAllergyIntolerance, serializeAllergyIntolerance } from "./allergy-intolerance.js";
export { serializeProvenance } from "./provenance.js";

const serializers = buildFolderSerializers({
  igVersion: IG_VERSION,
  profiles: PROFILES,
  extra: { diagnosticReportImaging: EXTRA_PROFILES.diagnosticReportImaging, diagnosticReportRecord: EXTRA_PROFILES.diagnosticReportRecord },
  vitalProfileFor,
});

export const ig: IgModule = Object.freeze({
  version: IG_VERSION,
  fhirVersion: "4.0.1",
  label: IG_LABEL,
  profiles: PROFILES,
  alternateProfiles: ALTERNATE_PROFILES,
  supportsPatientSummary: true,
  ...serializers,
  serializePatientSummary: ((summary, ctx) => ips(summary, serializers, ctx)) satisfies PatientSummarySerializer,
});
