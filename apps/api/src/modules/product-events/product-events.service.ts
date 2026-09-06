import { createHmac } from "node:crypto";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  createLogger,
  ProductEventBuffer,
  validateProductEvent,
  type BufferedProductEvent,
  type ProductEvent,
} from "@medpass/observability";
import type { Prisma } from "@medpass/database";
import { env } from "../../common/env";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";

const log = createLogger("api.product-events");

/** A catalogue event plus the two PHI-free dimensions the API adds from the request. */
export interface ApiProductEvent extends ProductEvent {
  /** The patient's UI locale (an enum, not free text). */
  locale?: string;
  /** `x-client` channel (`pwa`, `native_android`, …); absent means the PWA. */
  clientKind?: string;
}

let active: ProductEventsService | undefined;

/** The one Nest-managed instance registers itself here so module-level `emitProductEvent` can reach it. */
function registerActive(service: ProductEventsService): void {
  active = service;
}

/**
 * Emit a product event from anywhere in the API without a constructor
 * change (docs_v2/06 P1-7). Synchronous, never throws, never awaits a
 * write: the registered `ProductEventsService` validates against the
 * catalogue and buffers; the row lands later in a batched insert. Returns
 * whether the event was accepted — false when the catalogue refused it, or
 * when no service is registered (a unit test booting a bare service).
 */
export function emitProductEvent(event: ApiProductEvent): boolean {
  return active?.emit(event) ?? false;
}

/** The request-derived dimensions every emission site attaches the same way. */
export function productEventContext(req: ApiRequest): Pick<ApiProductEvent, "userId" | "correlationId" | "locale" | "clientKind"> {
  const client = req.header("x-client");
  return {
    userId: req.auth?.userId,
    correlationId: req.correlationId,
    locale: req.auth?.preferredLocale,
    clientKind: client && client !== "" ? client : "pwa",
  };
}

/**
 * Derives the digest pepper. A dedicated PRODUCT_EVENT_PEPPER wins; otherwise
 * a key is derived from SESSION_TOKEN_PEPPER under a domain separator so the
 * analytics digests never equal any other hash of the same id in the system.
 */
function digestPepper(): string {
  const e = env();
  if (e.PRODUCT_EVENT_PEPPER) return e.PRODUCT_EVENT_PEPPER;
  return createHmac("sha256", e.SESSION_TOKEN_PEPPER).update("product-events:v1").digest("hex");
}

/**
 * Sink for product events (docs_v2/14 §6, PHI-free): validates against the
 * closed catalogue, hashes the ids with a pepper, and writes rows in
 * batches from a bounded in-process buffer — off the request's critical
 * path, and lossy under pressure rather than blocking. There is deliberately
 * no way to read a row back by profile: the digest is one-way.
 */
@Injectable()
export class ProductEventsService implements OnModuleDestroy {
  private readonly buffer: ProductEventBuffer;
  private readonly pepper = digestPepper();
  private rejected = 0;

  constructor(private readonly prisma: PrismaService) {
    this.buffer = new ProductEventBuffer({ sink: (batch) => this.persist(batch), maxSize: 2000, flushAt: 50, flushAfterMs: 2000 });
    registerActive(this);
  }

  /** Validate and buffer. Never throws — a bad emission is a logged bug, not a failed request. */
  emit(event: ApiProductEvent): boolean {
    try {
      validateProductEvent(event);
    } catch (err) {
      this.rejected += 1;
      // The offending key name is logged (it is a code identifier, never a value) so the call site can be fixed.
      log.warn({ productEvent: event.name, reason: err instanceof Error ? err.message : String(err) }, "product event rejected");
      return false;
    }
    this.buffer.push(event);
    return true;
  }

  /** One-way, peppered: the same id always yields the same digest, and nothing yields the id. */
  digest(id: string): string {
    return createHmac("sha256", this.pepper).update(id).digest("hex");
  }

  /** Drain now — tests and the shutdown hook. */
  flush(): Promise<void> {
    return this.buffer.flush();
  }

  stats() {
    return { ...this.buffer.snapshot(), rejected: this.rejected };
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private async persist(batch: BufferedProductEvent[]): Promise<void> {
    const data: Prisma.ProductEventCreateManyInput[] = batch.map(({ event, occurredAt }) => {
      const e = event as ApiProductEvent;
      return {
        name: e.name,
        occurredAt,
        profileDigest: e.profileId ? this.digest(e.profileId) : null,
        userDigest: e.userId ? this.digest(e.userId) : null,
        properties: (e.properties ?? {}) as Prisma.InputJsonObject,
        locale: e.locale ?? null,
        clientKind: e.clientKind ?? null,
      };
    });
    await this.prisma.productEvent.createMany({ data });
  }
}
