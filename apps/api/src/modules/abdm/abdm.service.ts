import { createHmac } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { AbdmConsentArtefact, AbdmDataBundle, AbhaLink, Prisma } from "@medpass/database";
import { ERROR_CODES } from "@medpass/domain";
import type { AbdmCareContextLinkInput, AbdmConsentRevokeInput, AbdmDiscoverInput, AbhaLinkInitInput, AbhaLinkVerifyInput } from "@medpass/validation";
import { decryptField, encryptField } from "../../common/crypto";
import { env } from "../../common/env";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { ABDM_GATEWAY_CLIENT, normalizeAbhaNumber, type AbdmGatewayClient, type SimulatedTransfer } from "./gateway-client";

export interface AbdmActor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

/** Deterministic digest for lookup of ABHA numbers — same construction as `phoneDigest` (docs/18), own domain tag. */
export function abhaNumberDigest(abhaNumber: string): string {
  return createHmac("sha256", env().OTP_HASH_PEPPER + ":abha").update(normalizeAbhaNumber(abhaNumber)).digest("hex");
}

/** `91-XXXX-XXXX-9012`: enough for the patient to recognise it, never the whole number in a list. */
export function maskAbhaNumber(abhaNumber: string): string {
  const n = normalizeAbhaNumber(abhaNumber);
  return `${n.slice(0, 2)}-XXXX-XXXX-${n.slice(-4)}`;
}

