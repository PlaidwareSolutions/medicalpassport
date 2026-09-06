import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { ProviderPatientLink } from "@medpass/database";
import { PROVIDER_LINK_SECTIONS, type CreateOnboardingTokenInput, type ProviderLinkSection } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { hashShareToken, newOpaqueToken } from "../../common/crypto";
import { DoctorSnapshotService } from "../sharing/doctor-snapshot.service";
import { ALL_SECTIONS, type VisitSummarySections } from "../sharing/visit-summary.service";

/**
 * Marker on the `ShareLink` rows that hold onboarding tokens. They reuse
 * the share tables (same "section-scoped, time-boxed, hashed capability"
 * shape) but are hashed under their own domain, so the public share route
 * can never redeem one and the provider onboard route can never redeem a
 * share link.
 */
export const ONBOARDING_AUDIENCE = "provider_onboarding";
const HASH_DOMAIN = "provider-onboarding:";

const TOKEN_TTL_MS: Record<CreateOnboardingTokenInput["expiresIn"], number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

export function hashOnboardingToken(token: string): string {
  return hashShareToken(HASH_DOMAIN + token);
}

interface PatientActor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

interface ProviderActor {
  userId: string;
  organizationId: string;
  correlationId?: string;
}

export function linkSections(link: { sections: unknown }): ProviderLinkSection[] {
  const raw = Array.isArray(link.sections) ? link.sections : [];
  return raw.filter((s): s is ProviderLinkSection => (PROVIDER_LINK_SECTIONS as readonly string[]).includes(String(s)));
}

/** The share-vocabulary flags a link grants: everything off except the named sections. */
export function sectionsToFlags(sections: readonly ProviderLinkSection[]): VisitSummarySections {
  const flags = Object.fromEntries(Object.keys(ALL_SECTIONS).map((k) => [k, false])) as unknown as VisitSummarySections;
  for (const s of sections) (flags as unknown as Record<string, boolean>)[s] = true;
  return flags;
}

function linkDto(link: ProviderPatientLink & { organization?: { id: string; displayName: string; kind: string } }) {
  const now = Date.now();
  const effectiveStatus = link.status === "active" && link.expiresAt.getTime() <= now ? "expired" : link.status;
  return {
    id: link.id,
    organization: link.organization
      ? { id: link.organization.id, displayName: link.organization.displayName, kind: link.organization.kind }
      : undefined,
    linkedVia: link.linkedVia,
    sections: linkSections(link),
    status: effectiveStatus,
    expiresAt: link.expiresAt.toISOString(),
    revokedAt: link.revokedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
  };
}

/**
 * QR onboarding (docs_v2/06 P11-3) and the provider ↔ patient relationship
 * it creates (`ProviderPatientLink`, docs_v2/03 §11): time-boxed,
 * section-scoped, revocable by the patient at any moment, and every
 * provider read through it audited with the organization id.
 */
