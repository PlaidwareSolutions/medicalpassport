import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { ProviderLoginInput, ProviderTotpInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { hashSessionToken, newOpaqueToken, phoneDigest, verifyOtp } from "../../common/crypto";
import { AuthService } from "../auth/auth.service";
import { hashProviderToken, newProviderToken } from "./provider-session";

const OTP_MAX_VERIFY_ATTEMPTS = 5;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

export interface IssuedProviderSession {
  token: string;
  expiresAt: Date;
  userId: string;
  organizations: Array<{ id: string; displayName: string; kind: string; role: string }>;
}

/**
 * Provider sign-in (docs_v2/06 P11-2). Phone OTP only for now: the OTP
 * service, its rate limits and its audit trail are reused verbatim; the
 * *session* it ends in is a provider-type token (./provider-session.ts).
 * Email + TOTP is not offered because no model stores a TOTP secret for a
 * `User` (only `AdminUser.mfaSecretCiphertext` exists) and schema changes
 * are out of scope for this pass.
 *
 * Nothing here creates accounts: a number that is not already a provider
 * (`User.userKind` provider|both with an active `OrganizationMember`) gets
 * the same 403 after a correct code, so the OTP request itself stays
 * enumeration-safe.
 */
@Injectable()
export class ProviderAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async requestLogin(input: ProviderLoginInput, ip: string | undefined, correlationId?: string): Promise<void> {
    await this.auth.requestOtp({ phone: input.phone, purpose: "login" }, ip, correlationId);
  }

  async verify(input: ProviderTotpInput, correlationId?: string): Promise<IssuedProviderSession> {
    const digest = phoneDigest(input.phone);
    const attempt = await this.prisma.otpAttempt.findFirst({
      where: { phoneDigest: digest, consumedAt: null, invalidatedAt: null, purpose: "login" },
      orderBy: { createdAt: "desc" },
    });

    const fail = async (code: "otp_invalid" | "otp_expired" | "otp_locked", title: string, status: number) => {
      await writeAudit(this.prisma, {
        action: "provider.login_failed",
        actorType: "provider",
        correlationId,
        context: { reason: code },
      });
      throw new ApiProblem(ERROR_CODES[code.toUpperCase() as "OTP_INVALID"], title, status);
    };

    if (!attempt) await fail("otp_invalid", "That code is not correct. Please check and try again.", 400);
    if (attempt!.expiresAt < new Date()) await fail("otp_expired", "That code has expired. Please request a new one.", 400);
    if (attempt!.verifyAttempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      await fail("otp_locked", "Too many attempts. Please request a new code later.", 423);
    }
    await this.prisma.otpAttempt.update({ where: { id: attempt!.id }, data: { verifyAttempts: { increment: 1 } } });
    if (!verifyOtp(input.code, attempt!.otpHash)) {
      if (attempt!.verifyAttempts + 1 >= OTP_MAX_VERIFY_ATTEMPTS) {
        await this.prisma.otpAttempt.update({ where: { id: attempt!.id }, data: { invalidatedAt: new Date() } });
      }
      await fail("otp_invalid", "That code is not correct. Please check and try again.", 400);
    }

    const user = await this.prisma.user.findUnique({
      where: { phoneDigest: digest },
      include: { organizationMembers: { where: { status: "active" }, include: { organization: true } } },
    });
    const memberships = user?.organizationMembers.filter((m) => !m.organization.deletedAt) ?? [];
    if (!user || user.status !== "active" || user.userKind === "patient" || memberships.length === 0) {
      // The code was right, so consume it — a wrong-surface login must not
      // leave a live OTP behind for a second try elsewhere.
      await this.prisma.otpAttempt.update({ where: { id: attempt!.id }, data: { consumedAt: new Date() } });
      await writeAudit(this.prisma, {
        action: "provider.login_failed",
        actorUserId: user?.id,
        actorType: "provider",
        correlationId,
        context: { reason: "not_a_provider" },
      });
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "This number is not registered with a provider organization", 403);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.otpAttempt.update({ where: { id: attempt!.id }, data: { consumedAt: new Date() } });
      if (!user.phoneVerifiedAt) await tx.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
      const device = await tx.userDevice.create({ data: { userId: user.id, kind: "browser", label: "provider-web" } });
      const token = newProviderToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const session = await tx.session.create({
        data: {
          userId: user.id,
          userDeviceId: device.id,
          tokenHash: hashProviderToken(token),
          // No refresh flow on the provider surface; the column is required,
          // so it holds a hash nothing can ever present.
          refreshTokenHash: hashSessionToken(newOpaqueToken()),
          expiresAt,
          refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      });
      await writeAudit(tx, {
        action: "provider.session_created",
        actorUserId: user.id,
        actorType: "provider",
        entityType: "session",
        entityId: session.id,
        correlationId,
        context: { organizationIds: memberships.map((m) => m.organizationId) },
      });
      return {
        token,
        expiresAt,
        userId: user.id,
        organizations: memberships.map((m) => ({
          id: m.organizationId,
          displayName: m.organization.displayName,
          kind: m.organization.kind,
          role: m.role,
        })),
      };
    });
  }

  async logout(userId: string, sessionId: string, correlationId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "logout" },
      });
      await writeAudit(tx, {
        action: "provider.session_revoked",
        actorUserId: userId,
        actorType: "provider",
        entityType: "session",
        entityId: sessionId,
        correlationId,
        context: { reason: "logout" },
      });
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { organizationMembers: { where: { status: "active" }, include: { organization: true } } },
    });
    return {
      userId: user.id,
      userKind: user.userKind,
      organizations: user.organizationMembers
        .filter((m) => !m.organization.deletedAt)
        .map((m) => ({ id: m.organizationId, displayName: m.organization.displayName, kind: m.organization.kind, role: m.role })),
    };
  }
}
