import type { PrismaClient } from "@medpass/database";
import { writeAudit, writeAuditBatch, type AuditEntry } from "./chain";

/**
 * Deferred audit writes for read paths (docs_v2/19 ticket 0.18; the
 * structural remediation left open by INC-2026-001, docs/30).
 *
 * Every `writeAudit` takes the global chain lock so the hash chain stays
 * linear — one strictly serial append point for the whole API. That is the
 * right invariant for a ledger, but it made every caregiver, provider and
 * admin *read* wait in the same queue as the writes, and under a slow-DB
 * moment the lock wait alone was enough to 500 healthy GETs (docs/22,
 * 2026-08-09). Read-path audit rows carry no business transaction to join,
 * so nothing is lost by writing them a moment later.
 *
 * `writeAuditDeferred` enqueues in process and returns at once. A single
 * writer drains the queue every `flushIntervalMs` (250 ms) or as soon as
 * `maxBatch` (100) entries are waiting, appending the whole batch under ONE
 * acquisition of the chain lock, in arrival order. The queue is bounded:
 * past `maxQueue` entries the caller falls back to the old synchronous
 * write, so the process degrades to pre-0.18 latency rather than growing
 * without limit — an audit row is never dropped to save a request.
 *
 * Write paths keep calling `writeAudit` inside their own transaction: a
 * failed audit write must still fail the mutation it records (docs/21).
 *
 * `flushAuditQueue()` drains everything now — for tests that assert a read
 * audit row, and for graceful shutdown (the API calls it before the Prisma
 * pool closes; see apps/api PrismaService and main.ts).
 */

export interface AuditQueueLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface AuditQueueOptions {
  /** How long an entry may wait before the writer runs (default 250 ms). */
  flushIntervalMs: number;
  /** Entries per chain-lock acquisition; reaching it triggers an immediate flush (default 100). */
  maxBatch: number;
  /** Queue bound; beyond it `writeAuditDeferred` writes synchronously instead (default 1000). */
  maxQueue: number;
  /** Structured log sink (pino-compatible). Silent by default. */
  logger: AuditQueueLogger;
}

/** A batch that keeps failing is retried this many times before an entry is given up on (see `drain`). */
const MAX_ATTEMPTS = 5;
/** Backoff cap between retries of a failing batch. */
const MAX_RETRY_DELAY_MS = 5_000;

const SILENT: AuditQueueLogger = { info: () => {}, warn: () => {}, error: () => {} };

const DEFAULTS: Readonly<AuditQueueOptions> = Object.freeze({
  flushIntervalMs: 250,
  maxBatch: 100,
  maxQueue: 1000,
  logger: SILENT,
});

interface Queued {
  client: PrismaClient;
  entry: AuditEntry;
  attempts: number;
}

let options: AuditQueueOptions = { ...DEFAULTS };
const queue: Queued[] = [];
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<boolean> | null = null;

/** Sets queue parameters and the log sink. Partial: anything omitted keeps its current value. */
export function configureAuditQueue(partial: Partial<AuditQueueOptions>): void {
  options = { ...options, ...partial };
}

/** Entries waiting to be written (diagnostics and tests). */
export function auditQueueDepth(): number {
  return queue.length;
}

/**
 * Queues an audit row for the next batch and returns once it is queued —
 * never once it is written. Use on read paths only; a mutation's audit row
 * belongs in the mutation's own transaction via `writeAudit`.
 *
 * When the queue is full the entry is written synchronously through
 * `writeAudit` instead (its own transaction, its own lock wait), so the
 * caller pays the old latency but the row is never lost.
 */
export async function writeAuditDeferred(client: PrismaClient, entry: AuditEntry): Promise<void> {
  if (queue.length >= options.maxQueue) {
    options.logger.warn({ depth: queue.length, maxQueue: options.maxQueue, action: entry.action }, "audit queue full; writing synchronously");
    scheduleFlush(0);
    await writeAudit(client, entry);
    return;
  }
  queue.push({ client, entry, attempts: 0 });
  scheduleFlush(queue.length >= options.maxBatch ? 0 : options.flushIntervalMs);
}

/**
 * Drains the queue completely, including entries added while draining.
 * Rejects only if a batch keeps failing past its retries (a test then sees
 * the real error; shutdown logs it and carries on closing).
 */
export async function flushAuditQueue(): Promise<void> {
  let rounds = 0;
  while (queue.length > 0 || inFlight) {
    cancelTimer();
    const ok = await runDrain();
    if (!ok && ++rounds >= MAX_ATTEMPTS) {
      throw new Error(`audit queue flush failed after ${rounds} rounds; ${queue.length} entries still queued`);
    }
  }
  cancelTimer();
}

function cancelTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleFlush(delayMs: number): void {
  if (timer) {
    if (delayMs > 0) return; // an earlier, sooner-or-equal timer is already pending
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    void runDrain();
  }, delayMs);
  // Never keep the process alive for a pending flush; shutdown flushes explicitly.
  timer.unref?.();
}

/** One writer at a time; concurrent callers share the in-flight drain. */
function runDrain(): Promise<boolean> {
  if (!inFlight) {
    inFlight = drain().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Writes batches until the queue is empty or a batch fails. Batches are
 * taken from the head in arrival order and only ever span one Prisma
 * client (one API process has one, but a test harness may hold several).
 *
 * A failed batch is put back at the head untouched and retried after a
 * backoff; from the second attempt on, entries are retried one at a time so
 * one bad row cannot hold the rest hostage. An entry that still fails after
 * MAX_ATTEMPTS is logged at error level with its full PHI-free shape and
 * removed — leaving it in place would wedge every later audit row behind
 * it, which is the worse outcome. In practice a row only fails when the
 * database is unreachable, in which case the synchronous fallback fails the
 * same way and the process is already unhealthy.
 */
async function drain(): Promise<boolean> {
  while (queue.length > 0) {
    const batch = takeBatch();
    const client = batch[0]!.client;
    const startedAt = Date.now();
    try {
      await writeAuditBatch(
        client,
        batch.map((q) => q.entry),
      );
      options.logger.info({ batch: batch.length, depth: queue.length, ms: Date.now() - startedAt }, "audit batch written");
    } catch (err) {
      const retry: Queued[] = [];
      for (const q of batch) {
        q.attempts += 1;
        if (q.attempts >= MAX_ATTEMPTS) {
          options.logger.error({ err, attempts: q.attempts, entry: q.entry }, "audit entry abandoned after repeated write failures");
        } else {
          retry.push(q);
        }
      }
      queue.unshift(...retry);
      const attempts = Math.max(...batch.map((q) => q.attempts));
      const delay = Math.min(options.flushIntervalMs * 2 ** attempts, MAX_RETRY_DELAY_MS);
      options.logger.warn({ err, batch: batch.length, attempts, retryInMs: delay, depth: queue.length }, "audit batch failed; will retry");
      if (queue.length > 0) scheduleFlush(delay);
      return false;
    }
  }
  return true;
}

function takeBatch(): Queued[] {
  const head = queue[0]!;
  // A retried entry goes alone so a single poisoned row is isolated.
  if (head.attempts > 0) return queue.splice(0, 1);
  let n = 1;
  while (n < queue.length && n < options.maxBatch && queue[n]!.client === head.client && queue[n]!.attempts === 0) n += 1;
  return queue.splice(0, n);
}
