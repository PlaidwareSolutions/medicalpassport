import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { Prisma, PrismaClient } from "@medpass/database";
import { ERROR_CODES } from "@medpass/domain";
import type { AdminDuty } from "@medpass/authorization";
import type { AdminLoginInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { encryptField, decryptField, hashSessionToken, hashPassword, newOpaqueToken, verifyPassword } from "../../common/crypto";
import { generateTotpSecret, totpUri, verifyTotpCode } from "../../common/totp";

const ADMIN_MAX_LOGIN_ATTEMPTS = 5;
const ADMIN_LOCKOUT_MS = 15 * 60_000;
const ADMIN_PENDING_TTL_MS = 10 * 60_000;
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60_000;
const ADMIN_REFRESH_TTL_MS = 7 * 24 * 60 * 60_000;

export interface IssuedAdminSession {
  token: string;
  refreshToken: string;
  expiresAt: Date;
  adminUserId: string;
  mfaVerified: boolean;
}

@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Password step. Returns a pending session either way; the controller
   * tells the client whether enrollment or verification comes next. */
  async login(input: AdminLoginInput, correlationId?: string): Promise<{ session: IssuedAdminSession; mfaEnrolled: boolean }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: input.email } });
    const fail = async () => {
      if (admin) {
        await writeAudit(this.prisma, {
          action: "admin.login_failed",
          actorUserId: admin.id,
          actorType: "admin",
          correlationId,
        });
      }
      throw new ApiProblem(ERROR_CODES.ADMIN_CREDENTIALS_INVALID, "Incorrect email or password", 401);
    };

    if (!admin || admin.status !== "active") await fail();
    if (admin!.lockedUntil && admin!.lockedUntil > new Date()) {
      throw new ApiProblem(ERROR_CODES.ADMIN_LOCKED, "Too many failed attempts. Try again later.", 423);
    }
    if (!verifyPassword(input.password, admin!.passwordHash)) {
      const attempts = admin!.failedLoginAttempts + 1;
      await this.prisma.adminUser.update({
        where: { id: admin!.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: attempts >= ADMIN_MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + ADMIN_LOCKOUT_MS) : undefined,
        },
      });
      await fail();
    }

    await this.prisma.adminUser.update({ where: { id: admin!.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });

    const token = newOpaqueToken();
    const refreshToken = newOpaqueToken();
    const expiresAt = new Date(Date.now() + ADMIN_PENDING_TTL_MS);
    await this.prisma.adminSession.create({
      data: {
        adminUserId: admin!.id,
        tokenHash: hashSessionToken(token),
        refreshTokenHash: hashSessionToken(refreshToken),
        expiresAt,
        refreshExpiresAt: expiresAt,
      },
    });

    return {
      session: { token, refreshToken, expiresAt, adminUserId: admin!.id, mfaVerified: false },
      mfaEnrolled: admin!.mfaEnrolledAt !== null,
    };
  }

  /** Generates (or regenerates) a not-yet-confirmed TOTP secret for the pending session's admin. */
  async startMfaEnrollment(adminUserId: string, email: string): Promise<{ secretBase32: string; otpauthUri: string }> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    if (admin.mfaEnrolledAt) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "MFA is already enrolled for this account", 400);
    }
    const secretBase32 = generateTotpSecret();
    await this.prisma.adminUser.update({ where: { id: adminUserId }, data: { mfaSecretCiphertext: encryptField(secretBase32) } });
    return { secretBase32, otpauthUri: totpUri(secretBase32, email) };
  }

  /** Confirms enrollment (first-ever TOTP verification) and upgrades the pending session to a full one. */
  async confirmMfaEnrollment(adminUserId: string, sessionId: string, code: string, correlationId?: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    if (admin.mfaEnrolledAt) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "MFA is already enrolled for this account", 400);
    }
    if (!admin.mfaSecretCiphertext || !verifyTotpCode(decryptField(admin.mfaSecretCiphertext), code)) {
      await this.recordMfaFailure(adminUserId, correlationId);
      throw new ApiProblem(ERROR_CODES.MFA_INVALID, "That code is not correct", 401);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: adminUserId }, data: { mfaEnrolledAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
      await this.upgradeSession(tx, sessionId);
      await writeAudit(tx, { action: "admin.mfa_enrolled", actorUserId: adminUserId, actorType: "admin", correlationId });
      await writeAudit(tx, { action: "admin.login_succeeded", actorUserId: adminUserId, actorType: "admin", correlationId });
    });
  }

  /** Verifies a TOTP code for an already-enrolled admin and upgrades the pending session. */
  async verifyMfa(adminUserId: string, sessionId: string, code: string, correlationId?: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new ApiProblem(ERROR_CODES.ADMIN_LOCKED, "Too many failed attempts. Try again later.", 423);
    }
    if (!admin.mfaSecretCiphertext || !verifyTotpCode(decryptField(admin.mfaSecretCiphertext), code)) {
      await this.recordMfaFailure(adminUserId, correlationId);
      throw new ApiProblem(ERROR_CODES.MFA_INVALID, "That code is not correct", 401);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: adminUserId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
      await this.upgradeSession(tx, sessionId);
      await writeAudit(tx, { action: "admin.login_succeeded", actorUserId: adminUserId, actorType: "admin", correlationId });
    });
  }

  private async recordMfaFailure(adminUserId: string, correlationId?: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    const attempts = admin.failedLoginAttempts + 1;
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= ADMIN_MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + ADMIN_LOCKOUT_MS) : undefined,
      },
    });
    await writeAudit(this.prisma, { action: "admin.login_failed", actorUserId: adminUserId, actorType: "admin", correlationId, context: { reason: "mfa_invalid" } });
  }

  private async upgradeSession(tx: PrismaClient | Prisma.TransactionClient, sessionId: string): Promise<void> {
    await tx.adminSession.update({
      where: { id: sessionId },
      data: {
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS),
        refreshExpiresAt: new Date(Date.now() + ADMIN_REFRESH_TTL_MS),
      },
    });
  }

  async refresh(refreshToken: string, correlationId?: string): Promise<IssuedAdminSession> {
    const session = await this.prisma.adminSession.findUnique({ where: { refreshTokenHash: hashSessionToken(refreshToken) } });
    if (!session || session.revokedAt || session.refreshExpiresAt < new Date()) {
      throw new ApiProblem(ERROR_CODES.SESSION_REVOKED, "Session expired. Sign in again.", 401);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: "rotated" } });
      const token = newOpaqueToken();
      const newRefresh = newOpaqueToken();
      const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
      await tx.adminSession.create({
        data: {
          adminUserId: session.adminUserId,
          tokenHash: hashSessionToken(token),
          refreshTokenHash: hashSessionToken(newRefresh),
          mfaVerifiedAt: session.mfaVerifiedAt ? new Date() : null,
          expiresAt,
          refreshExpiresAt: new Date(Date.now() + ADMIN_REFRESH_TTL_MS),
        },
      });
      await writeAudit(tx, { action: "auth.session_refreshed", actorUserId: session.adminUserId, actorType: "admin", correlationId });
      return { token, refreshToken: newRefresh, expiresAt, adminUserId: session.adminUserId, mfaVerified: !!session.mfaVerifiedAt };
    });
  }

  async revokeSession(adminUserId: string, sessionId: string, reason: string, correlationId?: string): Promise<void> {
    const session = await this.prisma.adminSession.findFirst({ where: { id: sessionId, adminUserId } });
    if (!session) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Session not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: reason } });
      await writeAudit(tx, { action: "admin.session_revoked", actorUserId: adminUserId, actorType: "admin", correlationId, context: { reason } });
    });
  }

  async listSessions(adminUserId: string) {
    const sessions = await this.prisma.adminSession.findMany({
      where: { adminUserId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return sessions.map((s) => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt }));
  }

  async me(adminUserId: string): Promise<{ adminUserId: string; email: string; duties: AdminDuty[] }> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    return { adminUserId: admin.id, email: admin.email, duties: admin.duties as AdminDuty[] };
  }
}
