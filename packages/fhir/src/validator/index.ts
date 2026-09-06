import type { ZodIssue } from "zod";
import type { IgModule, ProfiledResourceType } from "../common/ig-module.js";
import { getIg, type IgVersion } from "../version-mapper.js";
import { RESOURCE_SCHEMAS, type ValidatableResourceType } from "./schemas.js";

/** FHIR OperationOutcome issue severities. */
export type FhirIssueSeverity = "fatal" | "error" | "warning" | "information";

/** One row of `FhirValidationFailure` (docs_v2/04 section 8) minus the persistence columns. */
export interface FhirValidationFailure {
  /** FHIRPath-like location, e.g. `AllergyIntolerance.reaction[0].manifestation`. */
  path: string;
  severity: FhirIssueSeverity;
  message: string;
  /** The IG profile the resource was checked against (base R4 canonical when the IG has none). */
  profileUrl: string;
  resourceType: string;
  igVersion: IgVersion;
}

export type ValidationResult = { ok: true } | { ok: false; failures: FhirValidationFailure[] };

export interface ValidateOptions {
  ig: IgVersion;
}

const R4_BASE = "http://hl7.org/fhir/StructureDefinition";

/**
 * Structural + profile validation of a resource produced (or received) at the ABDM boundary.
 * Bundles are validated recursively: each entry resource is checked with its own path prefix.
 * Never throws on bad input; unknown resource types are reported, not crashed on.
 */
export function validateResource(resource: unknown, options: ValidateOptions): ValidationResult {
  const failures = collectFailures(resource, getIg(options.ig), options.ig, "");
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

function collectFailures(resource: unknown, ig: IgModule, igVersion: IgVersion, prefix: string): FhirValidationFailure[] {
  const resourceType = readResourceType(resource);
  const profileUrl = profileFor(ig, resourceType);
  const at = (path: string): string => joinPath(prefix, resourceType ?? "Resource", path);
  const fail = (path: string, message: string, severity: FhirIssueSeverity = "error"): FhirValidationFailure => ({
    path: at(path),
    severity,
    message,
    profileUrl,
    resourceType: resourceType ?? "unknown",
    igVersion,
  });

  if (!resourceType) return [fail("resourceType", "resourceType is required", "fatal")];
  const schema = RESOURCE_SCHEMAS[resourceType as ValidatableResourceType];
  if (!schema) return [fail("resourceType", `no structural schema for resource type "${resourceType}"`, "fatal")];

  const parsed = schema.safeParse(resource);
  const failures: FhirValidationFailure[] = parsed.success
    ? []
    : parsed.error.issues.flatMap((issue) => {
        // A strict-object violation lists every unknown element in `keys`; report each at its own path.
        if (issue.code === "unrecognized_keys") {
          return issue.keys.map((key) => fail(formatIssuePath(issue, key), `unknown element "${key}"`));
        }
        return [fail(formatIssuePath(issue), issue.message)];
      });

  if (isProfiled(ig, resourceType)) {
    const profiles = (resource as { meta?: { profile?: unknown } }).meta?.profile;
    const declared = Array.isArray(profiles) ? (profiles as unknown[]) : [];
    if (!declared.includes(ig.profiles[resourceType])) {
      failures.push(fail("meta.profile", `must declare profile ${ig.profiles[resourceType]} for IG ${ig.version}`));
    }
  }

  if (resourceType === "Bundle" && parsed.success) {
    const entries = (resource as { entry?: Array<{ resource?: unknown }> }).entry ?? [];
    entries.forEach((entry, index) => {
      if (entry.resource === undefined) return;
      failures.push(...collectFailures(entry.resource, ig, igVersion, joinPath(prefix, "Bundle", `entry[${index}].resource`)));
    });
  }

  return failures;
}

function readResourceType(resource: unknown): string | null {
  if (typeof resource !== "object" || resource === null) return null;
  const rt = (resource as { resourceType?: unknown }).resourceType;
  return typeof rt === "string" && rt.length > 0 ? rt : null;
}

function isProfiled(ig: IgModule, resourceType: string): resourceType is ProfiledResourceType {
  return Object.prototype.hasOwnProperty.call(ig.profiles, resourceType);
}

function profileFor(ig: IgModule, resourceType: string | null): string {
  if (resourceType && isProfiled(ig, resourceType)) return ig.profiles[resourceType];
  return `${R4_BASE}/${resourceType ?? "Resource"}`;
}

function formatIssuePath(issue: ZodIssue, leaf?: string): string {
  const segments = leaf === undefined ? issue.path : [...issue.path, leaf];
  if (segments.length === 0) return "";
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc.length === 0 ? String(segment) : `${acc}.${String(segment)}`;
  }, "");
}

function joinPath(prefix: string, resourceType: string, path: string): string {
  const head = prefix.length === 0 ? resourceType : `${prefix}.${resourceType}`;
  return path.length === 0 ? head : `${head}.${path}`;
}