@Injectable()
export class PatientLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: DoctorSnapshotService,
  ) {}

  // ───────────────────────── patient side ─────────────────────────

  async createOnboardingToken(profileId: string, input: CreateOnboardingTokenInput, actor: PatientActor) {
    const token = newOpaqueToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[input.expiresIn]);
    const sections = [...new Set(input.sections)];
    const link = await this.prisma.$transaction(async (tx) => {
      const pkg = await tx.sharePackage.create({
        data: {
          patientProfileId: profileId,
          sections: { providerOnboarding: true, sections, accessDays: input.accessDays },
          createdByUserId: actor.userId,
        },
      });
      const created = await tx.shareLink.create({
        data: { sharePackageId: pkg.id, tokenHash: hashOnboardingToken(token), kind: "qr", audience: ONBOARDING_AUDIENCE, expiresAt },
      });
      await writeAudit(tx, {
        action: "provider.onboarding_token_created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "share_link",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { sections, expiresIn: input.expiresIn, accessDays: input.accessDays },
      });
      return created;
    });
    return { id: link.id, token, sections, expiresAt: expiresAt.toISOString(), accessDays: input.accessDays };
  }

  async listForPatient(profileId: string) {
    const links = await this.prisma.providerPatientLink.findMany({
      where: { patientProfileId: profileId },
      include: { organization: { select: { id: true, displayName: true, kind: true } } },
      orderBy: { createdAt: "desc" },
    });
    return links.map(linkDto);
  }

  async revoke(profileId: string, linkId: string, actor: PatientActor) {
    const link = await this.prisma.providerPatientLink.findFirst({ where: { id: linkId, patientProfileId: profileId } });
    if (!link) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Provider link not found", 404);
    if (link.status === "revoked") return linkDto(link);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.providerPatientLink.update({
        where: { id: link.id },
        data: { status: "revoked", revokedAt: new Date() },
        include: { organization: { select: { id: true, displayName: true, kind: true } } },
      });
      await writeAudit(tx, {
        action: "provider.link_revoked",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "provider_patient_link",
        entityId: link.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { organizationId: link.organizationId },
      });
      return row;
    });
    return linkDto(updated);
  }

  // ───────────────────────── provider side ─────────────────────────

  async onboard(qrToken: string, actor: ProviderActor) {
    const tokenHash = hashOnboardingToken(qrToken);
    const created = await this.prisma.$transaction(async (tx) => {
      const share = await tx.shareLink.findUnique({ where: { tokenHash }, include: { sharePackage: true } });
      // Unknown, spent, revoked and expired all read the same: the code on
      // the patient's screen is a secret, and a scanner never learns which.
      if (!share || share.audience !== ONBOARDING_AUDIENCE || share.revokedAt || share.expiresAt < new Date()) {
        throw new ApiProblem(ERROR_CODES.NOT_FOUND, "This code is not valid. Ask the patient to show a new one.", 404);
      }
      const pkg = share.sharePackage.sections as { sections?: unknown; accessDays?: unknown };
      const sections = linkSections({ sections: pkg.sections });
      const accessDays = typeof pkg.accessDays === "number" && pkg.accessDays >= 1 ? Math.min(pkg.accessDays, 90) : 30;
      if (sections.length === 0) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "This code is not valid. Ask the patient to show a new one.", 404);

      // Single use: consumed the moment it is redeemed.
      await tx.shareLink.update({
        where: { id: share.id },
        data: { revokedAt: new Date(), revokedByUserId: actor.userId, recipientOrganizationId: actor.organizationId },
      });
      const link = await tx.providerPatientLink.create({
        data: {
          organizationId: actor.organizationId,
          patientProfileId: share.sharePackage.patientProfileId,
          linkedVia: "qr_onboarding",
          sections,
          expiresAt: new Date(Date.now() + accessDays * 24 * 60 * 60_000),
          createdByUserId: actor.userId,
        },
        include: { patientProfile: { select: { displayName: true, yearOfBirth: true, sex: true } } },
      });
      await writeAudit(tx, {
        action: "provider.link_created",
        actorUserId: actor.userId,
        actorType: "provider",
        entityType: "provider_patient_link",
        entityId: link.id,
        patientProfileId: link.patientProfileId,
        correlationId: actor.correlationId,
        context: { organizationId: actor.organizationId, via: "qr_onboarding", sections, accessDays },
      });
      return link;
    });
    return this.providerLinkDto(created);
  }

  async listForProvider(actor: ProviderActor) {
    const links = await this.prisma.providerPatientLink.findMany({
      where: { organizationId: actor.organizationId, status: "active", expiresAt: { gt: new Date() } },
      include: { patientProfile: { select: { displayName: true, yearOfBirth: true, sex: true } } },
      orderBy: { createdAt: "desc" },
    });
    await writeAudit(this.prisma, {
      action: "provider.patients_listed",
      actorUserId: actor.userId,
      actorType: "provider",
      correlationId: actor.correlationId,
      context: { organizationId: actor.organizationId, count: links.length },
    });
    return links.map((l) => this.providerLinkDto(l));
  }

  /** The link must belong to the caller's organization and still be open; anything else is a 404. */
  async requireActiveLink(linkId: string, organizationId: string) {
    const link = await this.prisma.providerPatientLink.findFirst({
      where: { id: linkId, organizationId, status: "active", expiresAt: { gt: new Date() } },
    });
    if (!link) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Patient link not found", 404);
    return link;
  }

  async snapshot(linkId: string, actor: ProviderActor) {
    const link = await this.requireActiveLink(linkId, actor.organizationId);
    const sections = linkSections(link);
    const snapshot = await this.snapshots.build(link.patientProfileId, sectionsToFlags(sections));
    // The shared snapshot DTO carries no medicine ids (it also feeds the
    // unauthenticated public share). A provider needs them: a reconciliation
    // or discharge line refers to the patient's medicine by
    // `patientMedicationId`, and `ProposalsService.create` verifies every id
    // against this same link. Same filter and order as
    // VisitSummaryService.addMedications, so the rows zip one-to-one.
    if (snapshot.currentMedications) {
      const ids = await this.prisma.patientMedication.findMany({
        where: { patientProfileId: link.patientProfileId, status: "current", deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (ids.length === snapshot.currentMedications.length) {
        snapshot.currentMedications = snapshot.currentMedications.map((m, i) => ({ ...m, patientMedicationId: ids[i]!.id }));
      }
    }
    await writeAudit(this.prisma, {
      action: "provider.snapshot_viewed",
      actorUserId: actor.userId,
      actorType: "provider",
      entityType: "provider_patient_link",
      entityId: link.id,
      patientProfileId: link.patientProfileId,
      correlationId: actor.correlationId,
      context: { organizationId: actor.organizationId, sections },
    });
    return { linkId: link.id, sections, ...snapshot };
  }

  private providerLinkDto(
    link: ProviderPatientLink & { patientProfile?: { displayName: string; yearOfBirth: number | null; sex: string | null } },
  ) {
    return {
      linkId: link.id,
      patient: link.patientProfile
        ? { displayName: link.patientProfile.displayName, yearOfBirth: link.patientProfile.yearOfBirth, sex: link.patientProfile.sex }
        : undefined,
      sections: linkSections(link),
      status: link.status,
      expiresAt: link.expiresAt.toISOString(),
      createdAt: link.createdAt.toISOString(),
    };
  }
}
