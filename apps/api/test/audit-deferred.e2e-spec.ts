import { auditQueueDepth, configureAuditQueue, flushAuditQueue, verifyAuditChain, writeAudit, writeAuditDeferred } from "@medpass/audit";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Ticket 0.18 against the real chain: deferred read-audit rows land in
 * arrival order, in batches under one lock each, interleaved with
 * synchronous writes from other callers — and `verifyAuditChain` still
 * reports the chain intact afterwards. The queue mechanics themselves
 * (timers, retry, overflow bookkeeping) are unit-tested in
 * packages/audit/src/deferred.test.ts.
 */
describe("Deferred audit writes e2e", () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE audit_events CASCADE`);
  });

  afterAll(async () => {
    await flushAuditQueue();
    configureAuditQueue({ flushIntervalMs: 250, maxBatch: 100, maxQueue: 1000 });
    await prisma.$disconnect();
  });

  it("a mixed sequence of synchronous and deferred writes leaves the chain intact and in order", async () => {
    configureAuditQueue({ flushIntervalMs: 10_000, maxBatch: 100, maxQueue: 1000 });

    // A caregiver page load: several reads queued, one mutation written inline, more reads.
    for (let i = 0; i < 5; i++) {
      await writeAuditDeferred(prisma, { action: "medication.list_viewed", actorType: "caregiver", correlationId: `deferred-${i}` });
    }
    await writeAudit(prisma, { action: "medication.created", actorType: "caregiver", correlationId: "sync-0" });
    for (let i = 5; i < 10; i++) {
      await writeAuditDeferred(prisma, { action: "medication.list_viewed", actorType: "caregiver", correlationId: `deferred-${i}` });
    }
    // Nothing deferred has reached the table yet; the synchronous row has.
    expect(auditQueueDepth()).toBe(10);
    expect(await prisma.auditEvent.count()).toBe(1);

    await flushAuditQueue();

    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" }, select: { correlationId: true, prevHash: true, rowHash: true } });
    expect(rows.map((r) => r.correlationId)).toEqual(["sync-0", ...Array.from({ length: 10 }, (_, i) => `deferred-${i}`)]);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prevHash).toBe(rows[i - 1]!.rowHash);
    expect(await verifyAuditChain(prisma)).toBeNull();
  });

  it("batches of maxBatch entries each chain to one another across batch boundaries", async () => {
    configureAuditQueue({ flushIntervalMs: 10_000, maxBatch: 40 });
    const before = await prisma.auditEvent.count();
    for (let i = 0; i < 100; i++) {
      await writeAuditDeferred(prisma, { action: "provider.snapshot_viewed", actorType: "provider", correlationId: `batch-${i}` });
    }
    await flushAuditQueue();

    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" }, skip: before, select: { correlationId: true } });
    expect(rows.map((r) => r.correlationId)).toEqual(Array.from({ length: 100 }, (_, i) => `batch-${i}`));
    expect(await verifyAuditChain(prisma)).toBeNull();
  });

  it("deferred and synchronous writers racing each other never fork the chain", async () => {
    configureAuditQueue({ flushIntervalMs: 5, maxBatch: 10, maxQueue: 25 });
    // More entries than the queue holds, so some fall back to synchronous
    // writes while the batch writer is mid-flight — the same lock serializes both.
    await Promise.all([
      ...Array.from({ length: 60 }, (_, i) =>
        writeAuditDeferred(prisma, { action: "caregiver.access_used", actorType: "caregiver", correlationId: `race-deferred-${i}` }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        writeAudit(prisma, { action: "dose.recorded", actorType: "patient", correlationId: `race-sync-${i}` }),
      ),
    ]);
    await flushAuditQueue();

    expect(await prisma.auditEvent.count({ where: { correlationId: { startsWith: "race-" } } })).toBe(80);
    expect(await verifyAuditChain(prisma)).toBeNull();
  });
});
