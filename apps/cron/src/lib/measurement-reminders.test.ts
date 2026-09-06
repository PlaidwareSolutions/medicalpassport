import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEASUREMENT_REMINDERS_JSON_KEY, dateStringInTz, zonedTimeToInstant } from "@medpass/domain";
import { getPrisma, type PrismaClient } from "@medpass/database";
import {
  detectMeasurementReminders,
  dueSlots,
  isoWeekday,
  measurementReminderKey,
  parseMeasurementReminderKey,
  readMeasurementReminders,
} from "./measurement-reminders";

const IST = "Asia/Kolkata";

describe("measurement reminder plan reading (pure)", () => {
  const messyConcepts = {
    concepts: {
      blood_pressure: { times: ["08:00", "20:00", "08:00", "bad"], days: [1, 2, 3, 9, 3] },
      not_a_concept: { times: ["08:00"], days: [1] },
      blood_glucose: { times: [], days: [1] },
    },
  };

  it("reads the plan column tolerantly, dropping malformed times, days and concepts", () => {
    expect(readMeasurementReminders(messyConcepts)).toEqual({ blood_pressure: { times: ["08:00", "20:00"], days: [1, 2, 3] } });
    expect(readMeasurementReminders(null)).toEqual({});
    expect(readMeasurementReminders("nope")).toEqual({});
    expect(readMeasurementReminders({ concepts: [] })).toEqual({});
  });

  it("still reads the pre-column shape, ignoring the per-kind entries around it", () => {
    // Rows written before measurement_reminders_json existed wrapped the plan
    // in the per-kind map under a reserved key; they are never rewritten.
    const legacy = { new_prescription: { channels: ["web_push"], frequency: "daily_digest" }, [MEASUREMENT_REMINDERS_JSON_KEY]: messyConcepts };
    expect(readMeasurementReminders(legacy)).toEqual({ blood_pressure: { times: ["08:00", "20:00"], days: [1, 2, 3] } });
    expect(readMeasurementReminders({ [MEASUREMENT_REMINDERS_JSON_KEY]: "nope" })).toEqual({});
    expect(readMeasurementReminders({ [MEASUREMENT_REMINDERS_JSON_KEY]: { concepts: [] } })).toEqual({});
  });

  it("ISO weekdays: Monday = 1, Sunday = 7", () => {
    expect(isoWeekday("2026-09-07")).toBe(1); // a Monday
    expect(isoWeekday("2026-09-06")).toBe(7); // a Sunday
  });

  it("a slot is live from its wall-clock time until the window closes, on listed days only", () => {
    const plan = { times: ["08:00", "20:00"], days: [1, 2, 3, 4, 5] };
    const monday = "2026-09-07";
    expect(dueSlots(plan, IST, zonedTimeToInstant(IST, monday, "07:59"))).toEqual([]);
    expect(dueSlots(plan, IST, zonedTimeToInstant(IST, monday, "08:00"))).toEqual([{ date: monday, time: "08:00" }]);
    expect(dueSlots(plan, IST, zonedTimeToInstant(IST, monday, "08:15"))).toEqual([{ date: monday, time: "08:00" }]);
    expect(dueSlots(plan, IST, zonedTimeToInstant(IST, monday, "08:16"))).toEqual([]);
    expect(dueSlots(plan, IST, zonedTimeToInstant(IST, monday, "20:05"))).toEqual([{ date: monday, time: "20:00" }]);
    // Sunday is not in the plan.
    expect(dueSlots(plan, IST, zonedTimeToInstant(IST, "2026-09-06", "08:05"))).toEqual([]);
  });

  it("dedupe keys round-trip so the dispatcher can name the concept", () => {
    const id = randomUUID();
    expect(parseMeasurementReminderKey(measurementReminderKey(id, "blood_pressure", "2026-09-07", "08:00"))).toEqual({
      profileId: id,
      concept: "blood_pressure",
      date: "2026-09-07",
      time: "08:00",
    });
    expect(parseMeasurementReminderKey(measurementReminderKey(id, "made_up", "2026-09-07", "08:00"))).toBeNull();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("detectMeasurementReminders", () => {
  let prisma: PrismaClient;
  let profileId: string;
  let userId: string;
  const today = dateStringInTz(IST, new Date());

  beforeAll(async () => {
    prisma = getPrisma();
    const user = await prisma.user.create({ data: { phoneDigest: `mrd-${randomUUID()}`, phoneCiphertext: "not-a-real-ciphertext" } });
    userId = user.id;
    const profile = await prisma.patientProfile.create({ data: { ownerUserId: userId, displayName: "Measurement Reminder Fixture", timezone: IST } });
    profileId = profile.id;
    await prisma.notificationPreference.create({
      data: {
        patientProfileId: profileId,
        pushEnabled: true,
        channelFrequencyJson: { refill: { channels: ["web_push"], frequency: "immediate" } },
        measurementRemindersJson: { concepts: { blood_pressure: { times: ["08:00", "20:00"], days: [1, 2, 3, 4, 5, 6, 7] } } },
      },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.notificationPreference.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.patientProfile.delete({ where: { id: profileId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("emits one measurement_reminder per live slot, once, and nothing outside the window", async () => {
    const at0805 = zonedTimeToInstant(IST, today, "08:05");
    const first = await detectMeasurementReminders(prisma, { now: at0805 });
    expect(first.profilesWithPlans).toBeGreaterThanOrEqual(1);
    const key = measurementReminderKey(profileId, "blood_pressure", today, "08:00");
    expect(await prisma.notification.findUnique({ where: { dedupeKey: key } })).toMatchObject({ kind: "measurement_reminder", status: "pending" });

    // Same slot, a few minutes later: already minted.
    await detectMeasurementReminders(prisma, { now: zonedTimeToInstant(IST, today, "08:09") });
    expect(await prisma.notification.count({ where: { patientProfileId: profileId, kind: "measurement_reminder" } })).toBe(1);

    // 08:40 is past the window for 08:00 and long before 20:00.
    await detectMeasurementReminders(prisma, { now: zonedTimeToInstant(IST, today, "08:40") });
    expect(await prisma.notification.count({ where: { patientProfileId: profileId, kind: "measurement_reminder" } })).toBe(1);

    // The evening slot is its own row.
    await detectMeasurementReminders(prisma, { now: zonedTimeToInstant(IST, today, "20:01") });
    expect(await prisma.notification.count({ where: { patientProfileId: profileId, kind: "measurement_reminder" } })).toBe(2);
  });
});
