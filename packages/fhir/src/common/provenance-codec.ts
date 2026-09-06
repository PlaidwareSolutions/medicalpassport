import type { CanonicalProvenance } from "../canonical/provenance.js";
import { DEFAULT_SOFTWARE_VERSION, type SerializeContext } from "./context.js";
import {
  CODE_SYSTEMS,
  MEDPASS_SYSTEMS,
  type Extension,
  type ProvenanceAgent,
  type ProvenanceEntity,
  type ProvenanceResource,
  type Reference,
} from "./r4.js";
import { reference, referenceId } from "./references.js";

export interface ProvenanceBuildOptions extends SerializeContext {
  /** IG version label stamped into the software agent identifier. */
  igVersion: string;
  /** Profile canonical placed in `meta.profile`. */
  profileUrl: string;
  /** Resource id; defaults to `prov-<target id>`. */
  id?: string;
}

/**
 * Builds the `Provenance` resource that accompanies every exported clinical resource
 * (docs_v2/08 section 6 #16: who / when / source / software version).
 */
export function provenanceToResource(
  canonical: CanonicalProvenance,
  targetRef: Reference,
  options: ProvenanceBuildOptions,
): ProvenanceResource {
  const agents: ProvenanceAgent[] = [];
  const entities: ProvenanceEntity[] = [];

  if (canonical.recordedByUserId) {
    agents.push(agent("enterer", "Enterer", userWho(canonical.recordedByUserId)));
  }
  if (canonical.sourcePractitionerId) {
    const a = agent("author", "Author", reference("Practitioner", canonical.sourcePractitionerId));
    if (canonical.sourceOrganizationId) {
      a.onBehalfOf = reference("Organization", canonical.sourceOrganizationId);
    }
    agents.push(a);
  } else if (canonical.sourceOrganizationId) {
    agents.push(agent("custodian", "Custodian", reference("Organization", canonical.sourceOrganizationId)));
  }
  if (canonical.sourceDeviceId) {
    agents.push(agent("author", "Author", reference("Device", canonical.sourceDeviceId)));
  }
  if (canonical.verifiedByUserId) {
    agents.push(agent("verifier", "Verifier", userWho(canonical.verifiedByUserId)));
  }
  agents.push(
    agent("assembler", "Assembler", {
      identifier: {
        system: MEDPASS_SYSTEMS.software,
        value: `${options.softwareVersion ?? DEFAULT_SOFTWARE_VERSION};ig=${options.igVersion}`,
      },
      display: "MedicinePassport",
    }),
  );

  if (canonical.sourceDocumentId) {
    entities.push({ role: "source", what: reference("DocumentReference", canonical.sourceDocumentId) });
  }
  if (canonical.sourceAbdmTxnId) {
    entities.push({
      role: "source",
      what: { identifier: { system: MEDPASS_SYSTEMS.abdmTransaction, value: canonical.sourceAbdmTxnId } },
    });
  }

  const extension: Extension[] = [
    { url: MEDPASS_SYSTEMS.extRecordSource, valueCode: canonical.source },
    { url: MEDPASS_SYSTEMS.extVerification, valueCode: canonical.verification },
    { url: MEDPASS_SYSTEMS.extRecordedVia, valueCode: canonical.recordedVia },
  ];

  const targetId = targetRef.reference ? referenceId(targetRef.reference) : null;
  const resource: ProvenanceResource = {
    resourceType: "Provenance",
    id: (options.id ?? `prov-${targetId ?? "unknown"}`).slice(0, 64),
    meta: { profile: [options.profileUrl] },
    extension,
    target: [targetRef],
    recorded: canonical.recordedAt,
    agent: agents,
  };
  if (canonical.verifiedAt) resource.occurredDateTime = canonical.verifiedAt;
  if (entities.length > 0) resource.entity = entities;
  return resource;
}

function agent(code: string, display: string, who: Reference): ProvenanceAgent {
  return {
    type: { coding: [{ system: CODE_SYSTEMS.provenanceParticipantType, code, display }] },
    who,
  };
}

/** Users are referenced by identifier, never by a `Patient/` or `Practitioner/` guess. */
function userWho(userId: string): Reference {
  return { identifier: { system: MEDPASS_SYSTEMS.user, value: userId } };
}
