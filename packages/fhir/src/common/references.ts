import type { CanonicalPatientRef } from "../canonical/patient-ref.js";
import { FhirParseError } from "../errors.js";
import { CODE_SYSTEMS, type Reference } from "./r4.js";

export function patientReference(ref: CanonicalPatientRef): Reference {
  const out: Reference = { reference: `Patient/${ref.patientProfileId}` };
  if (ref.abhaAddress) {
    out.identifier = { system: CODE_SYSTEMS.abhaAddress, value: ref.abhaAddress };
  }
  if (ref.display) out.display = ref.display;
  return out;
}

/** Accepts `Patient/<id>`, `urn:uuid:<id>`, or an absolute URL ending in `/Patient/<id>`. */
export function parsePatientReference(
  ref: Reference | undefined,
  resourceType: string,
): CanonicalPatientRef {
  const raw = ref?.reference;
  if (!raw) throw new FhirParseError(resourceType, "patient.reference", "patient reference is required");
  const id = referenceId(raw);
  if (!id) throw new FhirParseError(resourceType, "patient.reference", `cannot extract an id from "${raw}"`);
  const out: CanonicalPatientRef = { patientProfileId: id };
  const abha = ref?.identifier?.system === CODE_SYSTEMS.abhaAddress ? ref.identifier.value : undefined;
  out.abhaAddress = abha ?? null;
  out.display = ref?.display ?? null;
  return out;
}

/** Last path segment of a reference string, or the uuid of a `urn:uuid:` reference. */
export function referenceId(reference: string): string | null {
  if (reference.startsWith("urn:uuid:")) return reference.slice("urn:uuid:".length) || null;
  const segments = reference.split("/").filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  return last && last !== "_history" ? last : null;
}

export function reference(resourceType: string, id: string): Reference {
  return { reference: `${resourceType}/${id}` };
}
