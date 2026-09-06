import { createHash, randomUUID } from "node:crypto";
import { ERROR_CODES } from "@medpass/domain";
import { serializePrescriptionRecord, type CanonicalPrescriptionRecord, type CanonicalProvenance } from "@medpass/fhir";
import { ApiProblem } from "../../common/errors";

/**
 * The API's view of `apps/abdm-gateway` (docs_v2/08 §4, ADR-V2-005). The API never holds ABDM
 * credentials or talks to the ABDM gateway itself; it calls the gateway service's private
 * `/internal/*` API. When `ABDM_GATEWAY_URL` is unset an in-process mock replays deterministic
 * fixtures (docs_v2/08 §9 "local"), so every flow runs in CI without network.
 */

export type AbdmGatewayEnv = "mock" | "sandbox" | "production";

export interface LinkInitResult {
  transactionId: string;
  /** Masked destination the OTP went to, for the UI ("******9012"). */
  otpSentTo: string | null;
}

export interface LinkVerifyResult {
  abhaNumber: string;
  abhaAddress: string;
  /** Profile as ABDM returns it — stored as `AbhaLink.profileSnapshot`, never merged into the patient's own profile automatically. */
  profile: { name: string; gender: string | null; yearOfBirth: number | null };
}

export interface DiscoveredCareContext {
  reference: string;
  display: string;
}

export interface DiscoveredPatient {
  hipId: string;
  hipName: string;
  patientReferenceNumber: string;
  careContexts: DiscoveredCareContext[];
}

export interface DiscoveryResult {
  status: "pending" | "completed" | "failed";
  patients: DiscoveredPatient[];
}

/**
 * A recorded sandbox consequence of linking care contexts: the HIU consent that follows and the
 * bundle the HIP transfers under it. Only the mock returns these (the real gateway persists them
 * itself from ABDM callbacks); the service stores them so the M8B/M8D flow can be exercised end to end.
 */
export interface SimulatedTransfer {
  consent: { artefactId: string; purposeCode: string; hiTypes: string[]; hiuId: string; dateRangeFrom: string; dateRangeTo: string; dataEraseAt: string };
  bundle: { transactionId: string; hiType: string; fhirVersion: string; igVersion: string; entryCount: number };
}

export interface CareContextLinkResult {
  status: "linked" | "otp_required" | "failed";
  linked: DiscoveredCareContext[];
  simulated?: SimulatedTransfer;
}

export interface FetchedBundle {
  hiType: string;
  fhirVersion: string;
  igVersion: string;
  bundle: unknown;
}

export interface AbdmGatewayClient {
  readonly env: AbdmGatewayEnv;
  linkInit(input: { method: "abha_number" | "mobile" | "aadhaar_otp"; abhaNumber?: string; mobile?: string; aadhaar?: string; correlationId?: string }): Promise<LinkInitResult>;
  linkVerify(input: { transactionId: string; otp: string; abhaAddress?: string; correlationId?: string }): Promise<LinkVerifyResult>;
  discover(input: { abhaAddress: string; abhaNumber: string; hipId?: string; correlationId?: string }): Promise<{ transactionId: string }>;
  discoveryResult(input: { transactionId: string; correlationId?: string }): Promise<DiscoveryResult>;
  linkCareContexts(input: { transactionId: string; abhaAddress: string; hipId: string; patientReferenceNumber: string; careContextReferences: string[]; otp?: string; correlationId?: string }): Promise<CareContextLinkResult>;
  revokeConsent(input: { artefactId: string; abhaAddress: string; reason?: string; correlationId?: string }): Promise<{ status: "revoked" }>;
  fetchBundle(input: { bundleId: string; transactionId: string | null; correlationId?: string }): Promise<FetchedBundle>;
}

export const ABDM_GATEWAY_CLIENT = "ABDM_GATEWAY_CLIENT";

// ---------------------------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------------------------

