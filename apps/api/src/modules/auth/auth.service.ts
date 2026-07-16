import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { OtpSender } from "@medpass/notifications";
import type { OtpRequestInput, OtpVerifyInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import {
  encryptField,
  generateOtpCode,
  hashOtp,
  hashSessionToken,
  newOpaqueToken,
  phoneDigest,
  sha256Hex,
  verifyOtp,
} from "../../common/crypto";

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_HOUR = 5;
const OTP_RESEND_COOLDOWN_MS = 30_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

export interface IssuedSession {
  token: string;
  refreshToken: string;
  expiresAt: Date;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpSender: OtpSender,
  ) {}

  /**
   * Requests an OTP. Enumeration-safe: the response is identical whether or
   * not the number is registered (docs/14). Limits are enforced server-side.
   */
  async requestOtp(input: OtpRequestInput, ip: string | undefined, correlationId?: string): Promise<void> {
    const digest = phoneDigest(input.phone);
    const hourAgo = new Date(Date.now() - 3_600_000);

    const recent = await this.prisma.otpAttempt.findMany({
      where: { phoneDigest: digest, createdAt: { gt: hourAgo } },
      orderBy: { createdAt: "desc" },
    });

    const totalSends = recent.reduce((n, a) => n + a.sentCount, 0);
    if (totalSends >= OTP_MAX_SENDS_PER_HOUR) {
      throw new ApiProblem(ERROR_CODES.OTP_RESEND_LIMIT, "Too many codes requested. Try again later.", 429);
    }
    const newest = recent[0];
    if (newest && Date.now() - newest.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new ApiProblem(ERROR_CODES.OTP_RESEND_LIMIT, "Please wait before requesting another code", 429);
    }

    const code = generateOtpCode();
    await this.prisma.otpAttempt.create({
      data: {
        phoneDigest: digest,
        otpHash: hashOtp(code),
        purpose: input.purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        ipDigest: ip ? sha256Hex(ip) : null,
      },
    });

    await this.otpSender.sendOtp(input.phone, code, "en");
    await writeAudit(this.prisma, {
      action: "auth.otp_requested",
      actorType: "system",
      correlationId,
      context: { purpose: input.purpose },
    });
  }

  /** Verifies an OTP and issues a session, creating the user on first sign-in. */
  async verifyOtp(input: OtpVerifyInput, correlationId?: string): Promise<IssuedSession> {
    const digest = phoneDigest(input.phone);
    const attempt = await this.prisma.otpAttempt.findFirst({
      where: { phoneDigest: digest, consumedAt: null, invalidatedAt: null, purpose: "login" },
      orderBy: { createdAt: "desc" },
    });

    const fail = async (code: "otp_invalid" | "otp_expired" | "otp_locked", title: string, status: number) => {
      await writeAudit(this.prisma, {
        action: code === "otp_locked" ? "auth.otp_locked" : "auth.otp_failed",
        actorType: "system",
        correlationId,
        context: { reason: code },
      });
      throw new ApiProblem(ERROR_CODES[code.toUpperCase() as "OTP_INVALID"], title, status);
    };

    if (!attempt) await fail("otp_invalid", "That code is not correct. Please check and try again.", 400);
    if (attempt!.expiresAt < new Date()) {
      await fail("otp_expired", "That code has expired. Please request a new one.", 400);
    }
    if (attempt!.verifyAttempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      await fail("otp_locked", "Too many attempts. Please request a new code later.", 423);
    }

    await this.prisma.otpAttempt.update({
      where: { id: attempt!.id },
      data: { verifyAttempts: { increment: 1 } },
    });

    if (!verifyOtp(input.code, attempt!.otpHash)) {
      if (attempt!.verifyAttempts + 1 >= OTP_MAX_VERIFY_ATTEMPTS) {
        await this.prisma.otpAttempt.update({
          where: { id: attempt!.id },
          data: { invalidatedAt: new Date() },
        });
      }
      await fail("otp_invalid", "That code is not correct. Please check and try again.", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.otpAttempt.update({ where: { id: attempt!.id }, data: { consumedAt: new Date() } });

      let user = await tx.user.findUnique({ where: { phoneDigest: digest } });
      if (!user) {
        user = await tx.user.create({
          data: {
            phoneDigest: digest,
            phoneCiphertext: encryptField(input.phone),
            phoneVerifiedAt: new Date(),
            preferredLocale: input.locale ?? "en",
          },
        });
      } else if (input.locale && input.locale !== user.preferredLocale) {
        user = await tx.user.update({ where: { id: user.id }, data: { preferredLocale: input.locale } });
      }

      const device = await tx.userDevice.create({
        data: { userId: user.id, kind: input.device.kind, label: input.device.label },
      });

      const token = newOpaqueToken();
      const refreshToken = newOpaqueToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await tx.session.create({
        data: {
          userId: user.id,
          userDeviceId: device.id,
          tokenHash: hashSessionToken(token),
          refreshTokenHash: hashSessionToken(refreshToken),
          expiresAt,
          refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      });

      await writeAudit(tx, {
        action: "auth.otp_verified",
        actorUserId: user.id,
        actorType: "patient",
        correlationId,
      });
      await writeAudit(tx, {
        action: "auth.session_created",
        actorUserId: user.id,
        actorType: "patient",
        correlationId,
        context: { deviceKind: input.device.kind },
      });

      return { token, refreshToken, expiresAt, userId: user.id };
    });
  }

  async refresh(refreshToken: string, correlationId?: string): Promise<IssuedSession> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashSessionToken(refreshToken) },
    });
    if (!session || session.revokedAt || session.refreshExpiresAt < new Date()) {
      throw new ApiProblem(ERROR_CODES.SESSION_REVOKED, "Session expired. Sign in again.", 401);
    }

    // Rotate: revoke the old session, issue a new one on the same device.
    return this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokeReason: "rotated" },
      });
      const token = newOpaqueToken();
      const newRefresh = newOpaqueToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await tx.session.create({
        data: {
          userId: session.userId,
          userDeviceId: session.userDeviceId,
          tokenHash: hashSessionToken(token),
          refreshTokenHash: hashSessionToken(newRefresh),
          expiresAt,
          refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      });
      await writeAudit(tx, {
        action: "auth.session_refreshed",
        actorUserId: session.userId,
        actorType: "patient",
        correlationId,
      });
      return { token, refreshToken: newRefresh, expiresAt, userId: session.userId };
    });
  }

  async revokeSession(userId: string, sessionId: string, reason: string, correlationId?: string): Promise<void> {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Session not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: reason } });
      await writeAudit(tx, {
        action: "auth.session_revoked",
        actorUserId: userId,
        actorType: "patient",
        correlationId,
        context: { reason },
      });
    });
  }

  async listSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { userDevice: true },
      orderBy: { createdAt: "desc" },
    });
    return sessions.map((s) => ({
      id: s.id,
      device: { kind: s.userDevice.kind, label: s.userDevice.label },
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }
}
