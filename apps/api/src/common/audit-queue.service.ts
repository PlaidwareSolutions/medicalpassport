import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { configureAuditQueue, flushAuditQueue } from "@medpass/audit";
import type { Logger } from "@medpass/observability";

/**
 * Wires the deferred audit queue (`@medpass/audit`, ticket 0.18) into the
 * Nest lifecycle: batch sizes and failures go to the api's pino logger, and
 * `app.close()` — which `enableShutdownHooks()` in main.ts runs on
 * SIGTERM/SIGINT — drains whatever is still queued. PrismaService flushes
 * once more right before it disconnects, so the order Nest happens to call
 * destroy hooks in cannot lose a row.
 */
@Injectable()
export class AuditQueueService implements OnModuleDestroy {
  constructor(logger: Logger) {
    configureAuditQueue({
      logger: {
        info: (obj, msg) => logger.info({ audit_queue: obj }, msg),
        warn: (obj, msg) => logger.warn({ audit_queue: obj }, msg),
        error: (obj, msg) => logger.error({ audit_queue: obj }, msg),
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await flushAuditQueue();
  }
}