export const MOCK_OTP = "000000";
export const MOCK_HIP = { hipId: "mock-hip-001", hipName: "Mock City Hospital (sandbox replay)" } as const;
export const MOCK_CARE_CONTEXTS: DiscoveredCareContext[] = [
  { reference: "OPD-2026-0001", display: "OPD visit 14 Aug 2026 — General Medicine" },
  { reference: "LAB-2026-0007", display: "HbA1c panel 10 Aug 2026" },
];
export const MOCK_ABHA_ADDRESS_DOMAIN = "sbx";

/** Deterministic 14-digit ABHA number for a mock identity seed (so two test users never collide). */
export function mockAbhaNumberFor(seed: string): string {
  const digits = createHash("sha256").update(`abha:${seed}`).digest("hex").replace(/[^0-9]/g, "").padEnd(14, "7").slice(0, 14);
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`;
}

function mockAbhaAddressFor(seed: string): string {
  const slug = createHash("sha256").update(`addr:${seed}`).digest("hex").slice(0, 8);
  return `mock${slug}@${MOCK_ABHA_ADDRESS_DOMAIN}`;
}

/**
 * In-process replay of the sandbox recordings (docs_v2/08 §9). Transaction state lives in memory
 * for the life of the process — enough for a login → discover → link → import flow in one test run.
 */
export class MockAbdmGatewayClient implements AbdmGatewayClient {
  readonly env: AbdmGatewayEnv = "mock";
  private readonly pending = new Map<string, { seed: string; abhaNumber: string | null }>();
  private readonly discoveries = new Map<string, { abhaAddress: string; hipId: string }>();

  async linkInit(input: { method: "abha_number" | "mobile" | "aadhaar_otp"; abhaNumber?: string; mobile?: string; aadhaar?: string }): Promise<LinkInitResult> {
    const seed = input.abhaNumber ?? input.mobile ?? input.aadhaar ?? "anonymous";
    const transactionId = `mock-link-${randomUUID()}`;
    this.pending.set(transactionId, { seed, abhaNumber: input.method === "abha_number" && input.abhaNumber ? normalizeAbhaNumber(input.abhaNumber) : null });
    return { transactionId, otpSentTo: `******${seed.replace(/\D/g, "").slice(-4).padStart(4, "0")}` };
  }

  async linkVerify(input: { transactionId: string; otp: string; abhaAddress?: string }): Promise<LinkVerifyResult> {
    const pending = this.pending.get(input.transactionId);
    if (!pending) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Unknown or expired ABHA transaction", 404);
    if (input.otp !== MOCK_OTP) throw new ApiProblem(ERROR_CODES.OTP_INVALID, "Incorrect OTP", 400);
    this.pending.delete(input.transactionId);
    return {
      abhaNumber: pending.abhaNumber ?? mockAbhaNumberFor(pending.seed),
      abhaAddress: input.abhaAddress ?? mockAbhaAddressFor(pending.seed),
      profile: { name: "ABDM Sandbox Patient", gender: null, yearOfBirth: null },
    };
  }

  async discover(input: { abhaAddress: string; hipId?: string }): Promise<{ transactionId: string }> {
    const transactionId = `mock-discover-${randomUUID()}`;
    this.discoveries.set(transactionId, { abhaAddress: input.abhaAddress, hipId: input.hipId ?? MOCK_HIP.hipId });
    return { transactionId };
  }

  async discoveryResult(input: { transactionId: string }): Promise<DiscoveryResult> {
    const discovery = this.discoveries.get(input.transactionId);
    if (!discovery) return { status: "failed", patients: [] };
    if (discovery.hipId !== MOCK_HIP.hipId) return { status: "completed", patients: [] };
    return {
      status: "completed",
      patients: [{ ...MOCK_HIP, patientReferenceNumber: `PRN-${discovery.abhaAddress.split("@")[0]}`, careContexts: MOCK_CARE_CONTEXTS }],
    };
  }

  async linkCareContexts(input: { hipId: string; careContextReferences: string[]; otp?: string; abhaAddress: string }): Promise<CareContextLinkResult> {
    if (input.hipId !== MOCK_HIP.hipId) return { status: "failed", linked: [] };
    if (!input.otp) return { status: "otp_required", linked: [] };
    if (input.otp !== MOCK_OTP) throw new ApiProblem(ERROR_CODES.OTP_INVALID, "Incorrect OTP", 400);
    const linked = MOCK_CARE_CONTEXTS.filter((c) => input.careContextReferences.includes(c.reference));
    if (linked.length === 0) return { status: "failed", linked: [] };
    const now = new Date();
    const transactionId = `mock-transfer-${randomUUID()}`;
    return {
      status: "linked",
      linked,
      simulated: {
        consent: {
          artefactId: `mock-consent-${randomUUID()}`,
          purposeCode: "CAREMGT",
          hiTypes: ["Prescription"],
          hiuId: "medicinepassport-hiu",
          dateRangeFrom: new Date(now.getTime() - 365 * 86_400_000).toISOString(),
          dateRangeTo: now.toISOString(),
          dataEraseAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
        },
        bundle: { transactionId, hiType: "Prescription", fhirVersion: "4.0.1", igVersion: "6.5", entryCount: mockPrescriptionBundle().entry?.length ?? 0 },
      },
    };
  }

  async revokeConsent(): Promise<{ status: "revoked" }> {
    return { status: "revoked" };
  }

  async fetchBundle(): Promise<FetchedBundle> {
    return { hiType: "Prescription", fhirVersion: "4.0.1", igVersion: "6.5", bundle: mockPrescriptionBundle() };
  }
}

export function normalizeAbhaNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`;
}

