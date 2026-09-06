import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

export interface RateLimitCheck {
  allowed: boolean;
  /** Seconds until the current window resets — only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter, Postgres-backed (docs/14/18/26 — app-level rate
 * limiting must stand alone from Cloudflare; no Redis in this sandbox, see
 * schema.prisma's RateLimitBucket doc comment for the substitution
 * reasoning). `upsert`'s `ON CONFLICT DO UPDATE ... count = count + 1`
 * increments atomically at the database level, so concurrent requests in
 * the same window can never race each other into under-counting.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `by` charges one call for several units at once (a multi-page document
   * upload counts every page against the daily quota, not the request). It
   * defaults to 1, so every existing caller is unchanged.
   */
  async checkAndIncrement(key: string, limit: number, windowSeconds: number, by = 1): Promise<RateLimitCheck> {
    const windowMs = windowSeconds * 1000;
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

    const bucket = await this.prisma.rateLimitBucket.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, count: by },
      update: { count: { increment: by } },
    });

    const allowed = bucket.count <= limit;
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000));
    return { allowed, retryAfterSeconds };
  }
}
