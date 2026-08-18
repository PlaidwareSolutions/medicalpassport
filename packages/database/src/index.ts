import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

let client: PrismaClient | undefined;

/**
 * Every audit write serializes on one advisory lock (@medpass/audit), so
 * during slow-DB moments a queue forms and the 5 s interactive-transaction
 * default expired inside writeAudit's transaction, 500ing otherwise-healthy
 * requests (seen on medpass-prod 2026-08-09). Wider bounds absorb those
 * spikes; moving audit writes off read paths is the deferred structural fix.
 * Used by getPrisma() below and by the api's PrismaService, which constructs
 * its own client — keep both on these shared options.
 */
export const prismaTransactionOptions = { maxWait: 10_000, timeout: 15_000 } as const;

/** Shared PrismaClient. Pool sizing is controlled via DATABASE_URL params. */
export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ transactionOptions: prismaTransactionOptions });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
