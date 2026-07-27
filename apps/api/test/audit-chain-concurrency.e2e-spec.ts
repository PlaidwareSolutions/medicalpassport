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

  it("acknowledging known historical breaks resumes verification past each of them, and still catches a genuinely new one beyond", async () => {
    // Reproduces the exact real production shape: one concurrency incident
    // misdirected THREE consecutive rows (all read the same stale tail
    // before any of them committed), not just one — acknowledging only the
    // first of them must still correctly flag the next unacknowledged one.
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
    // really is the pre-incident tail) — matching medpass-prod's real seq
    // 96. Three more writers had all *also* read that same stale tail before
    // any of the four committed, so each of them incorrectly points to it
    // too instead of chaining to the row actually before them — matching
    // medpass-prod's real seq 97/98/99 exactly.
    await appendRow(staleHash);
    const brokenRow1 = await appendRow(staleHash);
    const brokenRow2 = await appendRow(staleHash);
    const brokenRow3 = await appendRow(staleHash);

    // Unacknowledged: the first broken link is flagged, exactly as production's cron caught it.
    expect(await verifyAuditChain(prisma)).toBe(brokenRow1.seq);

    // Acknowledging only the first of the three still correctly flags the next one.
    expect(await verifyAuditChain(prisma, undefined, new Set([brokenRow1.seq]))).toBe(brokenRow2.seq);

    // Acknowledging all three from the same incident reports intact.
    expect(
      await verifyAuditChain(prisma, undefined, new Set([brokenRow1.seq, brokenRow2.seq, brokenRow3.seq])),
    ).toBeNull();

    // A fourth, later break from a separate cause must still fail loudly even with the first three acknowledged.
    const newBrokenRow = await appendRow("a-completely-unrelated-bad-hash");
    expect(
      await verifyAuditChain(prisma, undefined, new Set([brokenRow1.seq, brokenRow2.seq, brokenRow3.seq])),
    ).toBe(newBrokenRow.seq);
  });
});
