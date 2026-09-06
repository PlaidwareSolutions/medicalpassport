/** FHIR OperationOutcome issue severities. */
export type FhirIssueSeverity = "fatal" | "error" | "warning" | "information";

/**
 * One row of `FhirValidationFailure` (docs_v2/04 section 8) minus the persistence columns.
 * Produced by the validator and, as warnings, by serializers that had to fall back to a local
 * code (docs_v2/08 section 6 #6: "flagged in FhirValidationFailure").
 */
export interface FhirValidationFailure {
  /** FHIRPath-like location, e.g. `AllergyIntolerance.reaction[0].manifestation`. */
  path: string;
  severity: FhirIssueSeverity;
  message: string;
  /** The IG profile the resource was checked against (base R4 canonical when the IG has none). */
  profileUrl: string;
  resourceType: string;
  igVersion: string;
}

/** What every per-folder serializer hands back: the resource plus mapping warnings (never thrown). */
export interface SerializedResource<R> {
  resource: R;
  warnings: FhirValidationFailure[];
}

/** Context a codec needs to phrase a warning: which folder and which profile it was building for. */
export interface CodecContext {
  igVersion: string;
  profileUrl: string;
}

export function warning(ctx: CodecContext, resourceType: string, path: string, message: string): FhirValidationFailure {
  return { path: `${resourceType}.${path}`, severity: "warning", message, profileUrl: ctx.profileUrl, resourceType, igVersion: ctx.igVersion };
}