function consentDto(c: AbdmConsentArtefact) {
  return {
    id: c.id,
    artefactId: c.artefactId,
    consentRequestId: c.consentRequestId,
    purposeCode: c.purposeCode,
    hiTypes: c.hiTypes,
    hiuId: c.hiuId,
    status: c.status,
    dateRangeFrom: c.dateRangeFrom?.toISOString() ?? null,
    dateRangeTo: c.dateRangeTo?.toISOString() ?? null,
    dataEraseAt: c.dataEraseAt?.toISOString() ?? null,
    grantedAt: c.grantedAt?.toISOString() ?? null,
    revokedAt: c.revokedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

export function bundleDto(b: AbdmDataBundle) {
  return {
    id: b.id,
    consentArtefactId: b.consentArtefactId,
    transactionId: b.transactionId,
    hiType: b.hiType,
    fhirVersion: b.fhirVersion,
    igVersion: b.igVersion,
    entryCount: b.entryCount,
    importStatus: b.importStatus,
    erasedAt: b.erasedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

/**
 * ABHA identity + PHR flows (docs_v2/05 §10; docs_v2/08 §5 M8A, M8B, M8D). Every gateway call is
 * recorded as an `AbdmTransaction` with our correlation id and the ABDM transaction id
 * (docs_v2/08 §10). This service never writes a clinical table: received bundles become
 * candidates only through `AbdmImportService` (docs_v2/08 §7).
 */
@Injectable()
export class AbdmService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ABDM_GATEWAY_CLIENT) private readonly gateway: AbdmGatewayClient,
  ) {}

  // ───────────────────────── ABHA link (M8A) ─────────────────────────

  async status(profileId: string) {
    const link = await this.activeLink(profileId);
    if (!link) return { linked: false as const, gatewayEnv: this.gateway.env };
    const careContexts = await this.prisma.abdmCareContext.count({ where: { abhaLinkId: link.id, status: "linked" } });
    return {
      linked: true as const,
      gatewayEnv: this.gateway.env,
      abhaAddress: link.abhaAddress,
      abhaNumberMasked: maskAbhaNumber(decryptField(link.abhaNumberCiphertext)),
      linkedAt: link.linkedAt.toISOString(),
      lastVerifiedAt: link.lastVerifiedAt?.toISOString() ?? null,
      careContextCount: careContexts,
    };
  }

  async linkInit(profileId: string, input: AbhaLinkInitInput, actor: AbdmActor) {
    const txn = await this.startTransaction(profileId, "abha.link.init", "outbound", actor);
    let result;
    try {
      result = await this.gateway.linkInit({ ...input, correlationId: actor.correlationId });
    } catch (err) {
      await this.failTransaction(txn.id, err);
      throw err;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.abdmTransaction.update({ where: { id: txn.id }, data: { transactionId: result.transactionId, status: "completed", completedAt: new Date() } });
      await writeAudit(tx, {
        action: "abha.link_initiated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "abdm_transaction",
        entityId: txn.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { method: input.method, gatewayEnv: this.gateway.env },
      });
    });
    return { transactionId: result.transactionId, otpSentTo: result.otpSentTo, expiresInSeconds: 600 };
  }

  async linkVerify(profileId: string, input: AbhaLinkVerifyInput, actor: AbdmActor) {
    const init = await this.prisma.abdmTransaction.findFirst({ where: { patientProfileId: profileId, kind: "abha.link.init", transactionId: input.transactionId } });
    if (!init) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Unknown or expired ABHA transaction", 404);

    const txn = await this.startTransaction(profileId, "abha.link.verify", "outbound", actor, input.transactionId);
    let verified;
    try {
      verified = await this.gateway.linkVerify({ transactionId: input.transactionId, otp: input.otp, abhaAddress: input.abhaAddress, correlationId: actor.correlationId });
    } catch (err) {
      await this.failTransaction(txn.id, err);
      throw err;
    }

    const digest = abhaNumberDigest(verified.abhaNumber);
    const now = new Date();
    const link = await this.prisma.$transaction(async (tx) => {
      // One active ABHA per profile: a re-link of the same number refreshes it; a different number
      // supersedes the old link (its imported rows keep their provenance, docs_v2/05 §10).
      const existing = await tx.abhaLink.findMany({ where: { patientProfileId: profileId, status: "active" } });
      const same = existing.find((l) => l.abhaNumberDigest === digest);
      for (const other of existing.filter((l) => l.abhaNumberDigest !== digest)) {
        await tx.abhaLink.update({ where: { id: other.id }, data: { status: "unlinked", unlinkedAt: now } });
      }
      const row = same
        ? await tx.abhaLink.update({
            where: { id: same.id },
            data: { abhaAddress: verified.abhaAddress, lastVerifiedAt: now, profileSnapshot: verified.profile as Prisma.InputJsonValue },
          })
        : await tx.abhaLink.create({
            data: {
              patientProfileId: profileId,
              abhaNumberCiphertext: encryptField(normalizeAbhaNumber(verified.abhaNumber)),
              abhaNumberDigest: digest,
              abhaAddress: verified.abhaAddress,
              status: "active",
              lastVerifiedAt: now,
              profileSnapshot: verified.profile as Prisma.InputJsonValue,
            },
          });
      await tx.abdmTransaction.update({ where: { id: txn.id }, data: { status: "completed", completedAt: now } });
      await writeAudit(tx, {
        action: "abha.linked",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "abha_link",
        entityId: row.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { relinked: !!same, gatewayEnv: this.gateway.env },
      });
      return row;
    });
    return { linked: true as const, abhaAddress: link.abhaAddress, abhaNumberMasked: maskAbhaNumber(verified.abhaNumber), linkedAt: link.linkedAt.toISOString() };
  }

  /** Unlink keeps every imported row and its `sourceAbdmTxnId`; only the identity link ends. */
  async unlink(profileId: string, actor: AbdmActor): Promise<void> {
    const link = await this.activeLink(profileId);
    if (!link) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "No ABHA is linked to this profile", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.abhaLink.update({ where: { id: link.id }, data: { status: "unlinked", unlinkedAt: new Date() } });
      await writeAudit(tx, {
        action: "abha.unlinked",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "abha_link",
        entityId: link.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }

  // ───────────────────────── discovery + care contexts (M8B) ─────────────────────────

  async discover(profileId: string, input: AbdmDiscoverInput, actor: AbdmActor) {
    const link = await this.requireLink(profileId);
    const txn = await this.startTransaction(profileId, "abdm.discover", "outbound", actor);
    let result;
    try {
      result = await this.gateway.discover({ abhaAddress: link.abhaAddress!, abhaNumber: decryptField(link.abhaNumberCiphertext), hipId: input.hipId, correlationId: actor.correlationId });
    } catch (err) {
      await this.failTransaction(txn.id, err);
      throw err;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.abdmTransaction.update({ where: { id: txn.id }, data: { transactionId: result.transactionId, status: "completed", completedAt: new Date() } });
      await writeAudit(tx, {
        action: "abdm.discovery_requested",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "abdm_transaction",
        entityId: txn.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { hipId: input.hipId ?? null },
      });
    });
    return { transactionId: result.transactionId };
  }

  async discoveryResult(profileId: string, transactionId: string, actor: AbdmActor) {
    const txn = await this.prisma.abdmTransaction.findFirst({ where: { patientProfileId: profileId, kind: "abdm.discover", transactionId } });
    if (!txn) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Unknown discovery transaction", 404);
    const result = await this.gateway.discoveryResult({ transactionId, correlationId: actor.correlationId });
    return { transactionId, ...result };
  }

  async linkCareContexts(profileId: string, input: AbdmCareContextLinkInput, actor: AbdmActor) {
    const link = await this.requireLink(profileId);
    const discovery = await this.prisma.abdmTransaction.findFirst({ where: { patientProfileId: profileId, kind: "abdm.discover", transactionId: input.transactionId } });
    if (!discovery) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Unknown discovery transaction", 404);

    const txn = await this.startTransaction(profileId, "abdm.care-contexts.link", "outbound", actor, input.transactionId);
    let result;
    try {
      result = await this.gateway.linkCareContexts({ ...input, abhaAddress: link.abhaAddress!, correlationId: actor.correlationId });
    } catch (err) {
      await this.failTransaction(txn.id, err);
      throw err;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const context of result.linked) {
        await tx.abdmCareContext.upsert({
          where: { abhaLinkId_hipId_careContextReference: { abhaLinkId: link.id, hipId: input.hipId, careContextReference: context.reference } },
          create: { abhaLinkId: link.id, hipId: input.hipId, hipName: null, patientReferenceNumber: input.patientReferenceNumber, careContextReference: context.reference, display: context.display, status: "linked" },
          update: { display: context.display, status: "linked", patientReferenceNumber: input.patientReferenceNumber },
        });
      }
      if (result.simulated) await this.persistSimulatedTransfer(tx, profileId, link, result.simulated, actor);
      await tx.abdmTransaction.update({ where: { id: txn.id }, data: { status: result.status === "linked" ? "completed" : result.status, completedAt: new Date() } });
      await writeAudit(tx, {
        action: "abdm.care_contexts_linked",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "abdm_transaction",
        entityId: txn.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { hipId: input.hipId, status: result.status, linkedCount: result.linked.length },
      });
    });
    return { status: result.status, linked: result.linked };
  }

  /**
   * The mock gateway returns the consent + transfer that followed a link in the recorded sandbox
   * session; the real gateway persists these rows itself from ABDM callbacks, so this runs only
   * for `gatewayEnv = mock`. The bundle stays `received` until the patient asks to import it.
   */
  private async persistSimulatedTransfer(tx: Prisma.TransactionClient, profileId: string, link: AbhaLink, transfer: SimulatedTransfer, actor: AbdmActor): Promise<void> {
    const consent = await tx.abdmConsentArtefact.create({
      data: {
        abhaLinkId: link.id,
        artefactId: transfer.consent.artefactId,
        purposeCode: transfer.consent.purposeCode,
        hiTypes: transfer.consent.hiTypes,
        hiuId: transfer.consent.hiuId,
        dateRangeFrom: new Date(transfer.consent.dateRangeFrom),
        dateRangeTo: new Date(transfer.consent.dateRangeTo),
        dataEraseAt: new Date(transfer.consent.dataEraseAt),
        status: "granted",
        grantedAt: new Date(),
      },
    });
    await tx.abdmTransaction.create({
      data: {
        patientProfileId: profileId,
        kind: "health-information.transfer",
        transactionId: transfer.bundle.transactionId,
        correlationId: actor.correlationId ?? null,
        direction: "inbound",
        status: "completed",
        gatewayEnv: this.gateway.env,
        completedAt: new Date(),
      },
    });
    await tx.abdmDataBundle.create({
      data: {
        patientProfileId: profileId,
        consentArtefactId: consent.id,
        transactionId: transfer.bundle.transactionId,
        hiType: transfer.bundle.hiType,
        fhirVersion: transfer.bundle.fhirVersion,
        igVersion: transfer.bundle.igVersion,
        entryCount: transfer.bundle.entryCount,
        importStatus: "received",
      },
    });
  }

  // ───────────────────────── consents (M8D) + bundles ─────────────────────────

  async listConsents(profileId: string) {
    const rows = await this.prisma.abdmConsentArtefact.findMany({ where: { abhaLink: { patientProfileId: profileId } }, orderBy: { createdAt: "desc" } });
    return rows.map(consentDto);
  }

  async revokeConsent(profileId: string, id: string, input: AbdmConsentRevokeInput, actor: AbdmActor) {
    const consent = await this.prisma.abdmConsentArtefact.findFirst({ where: { id, abhaLink: { patientProfileId: profileId } }, include: { abhaLink: true } });
    if (!consent) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Consent not found", 404);
    if (consent.status !== "granted" && consent.status !== "requested") {
      throw new ApiProblem(ERROR_CODES.INVALID_STATUS_TRANSITION, `A ${consent.status} consent cannot be revoked`, 409);
    }
    const txn = await this.startTransaction(profileId, "abdm.consent.revoke", "outbound", actor);
    try {
      await this.gateway.revokeConsent({ artefactId: consent.artefactId ?? consent.id, abhaAddress: consent.abhaLink.abhaAddress ?? "", reason: input.reason, correlationId: actor.correlationId });
    } catch (err) {
      await this.failTransaction(txn.id, err);
      throw err;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.abdmConsentArtefact.update({ where: { id: consent.id }, data: { status: "revoked", revokedAt: new Date() } });
      await tx.abdmTransaction.update({ where: { id: txn.id }, data: { status: "completed", completedAt: new Date() } });
      await writeAudit(tx, {
        action: "abdm.consent_revoked",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "abdm_consent_artefact",
        entityId: consent.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { reason: input.reason ?? null },
      });
      return row;
    });
    return consentDto(updated);
  }

  async listBundles(profileId: string) {
    const rows = await this.prisma.abdmDataBundle.findMany({ where: { patientProfileId: profileId }, orderBy: { createdAt: "desc" } });
    return rows.map(bundleDto);
  }

  // ───────────────────────── helpers ─────────────────────────

  private activeLink(profileId: string) {
    return this.prisma.abhaLink.findFirst({ where: { patientProfileId: profileId, status: "active" }, orderBy: { linkedAt: "desc" } });
  }

  private async requireLink(profileId: string): Promise<AbhaLink> {
    const link = await this.activeLink(profileId);
    if (!link || !link.abhaAddress) throw new ApiProblem(ERROR_CODES.CONSENT_REQUIRED, "Link an ABHA before using ABDM records", 409);
    return link;
  }

  private startTransaction(profileId: string, kind: string, direction: "outbound" | "inbound", actor: AbdmActor, transactionId?: string) {
    return this.prisma.abdmTransaction.create({
      data: { patientProfileId: profileId, kind, direction, status: "pending", correlationId: actor.correlationId ?? null, transactionId: transactionId ?? null, gatewayEnv: this.gateway.env },
    });
  }

  private async failTransaction(id: string, err: unknown): Promise<void> {
    const code = err instanceof ApiProblem ? err.code : "gateway_error";
    const text = err instanceof Error ? err.message.slice(0, 500) : "unknown";
    await this.prisma.abdmTransaction.update({ where: { id }, data: { status: "failed", errorCode: code, errorText: text, completedAt: new Date() } });
  }
}
