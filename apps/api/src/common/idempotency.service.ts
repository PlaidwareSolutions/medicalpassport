import { Injectable } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import { ApiProblem } from "./errors";
import { PrismaService } from "./prisma.service";
import { sha256Hex } from "./crypto";

/**
 * Exactly-once application of sensitive writes (docs/14): the same
 * Idempotency-Key (or offline clientMutationId) replays the stored result
 * instead of re-executing. Keys are UUIDs supplied by clients.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(opts: {
    key: string | undefined;
    userId: string;
    profileId?: string;
    entity: string;
    operation: string;
    requestDigestSource: unknown;
    execute: () => Promise<T>;
  }): Promise<{ result: T; replayed: boolean }> {
    if (!opts.key) {
      return { result: await opts.execute(), replayed: false };
    }
    if (!/^[0-9a-f-]{36}$/i.test(opts.key)) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Idempotency-Key must be a UUID", 400);
    }

    const digest = sha256Hex(JSON.stringify(opts.requestDigestSource ?? null));
    const existing = await this.prisma.offlineMutation.findUnique({
      where: { clientMutationId: opts.key },
    });
    if (existing) {
      if (existing.userId !== opts.userId || existing.resultDigest !== digest) {
        throw new ApiProblem(
          ERROR_CODES.IDEMPOTENT_REPLAY_MISMATCH,
          "This request key was already used with different content",
          409,
        );
      }
      return { result: existing.resultBody as T, replayed: true };
    }

    const result = await opts.execute();
    await this.prisma.offlineMutation.create({
      data: {
        clientMutationId: opts.key,
        userId: opts.userId,
        patientProfileId: opts.profileId,
        entity: opts.entity,
        operation: opts.operation,
        resultDigest: digest,
        resultBody: result as object,
      },
    });
    return { result, replayed: false };
  }
}
