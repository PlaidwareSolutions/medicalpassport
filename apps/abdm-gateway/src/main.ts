import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule, logger } from "./app.module";
import { env } from "./env";

/**
 * ABDM gateway service (docs_v2/08 §4, ADR-V2-005): own hostname, own secrets, callbacks + a
 * private `/internal/*` API for apps/api. Nothing else is exposed.
 */
async function bootstrap(): Promise<void> {
  const config = env(); // fail fast on invalid environment
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false, // pino handles logging
    rawBody: true, // callback bodies are digested exactly as received
  });
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  logger.info({ port: config.PORT, env: config.NODE_ENV, gatewayEnv: config.ABDM_GATEWAY_ENV, mock: config.MOCK }, "abdm-gateway listening");
}

void bootstrap();