/**
 * The bundle the mock HIP "transfers": a valid v6.5 PrescriptionRecord built through the same
 * serializer the export uses, so the inbound path is exercised against a conformant document.
 * Ids are fixed so an import is reproducible; provenance says the HIP authenticated it.
 */
export function mockPrescriptionBundle(): ReturnType<typeof serializePrescriptionRecord>["bundle"] {
  const recordedAt = "2026-08-14T09:30:00.000Z";
  const prov: CanonicalProvenance = {
    source: "clinic_entered",
    verification: "provider_verified",
    recordedByUserId: null,
    recordedVia: "clinic_portal",
    recordedAt,
    sourceOrganizationId: "0b1c2d3e-4f50-4a6b-9c7d-8e9f0a1b2c3d",
    sourcePractitionerId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  };
  const patient = { patientProfileId: "aaaaaaaa-0000-4000-8000-000000000001", abhaAddress: "sandbox.patient@sbx", display: "ABDM Sandbox Patient" };
  const record: CanonicalPrescriptionRecord = {
    prescription: { id: "bbbbbbbb-0000-4000-8000-000000000001", patient, prescribedAt: "2026-08-14", notes: null, diagnosisText: "Type 2 diabetes mellitus", validUntil: null, followUpOn: null, practitionerId: prov.sourcePractitionerId!, encounterId: null, provenance: prov },
    patient: { id: patient.patientProfileId, displayName: patient.display, yearOfBirth: 1975, sex: "female", abhaAddress: patient.abhaAddress, abhaNumber: null, provenance: prov },
    practitioner: { id: prov.sourcePractitionerId!, displayName: "Dr. Meera Iyer", speciality: "General Physician", registrationNumber: "TNMC/12345", registrationCouncil: "Tamil Nadu Medical Council", hprId: "71-1234-5678-9012", organizationId: prov.sourceOrganizationId!, provenance: prov },
    organization: { id: prov.sourceOrganizationId!, displayName: MOCK_HIP.hipName, kind: "hospital", hfrId: "IN2910000123", addressText: null, city: "Hyderabad", state: "Telangana", pincode: null, provenance: prov },
    items: [
      {
        id: "cccccccc-0000-4000-8000-000000000001",
        patient,
        prescriptionId: "bbbbbbbb-0000-4000-8000-000000000001",
        sequence: 1,
        enteredName: "Metformin",
        medicationId: null,
        strengthLabel: "500 mg",
        formText: "Tablet",
        authoredOn: "2026-08-14",
        practitionerId: prov.sourcePractitionerId!,
        encounterId: null,
        completed: false,
        dosage: { doseQuantity: "1", doseUnit: "tablet", frequencyCode: "BD", pattern: null, foodInstruction: "after", durationDays: 30, routeText: "oral", text: "1 tab BD after food x 30 days" },
        provenance: prov,
      },
      {
        id: "cccccccc-0000-4000-8000-000000000002",
        patient,
        prescriptionId: "bbbbbbbb-0000-4000-8000-000000000001",
        sequence: 2,
        enteredName: "Atorvastatin",
        medicationId: null,
        strengthLabel: "10 mg",
        formText: "Tablet",
        authoredOn: "2026-08-14",
        practitionerId: prov.sourcePractitionerId!,
        encounterId: null,
        completed: false,
        dosage: { doseQuantity: "1", doseUnit: "tablet", frequencyCode: "HS", pattern: null, foodInstruction: "any", durationDays: 90, routeText: null, text: "1 tab at night" },
        provenance: prov,
      },
    ],
    medications: [],
    documents: [],
  };
  return serializePrescriptionRecord(record, { ig: "6.5", softwareVersion: "abdm-gateway-mock@0.1.0", timestamp: recordedAt }).bundle;
}

