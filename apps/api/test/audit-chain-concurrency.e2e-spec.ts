import { writeAudit, verifyAuditChain } from "@medpass/audit";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Reproduces a real production incident: several concurrent requests each
 * call writeAudit(prisma, ...) with no ambient transaction (mirroring
 * profile-access.service.ts's caregiver.access_used write on every
 * delegated-access check). Before the advisory-lock fix, each concurrent
 * call could read the same "current tail" before any committed, chaining
 * multiple new rows to the same predecessor and permanently breaking the
 * hash chain — exactly what verify-audit-chain caught in medpass-prod.
 */
describe("Audit chain concurrency e2e", () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE audit_events CASCADE`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stays intact when many concurrent callers write via the plain client with no shared transaction", async () => {
    const CONCURRENCY = 20;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        writeAudit(prisma, {
          action: "caregiver.access_used",
          actorType: "caregiver",
          correlationId: `audit-chain-concurrency-e2e-${i}`,
        }),
      ),
    );

    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" }, select: { rowHash: true } });
    expect(rows.length).toBe(CONCURRENCY);
    expect(new Set(rows.map((r) => r.rowHash)).size).toBe(CONCURRENCY);

    const brokenAt = await verifyAuditChain(prisma);
    expect(brokenAt).toBeNull();
  });

  it("stays intact when concurrent callers are each inside their own ambient transaction", async () => {
    const CONCURRENCY = 20;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        prisma.$transaction((tx) =>
          writeAudit(tx, {
            action: "medication.list_viewed",
            actorType: "caregiver",
            correlationId: `audit-chain-concurrency-tx-e2e-${i}`,
          }),
        ),
      ),
    );

    const brokenAt = await verifyAuditChain(prisma);
    expect(brokenAt).toBeNull();
  });

  it("acknowledging a boundary resumes verification past every break at or before it, and still catches a genuinely new one after", async () => {
    // Reproduces the exact real production shape: a scattered range of
    // breaks across many separate concurrency incidents (medpass-prod had
    // 210 of them across a day and a half, ending abruptly the moment the
    // race was fixed) — not one isolated incident. A boundary seq, not an
    // enumerated set, is what actually scales for that shape.
    async function appendRow(prevHash: string | null): Promise<{ seq: bigint; rowHash: string }> {
      const rowHash = `test-hash-${Math.random().toString(36).slice(2)}`;
      const row = await prisma.auditEvent.create({
        data: { action: "caregiver.access_used", actorType: "caregiver", prevHash, rowHash },
        select: { seq: true, rowHash: true },
      });
      return row;
    }

    const before = await prisma.auditEvent.findFirst({ orderBy: { seq: "desc" }, select: { rowHash: true } });
    const staleHash = before!.rowHash;
    // One writer commits first and is genuinely correct (its predecessor
    // really is the pre-incident tail). Three more writers had all *also*
    // read that same stale tail before any of the four committed, so each
    // incorrectly points to it too instead of chaining to the row actually
    // before them.
    await appendRow(staleHash);
    const brokenRow1 = await appendRow(staleHash);
    const brokenRow2 = await appendRow(staleHash);
    const brokenRow3 = await appendRow(staleHash);
    // A second, separate incident later in the same historical window —
    // same shape, different cause, still before the acknowledged boundary.
    // The anchor is genuinely correct (really does reference brokenRow3);
    // the two broken rows skip past it, each also referencing brokenRow3
    // instead of the row actually before them.
    await appendRow(brokenRow3.rowHash);
    const brokenRow4 = await appendRow(brokenRow3.rowHash);
    const brokenRow5 = await appendRow(brokenRow3.rowHash);

    // Unacknowledged: the first broken link is flagged, exactly as production's cron caught it.
    expect(await verifyAuditChain(prisma)).toBe(brokenRow1.seq);

    // A boundary that only covers the first incident still correctly flags the second one.
    expect(await verifyAuditChain(prisma, undefined, brokenRow3.seq)).toBe(brokenRow4.seq);

    // A boundary covering both historical incidents reports intact.
    expect(await verifyAuditChain(prisma, undefined, brokenRow5.seq)).toBeNull();

    // A later break from a genuinely new, separate cause must still fail loudly even with the boundary set past both historical incidents.
    const newBrokenRow = await appendRow("a-completely-unrelated-bad-hash");
    expect(await verifyAuditChain(prisma, undefined, brokenRow5.seq)).toBe(newBrokenRow.seq);
  });
});
