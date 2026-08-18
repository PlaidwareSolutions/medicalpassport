import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, prismaTransactionOptions } from "@medpass/database";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ transactionOptions: prismaTransactionOptions });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
