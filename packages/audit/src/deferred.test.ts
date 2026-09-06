import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@medpass/database";
import { auditQueueDepth, configureAuditQueue, flushAuditQueue, writeAuditDeferred } from "./deferred";
import type { AuditEntry, AuditQueueLogger } from "./index";

/**
 * The deferred queue against an in-memory stand-in for the audit table:
 * batching, arrival order, the chain links inside a batch, the overflow
 * fallback, and retry. The real chain (Postgres, advisory lock,
 * `verifyAuditChain`) is exercised by apps/api/test/audit-deferred.e2e-spec.ts.
 */

interface Row {
  action: string;
  correlationId?: string;
  prevHash: string | null;
  rowHash: string;
}

interface Fake {
  client: PrismaClient;
  rows: Row[];
  /** Transactions opened (one per batch, one per synchronous write). */
  transactions: number;
  /** Advisory-lock acquisitions — one per transaction. */
  locks: number;
}

function fakeClient(opts: { failTransactions?: number } = {}): Fake {
  const rows: Row[] = [];
  let failuresLeft = opts.failTransactions ?? 0;
  const fake: Fake = { rows, transactions: 0, locks: 0, client: undefined as unknown as PrismaClient };
  const tx = {
    $executeRaw: async () => {
      fake.locks += 1;
      return 1;
    },
    auditEvent: {
      findFirst: async () => (rows.length > 0 ? { rowHash: rows[rows.length - 1]!.rowHash } : null),
      create: async ({ data }: { data: Row }) => {
        rows.push({ action: data.action, correlationId: data.correlationId, prevHash: data.prevHash, rowHash: data.rowHash });
        return data;
      },
    },
  };
  fake.client = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      fake.transactions += 1;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("database unavailable");
      }
      return fn(tx);
    },
  } as unknown as PrismaClient;
  return fake;
}

function entry(i: number): AuditEntry {
  return { action: "medication.list_viewed", actorType: "caregiver", correlationId: `c-${i}` };
}

function expectLinked(rows: Row[]): void {
  let prev: string | null = null;
  for (const row of rows) {
    expect(row.prevHash).toBe(prev);
    prev = row.rowHash;
  }
}

function logger(): AuditQueueLogger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("writeAuditDeferred", () => {
  let log: ReturnType<typeof logger>;

  beforeEach(() => {
    log = logger();
    configureAuditQueue({ flushIntervalMs: 10_000, maxBatch: 100, maxQueue: 1000, logger: log });
  });

  afterEach(async () => {
    await flushAuditQueue();
    expect(auditQueueDepth()).toBe(0);
  });

  it("writes entries in arrival order, chained to each other, one lock per batch", async () => {
    const fake = fakeClient();
    configureAuditQueue({ maxBatch: 3 });
    for (let i = 0; i < 7; i++) await writeAuditDeferred(fake.client, entry(i));
    expect(auditQueueDepth()).toBe(7);
    expect(fake.rows).toHaveLength(0);

    await flushAuditQueue();

    expect(fake.rows.map((r) => r.correlationId)).toEqual(["c-0", "c-1", "c-2", "c-3", "c-4", "c-5", "c-6"]);
    expectLinked(fake.rows);
    // 3 + 3 + 1: three batches, three transactions, three lock acquisitions.
    expect(fake.transactions).toBe(3);
    expect(fake.locks).toBe(3);
    expect(log.info.mock.calls.map((c) => (c[0] as { batch: number }).batch)).toEqual([3, 3, 1]);
  });

  it("flushes on the interval without anyone calling flush", async () => {
    const fake = fakeClient();
    configureAuditQueue({ flushIntervalMs: 10 });
    await writeAuditDeferred(fake.client, entry(0));
    await writeAuditDeferred(fake.client, entry(1));
    expect(fake.rows).toHaveLength(0);
    await sleep(60);
    expect(fake.rows.map((r) => r.correlationId)).toEqual(["c-0", "c-1"]);
    expect(fake.transactions).toBe(1);
  });

  it("flushes immediately once maxBatch entries are waiting, long before the interval", async () => {
    const fake = fakeClient();
    configureAuditQueue({ flushIntervalMs: 10_000, maxBatch: 4 });
    for (let i = 0; i < 4; i++) await writeAuditDeferred(fake.client, entry(i));
    await sleep(20);
    expect(fake.rows).toHaveLength(4);
    expect(fake.transactions).toBe(1);
  });

  it("falls back to a synchronous write when the queue is full — nothing is dropped", async () => {
    const fake = fakeClient();
    configureAuditQueue({ maxQueue: 2, flushIntervalMs: 10_000 });

    await writeAuditDeferred(fake.client, entry(0));
    await writeAuditDeferred(fake.client, entry(1));
    expect(auditQueueDepth()).toBe(2);
    // The third entry finds the queue full: the caller writes it itself, in
    // its own transaction, before the (now kicked) writer gets a turn.
    await writeAuditDeferred(fake.client, entry(2));
    expect(fake.rows.map((r) => r.correlationId)).toEqual(["c-2"]);
    expect(auditQueueDepth()).toBe(2);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ depth: 2, maxQueue: 2 }), expect.stringContaining("queue full"));

    await flushAuditQueue();
    expect(fake.rows.map((r) => r.correlationId)).toEqual(["c-2", "c-0", "c-1"]);
    expectLinked(fake.rows);
    expect(auditQueueDepth()).toBe(0);
  });

  it("retries a failed batch, one entry at a time, and keeps the order", async () => {
    const fake = fakeClient({ failTransactions: 1 });
    for (let i = 0; i < 3; i++) await writeAuditDeferred(fake.client, entry(i));

    await flushAuditQueue();

    expect(fake.rows.map((r) => r.correlationId)).toEqual(["c-0", "c-1", "c-2"]);
    expectLinked(fake.rows);
    // One failed batch transaction, then three single-entry retries.
    expect(fake.transactions).toBe(4);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ batch: 3, attempts: 1 });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("gives up on an entry only after five failed attempts, loudly", async () => {
    const fake = fakeClient({ failTransactions: 100 });
    await writeAuditDeferred(fake.client, entry(0));

    await expect(flushAuditQueue()).rejects.toThrow(/flush failed/);

    expect(fake.rows).toHaveLength(0);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]![0]).toMatchObject({ attempts: 5, entry: expect.objectContaining({ correlationId: "c-0" }) });
    expect(auditQueueDepth()).toBe(0);
  });

  it("keeps batches to a single client", async () => {
    const a = fakeClient();
    const b = fakeClient();
    await writeAuditDeferred(a.client, entry(0));
    await writeAuditDeferred(a.client, entry(1));
    await writeAuditDeferred(b.client, entry(2));
    await writeAuditDeferred(a.client, entry(3));

    await flushAuditQueue();

    expect(a.rows.map((r) => r.correlationId)).toEqual(["c-0", "c-1", "c-3"]);
    expect(b.rows.map((r) => r.correlationId)).toEqual(["c-2"]);
    expect(a.transactions).toBe(2);
    expect(b.transactions).toBe(1);
  });
});