// ---------------------------------------------------------------------------------------------
// HTTP client → apps/abdm-gateway /internal/*
// ---------------------------------------------------------------------------------------------

export class HttpAbdmGatewayClient implements AbdmGatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    readonly env: AbdmGatewayEnv,
  ) {}

  linkInit(input: Parameters<AbdmGatewayClient["linkInit"]>[0]): Promise<LinkInitResult> {
    return this.call("POST", "/internal/abha/link/init", input);
  }
  linkVerify(input: Parameters<AbdmGatewayClient["linkVerify"]>[0]): Promise<LinkVerifyResult> {
    return this.call("POST", "/internal/abha/link/verify", input);
  }
  discover(input: Parameters<AbdmGatewayClient["discover"]>[0]): Promise<{ transactionId: string }> {
    return this.call("POST", "/internal/discover", input);
  }
  discoveryResult(input: { transactionId: string; correlationId?: string }): Promise<DiscoveryResult> {
    return this.call("GET", `/internal/discover/${encodeURIComponent(input.transactionId)}`, undefined, input.correlationId);
  }
  linkCareContexts(input: Parameters<AbdmGatewayClient["linkCareContexts"]>[0]): Promise<CareContextLinkResult> {
    return this.call("POST", "/internal/care-contexts/link", input);
  }
  revokeConsent(input: Parameters<AbdmGatewayClient["revokeConsent"]>[0]): Promise<{ status: "revoked" }> {
    return this.call("POST", `/internal/consents/${encodeURIComponent(input.artefactId)}/revoke`, input);
  }
  fetchBundle(input: { bundleId: string; transactionId: string | null; correlationId?: string }): Promise<FetchedBundle> {
    return this.call("GET", `/internal/bundles/${encodeURIComponent(input.bundleId)}/content`, undefined, input.correlationId);
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: { correlationId?: string } & Record<string, unknown>, correlationId?: string): Promise<T> {
    const headers: Record<string, string> = { "x-abdm-internal-token": this.token, accept: "application/json" };
    const cid = body?.correlationId ?? correlationId;
    if (cid) headers["x-correlation-id"] = cid;
    if (body) headers["content-type"] = "application/json";
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) {
      // The gateway answers RFC 7807; carry its code through when it is one of ours.
      let code: string | undefined;
      try {
        code = (JSON.parse(text) as { code?: string }).code;
      } catch {
        /* not JSON */
      }
      const known = Object.values(ERROR_CODES).find((c) => c === code);
      throw new ApiProblem(known ?? ERROR_CODES.VALIDATION_FAILED, `ABDM gateway ${path} failed (${res.status})`, res.status === 404 ? 404 : res.status === 400 ? 400 : 502);
    }
    return JSON.parse(text) as T;
  }
}
