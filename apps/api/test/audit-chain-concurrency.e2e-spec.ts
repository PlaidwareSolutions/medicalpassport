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

  it("acknowledging a known historical break resumes verification from it, and still catches a genuinely new one beyond it", async () => {
    // A hash chain break can't be repaired retroactively — this crafts the
    // same shape production actually hit (a row whose prevHash doesn't
    // match its true predecessor's rowHash) to test that the acknowledged
    // seq is accepted while verification still catches anything else wrong.
    async function appendRow(prevHash: string | null): Promise<{ seq: bigint; rowHash: string }> {
      const rowHash = `test-hash-${Math.random().toString(36).slice(2)}`;
      const row = await prisma.auditEvent.create({
        data: { action: "caregiver.access_used", actorType: "caregiver", prevHash, rowHash },
        select: { seq: true, rowHash: true },
      });
      return row;
    }

    const before = await prisma.auditEvent.findFirst({ orderBy: { seq: "desc" }, select: { rowHash: true } });
    const wrongPrevHash = "not-the-real-predecessor-hash";
    const brokenRow = await appendRow(wrongPrevHash);
    expect(before?.rowHash).not.toBe(wrongPrevHash);

    // Unacknowledged: still flagged, exactly as production's cron caught it.
    expect(await verifyAuditChain(prisma)).toBe(brokenRow.seq);

    // Acknowledged: verification resumes from this row's own rowHash and reports intact.
    expect(await verifyAuditChain(prisma, undefined, brokenRow.seq)).toBeNull();

    // A second, later break must still fail loudly even with the first one acknowledged.
    const secondBrokenRow = await appendRow("also-not-the-real-predecessor-hash");
    expect(await verifyAuditChain(prisma, undefined, brokenRow.seq)).toBe(secondBrokenRow.seq);
  });
});
