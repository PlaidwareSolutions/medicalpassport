import { describe, expect, it } from "vitest";
import { MEDPASS_SYSTEMS, SUPPORTED_IG_VERSIONS, getIg, validateResource } from "../../src/index.js";
import { loadCanonicalAllergy } from "../helpers.js";

const ext = (resource: { extension?: Array<{ url: string; valueCode?: string }> }, url: string) =>
  resource.extension?.find((e) => e.url === url)?.valueCode;

describe.each(SUPPORTED_IG_VERSIONS)("Provenance conformance — IG %s", (version) => {
  const ig = getIg(version);
  const target = { reference: "AllergyIntolerance/6c1a6c1e-3d1a-4d3f-9a9e-8f2b0c7d1a01" };

  it("serializes a validator-clean Provenance that targets the resource", () => {
    const block = loadCanonicalAllergy("allergy-clinic-verified").provenance!;
    const provenance = ig.serializeProvenance(block, target, { softwareVersion: "api@test" });

    expect(validateResource(provenance, { ig: version })).toEqual({ ok: true });
    expect(provenance.id).toBe("prov-6c1a6c1e-3d1a-4d3f-9a9e-8f2b0c7d1a01");
    expect(provenance.target).toEqual([target]);
    expect(provenance.recorded).toBe(block.recordedAt);
    expect(provenance.occurredDateTime).toBe(block.verifiedAt);
  });

  it("carries source, verification and channel as coded extensions", () => {
    const block = loadCanonicalAllergy("allergy-clinic-verified").provenance!;
    const provenance = ig.serializeProvenance(block, target);
    expect(ext(provenance, MEDPASS_SYSTEMS.extRecordSource)).toBe("clinic_entered");
    expect(ext(provenance, MEDPASS_SYSTEMS.extVerification)).toBe("provider_verified");
    expect(ext(provenance, MEDPASS_SYSTEMS.extRecordedVia)).toBe("clinic_portal");
  });

  it("lists enterer, author-on-behalf-of-organization, verifier and the software agent", () => {
    const block = loadCanonicalAllergy("allergy-clinic-verified").provenance!;
    const provenance = ig.serializeProvenance(block, target, { softwareVersion: "api@test" });
    const agents = provenance.agent.map((a) => ({
      type: a.type?.coding?.[0]?.code,
      who: a.who.reference ?? a.who.identifier?.value,
      onBehalfOf: a.onBehalfOf?.reference,
    }));
    expect(agents).toEqual([
      { type: "enterer", who: block.recordedByUserId, onBehalfOf: undefined },
      {
        type: "author",
        who: `Practitioner/${block.sourcePractitionerId}`,
        onBehalfOf: `Organization/${block.sourceOrganizationId}`,
      },
      { type: "verifier", who: block.verifiedByUserId, onBehalfOf: undefined },
      { type: "assembler", who: `api@test;ig=${version}`, onBehalfOf: undefined },
    ]);
  });

  it("links the source document as a source entity for OCR-derived rows", () => {
    const block = loadCanonicalAllergy("allergy-ocr-extracted").provenance!;
    const provenance = ig.serializeProvenance(block, target);
    expect(validateResource(provenance, { ig: version })).toEqual({ ok: true });
    expect(provenance.entity).toEqual([
      { role: "source", what: { reference: `DocumentReference/${block.sourceDocumentId}` } },
    ]);
    // No human agent on an OCR row: only the software agent remains, and R4 still needs >= 1.
    expect(provenance.agent).toHaveLength(1);
    expect(provenance.agent[0]?.type?.coding?.[0]?.code).toBe("assembler");
  });

  it("stamps the base R4 Provenance profile (NRCeS has no Provenance profile)", () => {
    const block = loadCanonicalAllergy("allergy-patient-entered").provenance!;
    const provenance = ig.serializeProvenance(block, target);
    expect(provenance.meta?.profile).toEqual(["http://hl7.org/fhir/StructureDefinition/Provenance"]);
  });
});
