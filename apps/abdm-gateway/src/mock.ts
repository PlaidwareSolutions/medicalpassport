import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";

/**
 * `MOCK=true` (docs_v2/08 §9): replays recorded sandbox transactions from `apps/abdm-gateway/fixtures`
 * so CI and local development run the full ABHA / discovery / link / transfer flow without network.
 * Each fixture is one recorded gateway exchange; the replay is deterministic apart from fresh
 * transaction ids. Nothing here ever reaches the real gateway.
 */

export interface MockFixtures {
  /** `link-init.json`: what the gateway answers to an ABHA link/init. */
  linkInit: { otpSentToSuffix: string; expiresInSeconds: number };
  /** `link-verify.json`: the ABHA profile returned once the OTP matches. */
  linkVerify: { otp: string; abhaNumber: string; abhaAddress: string; profile: { name: string; gender: string | null; yearOfBirth: number | null } };
  /** `discovery.json`: the HIP `patients/on-find` payload. */
  discovery: { hipId: string; hipName: string; patientReferenceNumber: string; careContexts: Array<{ reference: string; display: string }>; linkOtp: string };
  /** `transfer.json`: the consent artefact and the FHIR bundle the HIP pushes after linking. */
  transfer: { consent: Record<string, unknown>; hiType: string; fhirVersion: string; igVersion: string; bundle: { resourceType: string; entry?: unknown[] } };
}

export const MOCK_ABHA_NUMBER_DIGITS = 14;

/** Deterministic 14-digit ABHA number for a seed, so two mock identities never collide. */
export function mockAbhaNumberFor(seed: string): string {
  const digits = createHash("sha256").update(`abha:${seed}`).digest("hex").replace(/[^0-9]/g, "").padEnd(MOCK_ABHA_NUMBER_DIGITS, "7").slice(0, MOCK_ABHA_NUMBER_DIGITS);
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`;
}

export function loadFixtures(dir: string): MockFixtures {
  const read = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
  const present = new Set(readdirSync(dir));
  for (const required of ["link-init.json", "link-verify.json", "discovery.json", "transfer.json"]) {
    if (!present.has(required)) throw new Error(`mock fixture missing: ${required}`);
  }
  return { linkInit: read("link-init.json"), linkVerify: read("link-verify.json"), discovery: read("discovery.json"), transfer: read("transfer.json") };
}

interface PendingLink {
  seed: string;
  abhaNumber: string | null;
}

@Injectable()
export class MockGatewayService {
  private readonly pendingLinks = new Map<string, PendingLink>();
  private readonly discoveries = new Map<string, { abhaAddress: string; hipId: string }>();
  private readonly transfers = new Map<string, { hiType: string; fhirVersion: string; igVersion: string; bundle: unknown }>();

  constructor(readonly fixtures: MockFixtures) {}

  linkInit(input: { method: string; abhaNumber?: string; mobile?: string; aadhaar?: string }) {
    const seed = input.abhaNumber ?? input.mobile ?? input.aadhaar ?? "anonymous";
    const transactionId = `mock-link-${randomUUID()}`;
    this.pendingLinks.set(transactionId, { seed, abhaNumber: input.method === "abha_number" && input.abhaNumber ? input.abhaNumber : null });
    const digits = seed.replace(/\D/g, "");
    return { transactionId, otpSentTo: `******${(digits.slice(-4) || this.fixtures.linkInit.otpSentToSuffix).padStart(4, "0")}`, expiresInSeconds: this.fixtures.linkInit.expiresInSeconds };
  }

  linkVerify(input: { transactionId: string; otp: string; abhaAddress?: string }): { ok: true; result: MockFixtures["linkVerify"] } | { ok: false; reason: "unknown_transaction" | "otp_invalid" } {
    const pending = this.pendingLinks.get(input.transactionId);
    if (!pending) return { ok: false, reason: "unknown_transaction" };
    if (input.otp !== this.fixtures.linkVerify.otp) return { ok: false, reason: "otp_invalid" };
    this.pendingLinks.delete(input.transactionId);
    const f = this.fixtures.linkVerify;
    return {
      ok: true,
      result: {
        otp: f.otp,
        abhaNumber: pending.abhaNumber ?? mockAbhaNumberFor(pending.seed),
        abhaAddress: input.abhaAddress ?? `mock${createHash("sha256").update(`addr:${pending.seed}`).digest("hex").slice(0, 8)}@sbx`,
        profile: f.profile,
      },
    };
  }

  discover(input: { abhaAddress: string; hipId?: string }) {
    const transactionId = `mock-discover-${randomUUID()}`;
    this.discoveries.set(transactionId, { abhaAddress: input.abhaAddress, hipId: input.hipId ?? this.fixtures.discovery.hipId });
    return { transactionId };
  }

  discoveryResult(transactionId: string) {
    const discovery = this.discoveries.get(transactionId);
    if (!discovery) return { status: "failed" as const, patients: [] };
    const f = this.fixtures.discovery;
    if (discovery.hipId !== f.hipId) return { status: "completed" as const, patients: [] };
    return { status: "completed" as const, patients: [{ hipId: f.hipId, hipName: f.hipName, patientReferenceNumber: `${f.patientReferenceNumber}-${discovery.abhaAddress.split("@")[0]}`, careContexts: f.careContexts }] };
  }

  linkCareContexts(input: { hipId: string; careContextReferences: string[]; otp?: string }) {
    const f = this.fixtures.discovery;
    if (input.hipId !== f.hipId) return { status: "failed" as const, linked: [] };
    if (!input.otp) return { status: "otp_required" as const, linked: [] };
    if (input.otp !== f.linkOtp) return { status: "otp_invalid" as const, linked: [] };
    const linked = f.careContexts.filter((c) => input.careContextReferences.includes(c.reference));
    if (linked.length === 0) return { status: "failed" as const, linked: [] };
    const transactionId = `mock-transfer-${randomUUID()}`;
    const t = this.fixtures.transfer;
    this.transfers.set(transactionId, { hiType: t.hiType, fhirVersion: t.fhirVersion, igVersion: t.igVersion, bundle: t.bundle });
    const now = new Date();
    return {
      status: "linked" as const,
      linked,
      simulated: {
        consent: {
          artefactId: `mock-consent-${randomUUID()}`,
          purposeCode: "CAREMGT",
          hiTypes: [t.hiType],
          hiuId: "medicinepassport-hiu",
          dateRangeFrom: new Date(now.getTime() - 365 * 86_400_000).toISOString(),
          dateRangeTo: now.toISOString(),
          dataEraseAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
          ...t.consent,
        },
        bundle: { transactionId, hiType: t.hiType, fhirVersion: t.fhirVersion, igVersion: t.igVersion, entryCount: t.bundle.entry?.length ?? 0 },
      },
    };
  }

  /** The decrypted bundle for a transfer; unknown ids fall back to the recorded fixture so a fresh process can still serve an import. */
  bundleContent(transactionId: string | null) {
    const t = (transactionId && this.transfers.get(transactionId)) || { hiType: this.fixtures.transfer.hiType, fhirVersion: this.fixtures.transfer.fhirVersion, igVersion: this.fixtures.transfer.igVersion, bundle: this.fixtures.transfer.bundle };
    return t;
  }
}
