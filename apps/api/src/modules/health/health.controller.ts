import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/auth.guard";
import { PrismaService } from "../../common/prisma.service";

/**
 * Liveness and readiness (docs/25). Registered outside the /v1 prefix.
 * Liveness never touches dependencies; readiness probes PostgreSQL.
 */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("healthz")
  healthz() {
    return { status: "ok" };
  }

  @Public()
  @Get("readyz")
  async readyz() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ready", checks: { postgres: "ok" } };
  }
}
