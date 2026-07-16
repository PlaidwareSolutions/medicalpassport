import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule, logger } from "./app.module";
import { env } from "./common/env";

async function bootstrap(): Promise<void> {
  const config = env(); // fail fast on invalid environment
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false, // pino handles logging
  });

  app.use(cookieParser());
  app.set("trust proxy", true); // CF-Connecting-IP / X-Forwarded-For via Cloudflare
  app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
  app.enableShutdownHooks();

  if (config.CORS_ORIGINS) {
    app.enableCors({
      origin: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
      credentials: true,
    });
  }

  // Host-header defense (docs/26): reject unexpected hosts when configured.
  if (config.ALLOWED_HOSTS) {
    const allowed = new Set(config.ALLOWED_HOSTS.split(",").map((h) => h.trim()));
    app.use((req: { headers: { host?: string } }, res: { status: (n: number) => { end: () => void } }, next: () => void) => {
      const host = req.headers.host?.split(":")[0];
      if (host && !allowed.has(host)) {
        res.status(421).end();
        return;
      }
      next();
    });
  }

  await app.listen(config.PORT);
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "api listening");
}

void bootstrap();
