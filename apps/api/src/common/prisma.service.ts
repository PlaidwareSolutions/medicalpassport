import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { flushAuditQueue } from "@medpass/audit";
import { PrismaClient, prismaTransactionOptions } from "@medpass/database";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ transactionOptions: prismaTransactionOptions });
  }

  async onModuleDestroy(): Promise<void> {
    // Deferred read-path audit rows (ticket 0.18) must reach the chain
    // before the pool closes. A failure here is already logged by the queue.
    try {
      await flushAuditQueue();
    } catch {
      /* logged by the audit queue */
    }
    await this.$disconnect();
  }
}
