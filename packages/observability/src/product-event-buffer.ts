import type { ProductEvent } from "./product-events";

/** One buffered event, stamped when it was emitted (not when it was flushed). */
export interface BufferedProductEvent {
  event: ProductEvent;
  occurredAt: Date;
}

export interface ProductEventBufferOptions {
  /** Persists a batch. Errors are swallowed and counted — never rethrown into a request. */
  sink: (events: BufferedProductEvent[]) => Promise<void>;
  /** Hard cap on buffered events; beyond it the OLDEST are dropped (docs_v2/14 §6: analytics may lose, requests may not stall). */
  maxSize?: number;
  /** Flush as soon as this many are waiting. */
  flushAt?: number;
  /** Otherwise flush this long after the first event of a batch. */
  flushAfterMs?: number;
  /** Clock override for tests. */
  now?: () => Date;
  /** Timer override for tests; the default `setTimeout` is unref'd so the buffer never keeps a process alive. */
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}

export interface ProductEventBufferStats {
  buffered: number;
  flushed: number;
  dropped: number;
  failedBatches: number;
}

function defaultSchedule(fn: () => void, ms: number): { cancel: () => void } {
  const handle = setTimeout(fn, ms);
  if (typeof (handle as { unref?: () => void }).unref === "function") (handle as { unref: () => void }).unref();
  return { cancel: () => clearTimeout(handle) };
}

/**
 * Bounded, fire-and-forget buffer between an emitting request and the
 * analytics sink (docs_v2/06 P1-7). `push()` is synchronous and never
 * throws; writes happen later, off the request's critical path, in one
 * batched sink call. A sink failure drops that batch (counted in
 * `failedBatches`) rather than retrying into an unbounded backlog — product
 * counts are allowed to be lossy; a patient's request is not allowed to
 * wait on them.
 */
export class ProductEventBuffer {
  private readonly queue: BufferedProductEvent[] = [];
  private readonly maxSize: number;
  private readonly flushAt: number;
  private readonly flushAfterMs: number;
  private timer: { cancel: () => void } | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly stats: ProductEventBufferStats = { buffered: 0, flushed: 0, dropped: 0, failedBatches: 0 };

  constructor(private readonly options: ProductEventBufferOptions) {
    this.maxSize = options.maxSize ?? 1000;
    this.flushAt = options.flushAt ?? 50;
    this.flushAfterMs = options.flushAfterMs ?? 2000;
  }

  push(event: ProductEvent): void {
    const now = this.options.now?.() ?? new Date();
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
      this.stats.dropped += 1;
    }
    this.queue.push({ event, occurredAt: now });
    this.stats.buffered = this.queue.length;
    if (this.queue.length >= this.flushAt) {
      void this.flush();
      return;
    }
    this.timer ??= (this.options.schedule ?? defaultSchedule)(() => {
      this.timer = undefined;
      void this.flush();
    }, this.flushAfterMs);
  }

  /** Drains everything currently waiting. Safe to await from a test or a shutdown hook. */
  async flush(): Promise<void> {
    if (this.timer) {
      this.timer.cancel();
      this.timer = undefined;
    }
    // Serialise sink calls so batches land in emission order.
    if (this.inFlight) await this.inFlight;
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.stats.buffered = 0;
    this.inFlight = this.options
      .sink(batch)
      .then(() => {
        this.stats.flushed += batch.length;
      })
      .catch(() => {
        this.stats.failedBatches += 1;
        this.stats.dropped += batch.length;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    await this.inFlight;
  }

  snapshot(): ProductEventBufferStats {
    return { ...this.stats, buffered: this.queue.length };
  }
}
