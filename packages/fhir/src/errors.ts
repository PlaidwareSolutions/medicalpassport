/**
 * Typed errors thrown by the FHIR layer. The API maps these to RFC 7807 problems;
 * this package never depends on the domain error catalogue so it stays pure.
 */

export class FhirError extends Error {
  override readonly name: string = "FhirError";
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a canonical row is serialised without its provenance block.
 * The serializer fails closed (ADR-V2-002): nothing leaves the boundary without
 * source + verification.
 */
export class ProvenanceMissingError extends FhirError {
  override readonly name = "ProvenanceMissingError";
  readonly code = "fhir_provenance_missing" as const;
  constructor(
    readonly entityType: string,
    readonly entityId: string,
  ) {
    super(`Refusing to serialize ${entityType}/${entityId}: provenance block is missing`);
  }
}

/** Thrown by `getIg` for a version that has no folder under `src/ig/`. */
export class UnsupportedIgVersionError extends FhirError {
  override readonly name = "UnsupportedIgVersionError";
  readonly code = "fhir_ig_version_unsupported" as const;
  constructor(readonly requested: string) {
    super(`Unsupported ABDM FHIR IG version "${requested}"`);
  }
}

/** Thrown by parsers when a resource is missing something the canonical model requires. */
export class FhirParseError extends FhirError {
  override readonly name = "FhirParseError";
  readonly code = "fhir_parse_failed" as const;
  constructor(
    readonly resourceType: string,
    readonly path: string,
    message: string,
  ) {
    super(`${resourceType}.${path}: ${message}`);
  }
}
