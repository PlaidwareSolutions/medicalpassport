import { join } from "node:path";
import { Module } from "@nestjs/common";
import { createLogger } from "@medpass/observability";
import { CallbacksController, GATEWAY_ENV, GATEWAY_JWT_VERIFIER } from "./callbacks.controller";
import { env } from "./env";
import { INTERNAL_TOKEN } from "./internal.guard";
import { InternalController, MOCK_GATEWAY } from "./internal.controller";
import { Hs256Verifier, verifierFromConfig, type GatewayJwtVerifier } from "./jwt";
import { MockGatewayService, loadFixtures } from "./mock";
import { PrismaTransactionStore, TRANSACTION_STORE, type GatewayEnv, type TransactionStore } from "./transactions";

export const logger = createLogger("abdm-gateway");

/** Fixtures live next to the app so the Docker image and the repo layout agree. */
export const FIXTURES_DIR = join(__dirname, "..", "fixtures");

/** Shared secret the mock signs its own callback JWTs with when none is configured (never in production: env() refuses MOCK there). */
export const MOCK_JWT_SECRET = "mock-abdm-gateway-jwt-secret-not-secret";

/**
 * Minimal module (docs_v2/08 §4, ADR-V2-005): callbacks + `/internal/*`, nothing else. The
 * providers are built from the validated environment once; specs assemble their own module with
 * in-memory replacements (see *.spec.ts).
 */
@Module({
  controllers: [CallbacksController, InternalController],
  providers: [
    { provide: TRANSACTION_STORE, useFactory: (): TransactionStore => new PrismaTransactionStore() },
    { provide: GATEWAY_ENV, useFactory: (): GatewayEnv => env().ABDM_GATEWAY_ENV },
    {
      provide: GATEWAY_JWT_VERIFIER,
      useFactory: (): GatewayJwtVerifier => {
        const e = env();
        if (e.ABDM_GATEWAY_JWT_HS256_SECRET || e.ABDM_GATEWAY_JWT_RS256_PUBLIC_KEY) {
          return verifierFromConfig({ hs256Secret: e.ABDM_GATEWAY_JWT_HS256_SECRET, rs256PublicKeyPem: e.ABDM_GATEWAY_JWT_RS256_PUBLIC_KEY, issuer: e.ABDM_GATEWAY_JWT_ISSUER, audience: e.ABDM_GATEWAY_JWT_AUDIENCE });
        }
        return new Hs256Verifier(MOCK_JWT_SECRET);
      },
    },
    { provide: MOCK_GATEWAY, useFactory: (): MockGatewayService | null => (env().MOCK ? new MockGatewayService(loadFixtures(FIXTURES_DIR)) : null) },
    { provide: INTERNAL_TOKEN, useFactory: (): string => env().ABDM_INTERNAL_TOKEN },
  ],
})
export class AppModule {}
