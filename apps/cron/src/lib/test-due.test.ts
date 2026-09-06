import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDaysToDateString, dateStringInTz, zonedTimeToInstant } from "@medpass/domain";
import { getPrisma, type PrismaClient } from "@medpass/database";
import { detectTestDue, latestMatchingResultDate, parseTestDueKey, testDueKey } from "./test-due";

/**
 * `detect-test-due` (docs_v2/05 §12, P17) against a real database: a due
 * schedule queues exactly one `test_due` row and rolls forward (recurring)
 * or becomes `notified` (one-off); a schedule already satisfied by a
 * matching DiagnosticReport queues nothing. Skipped without DATABASE_URL
 * (same convention as the backfill tests).
 */
const IST = "Asia/Kolkata";

describe("test_due keys", () => {
  it("round-trip through the dedupe key the dispatcher parses for the label", () => {
    const id = randomUUID();
    expect(parseTestDueKey(testDueKey(id, "2026-09-06"))).toEqual({ scheduleId: id, dueOn: "2026-09-06" });
    expect(parseTestDueKey("refill_low:x")).toBeNull();
    expect(parseTestDueKey(`test_due:${id}:not-a-date`)).toBeNull();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("detectTestDue", () => {
  let prisma: PrismaClient;
  let profileId: string;
  let userId: string;
  // 09:00 IST today — well inside "today" in the profile's zone.
  const now = zonedTimeToInstant(IST, dateStringInTz(IST, new Date()), "09:00");
  const today = dateStringInTz(IST, now);
  const utcDate = (d: string) => new Date(`${d}T00:00:00Z`);

  async function schedule(data: { analyteKey?: string; diagnosticKind?: string; dueOn: string; recurrenceDays?: number; status?: string }) {
    return prisma.testDueSchedule.create({
      data: {
        patientProfileId: profileId,
        analyteKey: data.analyteKey ?? null,
        diagnosticKind: data.diagnosticKind ?? null,
        label: `Fixture ${data.analyteKey ?? data.diagnosticKind}`,
        dueOn: utcDate(data.dueOn),
        recurrenceDays: data.recurrenceDays ?? null,
        status: data.status ?? "pending",
      },
    });
  }

  beforeAll(async () => {
    prisma = getPrisma();
    const user = await prisma.user.create({ data: { phoneDigest: `tdd-${randomUUID()}`, phoneCiphertext: "not-a-real-ciphertext" } });
    userId = user.id;
    const profile = await prisma.patientProfile.create({ data: { ownerUserId: userId, displayName: "Test Due Fixture", timezone: IST } });
    profileId = profile.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.diagnosticResult.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.diagnosticReport.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.testDueSchedule.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.patientProfile.delete({ where: { id: profileId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("a recurring schedule due today queues one test_due row and rolls forward by its interval — idempotently", async () => {
    const row = await schedule({ analyteKey: "hba1c", dueOn: today, recurrenceDays: 90 });

    const first = await detectTestDue(prisma, { now });
    expect(first.queued).toBeGreaterThanOrEqual(1);
    const notification = await prisma.notification.findUnique({ where: { dedupeKey: testDueKey(row.id, today) } });
    expect(notification).toMatchObject({ kind: "test_due", status: "pending", patientProfileId: profileId });

    const after = await prisma.testDueSchedule.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("pending");
    expect(after.dueOn.toISOString().slice(0, 10)).toBe(addDaysToDateString(today, 90));

    // Re-running does nothing: the schedule is now in the future and the key already exists.
    const second = await detectTestDue(prisma, { now });
    const rows = await prisma.notification.count({ where: { patientProfileId: profileId, kind: "test_due" } });
    expect(rows).toBe(1);
    expect(second.queued).toBe(0);
  });

  it("a one-off schedule overdue by a day queues once and becomes notified", async () => {
    const row = await schedule({ diagnosticKind: "imaging", dueOn: addDaysToDateString(today, -1) });
    await detectTestDue(prisma, { now });
    const after = await prisma.testDueSchedule.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("notified");
    expect(await prisma.notification.findUnique({ where: { dedupeKey: testDueKey(row.id, addDaysToDateString(today, -1)) } })).toBeTruthy();
  });

  it("a schedule overdue by several intervals reminds once and lands on the next future date", async () => {
    const row = await schedule({ analyteKey: "tsh", dueOn: addDaysToDateString(today, -200), recurrenceDays: 90 });
    await detectTestDue(prisma, { now });
    const after = await prisma.testDueSchedule.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.dueOn.toISOString().slice(0, 10)).toBe(addDaysToDateString(today, 70)); // -200 + 3×90
    expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `test_due:${row.id}:` } } })).toBe(1);
  });

  it("a matching result on or after the due date satisfies the schedule: no reminder, one-off done, recurring rolls from the result", async () => {
    const report = await prisma.diagnosticReport.create({
      data: {
        patientProfileId: profileId,
        kind: "laboratory",
        title: "Lipid panel",
        testedAt: utcDate(today),
        results: { create: [{ patientProfileId: profileId, analyteKey: "ldl", enteredValueText: "100" }] },
      },
    });
    expect(await latestMatchingResultDate(prisma, profileId, { analyteKey: "ldl", diagnosticKind: null })).toBe(today);
    expect(await latestMatchingResultDate(prisma, profileId, { analyteKey: null, diagnosticKind: "laboratory" })).toBe(today);
    expect(await latestMatchingResultDate(prisma, profileId, { analyteKey: "creatinine", diagnosticKind: null })).toBeNull();

    const oneOff = await schedule({ analyteKey: "ldl", dueOn: addDaysToDateString(today, -3) });
    const recurring = await schedule({ diagnosticKind: "laboratory", dueOn: addDaysToDateString(today, -3), recurrenceDays: 30 });
    await detectTestDue(prisma, { now });

    expect((await prisma.testDueSchedule.findUniqueOrThrow({ where: { id: oneOff.id } })).status).toBe("done");
    const rolled = await prisma.testDueSchedule.findUniqueOrThrow({ where: { id: recurring.id } });
    expect(rolled.status).toBe("pending");
    expect(rolled.dueOn.toISOString().slice(0, 10)).toBe(addDaysToDateString(today, 30));
    expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `test_due:${oneOff.id}:` } } })).toBe(0);
    expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `test_due:${recurring.id}:` } } })).toBe(0);
    expect(report.id).toBeTruthy();
  });

  it("future, dismissed and deleted schedules are left alone", async () => {
    const future = await schedule({ analyteKey: "vitd", dueOn: addDaysToDateString(today, 5), recurrenceDays: 180 });
    const dismissed = await schedule({ analyteKey: "vitd", dueOn: today, status: "dismissed" });
    const deleted = await schedule({ analyteKey: "vitd", dueOn: today });
    await prisma.testDueSchedule.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await detectTestDue(prisma, { now });
    for (const id of [future.id, dismissed.id, deleted.id]) {
      expect(await prisma.notification.count({ where: { dedupeKey: { startsWith: `test_due:${id}:` } } })).toBe(0);
    }
    expect((await prisma.testDueSchedule.findUniqueOrThrow({ where: { id: future.id } })).dueOn.toISOString().slice(0, 10)).toBe(addDaysToDateString(today, 5));
  });
});
