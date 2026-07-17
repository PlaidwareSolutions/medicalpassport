/**
 * Cron job harness (docs/25): every job is a finite process — start, do the
 * work idempotently, record the run, exit. Never a long-running consumer.
 */
import { cronEnvShape, loadEnv, type CronEnv } from "@medpass/config";
import { getPrisma } from "@medpass/database";
import { createLogger, newCorrelationId } from "@medpass/observability";
import type { PrismaClient } from "@medpass/database";

export interface JobContext {
  prisma: PrismaClient;
  correlationId: string;
  log: ReturnType<typeof createLogger>;
  config: CronEnv;
}

export function runJob(name: string, work: (ctx: JobContext) => Promise<Record<string, unknown>>): void {
  const log = createLogger(`cron:${name}`);
  const config = loadEnv(cronEnvShape);
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const started = Date.now();

  work({ prisma, correlationId, log, config })
    .then((summary) => {
      log.info({ correlationId, durationMs: Date.now() - started, ...summary }, "job completed");
      return prisma.$disconnect();
    })
    .catch(async (err: unknown) => {
      log.error(
        { correlationId, durationMs: Date.now() - started, err: err instanceof Error ? err.message : "unknown" },
        "job failed",
      );
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
