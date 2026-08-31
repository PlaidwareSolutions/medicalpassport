import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { decryptField } from "../../common/crypto";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";

/**
 * User info + onboarding analysis (owner-directed, 2026-08-31): row-level
 * USER visibility for pilot operations, a deliberate documented exception
 * to the aggregate-only admin posture admin-operations.controller.ts
 * records — bounded on purpose:
 *
 *  - IDENTITY + ENGAGEMENT only: display name, masked phone, birth year,
 *    sign-up/last-active, usage days, and per-area COUNTS.
 *  - NEVER clinical content: no medicine names, reading values, document
 *    or report detail — those stay visible only to the patient and their
 *    authorized caregivers, exactly as before.
 *  - Phone is decrypted server-side and immediately masked to its last
 *    four digits; the full number never leaves this process.
 *  - Gated by its own duty (users_view, docs/06) and every view is
 *    audited (admin.users_viewed).
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/users")
export class AdminUsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("overview")
  async overview(@Req() req: ApiRequest) {
    requireAdminDuty(req, "view_users");
    await writeAudit(this.prisma, {
      action: "admin.users_viewed",
      actorUserId: req.adminAuth!.adminUserId,
      actorType: "admin",
      correlationId: req.correlationId,
    });

    const [users, profiles, meds, rxs, reports, caregivers, glucose, bp, weight] = await Promise.all([
      this.prisma.user.findMany({
        select: { id: true, phoneCiphertext: true, status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.patientProfile.findMany({
        where: { deletedAt: null },
        select: { id: true, ownerUserId: true, claimedByUserId: true, createdAt: true, displayName: true, yearOfBirth: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.patientMedication.groupBy({ by: ["patientProfileId"], where: { deletedAt: null }, _count: true }),
      this.prisma.prescription.groupBy({ by: ["patientProfileId"], where: { deletedAt: null }, _count: true }),
      this.prisma.medicalReport.groupBy({ by: ["patientProfileId"], where: { deletedAt: null }, _count: true }),
      this.prisma.caregiverRelationship.groupBy({ by: ["patientProfileId"], where: { status: "active" }, _count: true }),
      this.prisma.glucoseReading.groupBy({ by: ["patientProfileId"], where: { deletedAt: null }, _count: true }),
      this.prisma.bloodPressureReading.groupBy({ by: ["patientProfileId"], where: { deletedAt: null }, _count: true }),
      this.prisma.weightReading.groupBy({ by: ["patientProfileId"], where: { deletedAt: null }, _count: true }),
    ]);

    // Same self/dependent attribution as computeProfileRelationships: a
    // claimed profile belongs to its claimer; otherwise the owner's
    // earliest unclaimed profile is "self", later ones are dependents.
    const selfByUser = new Map<string, (typeof profiles)[number]>();
    const profilesByUser = new Map<string, (typeof profiles)[number][]>();
    for (const p of profiles) {
      const controller = p.claimedByUserId ?? p.ownerUserId;
      const list = profilesByUser.get(controller) ?? [];
      list.push(p);
      profilesByUser.set(controller, list);
      if (p.claimedByUserId && !selfByUser.has(p.claimedByUserId)) selfByUser.set(p.claimedByUserId, p);
    }
    for (const p of profiles) {
      if (!p.claimedByUserId && !selfByUser.has(p.ownerUserId)) selfByUser.set(p.ownerUserId, p);
    }

    const toMap = (rows: { patientProfileId: string; _count: number }[]) =>
      new Map(rows.map((r) => [r.patientProfileId, r._count]));
    const counts = {
      medications: toMap(meds),
      prescriptions: toMap(rxs),
      reports: toMap(reports),
      glucoseReadings: toMap(glucose),
      bpReadings: toMap(bp),
      weightReadings: toMap(weight),
    };
    const caregiversBy = toMap(caregivers);

    // Engagement: distinct IST calendar days with an audit event or a
    // session start, plus the most recent audit activity.
    const usageRows = await this.prisma.$queryRaw<{ user_id: string; days: number }[]>`
      SELECT user_id, COUNT(DISTINCT day)::int AS days FROM (
        SELECT actor_user_id AS user_id, DATE(occurred_at AT TIME ZONE 'Asia/Kolkata') AS day
          FROM audit_events WHERE actor_user_id IS NOT NULL
        UNION
        SELECT user_id, DATE(created_at AT TIME ZONE 'Asia/Kolkata') FROM sessions
      ) t GROUP BY user_id`;
    const usageBy = new Map(usageRows.map((r) => [r.user_id, r.days]));
    const lastSeenRows = await this.prisma.$queryRaw<{ user_id: string; last: Date }[]>`
      SELECT actor_user_id AS user_id, MAX(occurred_at) AS last FROM audit_events
      WHERE actor_user_id IS NOT NULL GROUP BY actor_user_id`;
    const lastSeenBy = new Map(lastSeenRows.map((r) => [r.user_id, r.last]));

    const maskPhone = (ciphertext: string): string => {
      try {
        const phone = decryptField(ciphertext);
        return `${phone.slice(0, 3)}••••••${phone.slice(-4)}`;
      } catch {
        return "•••";
      }
    };

    const items = users.map((u) => {
      const self = selfByUser.get(u.id);
      const mine = profilesByUser.get(u.id) ?? [];
      const dependents = self ? mine.filter((p) => p !== self) : mine;
      const sum = (m: Map<string, number>) => mine.reduce((acc, p) => acc + (m.get(p.id) ?? 0), 0);
      return {
        userId: u.id,
        displayName: self?.displayName ?? null,
        phoneMasked: maskPhone(u.phoneCiphertext),
        yearOfBirth: self?.yearOfBirth ?? null,
        status: u.status,
        signedUpAt: u.createdAt.toISOString(),
        lastActiveAt: lastSeenBy.get(u.id)?.toISOString() ?? null,
        usageDays: usageBy.get(u.id) ?? 0,
        medications: sum(counts.medications),
        prescriptions: sum(counts.prescriptions),
        reports: sum(counts.reports),
        glucoseReadings: sum(counts.glucoseReadings),
        bpReadings: sum(counts.bpReadings),
        weightReadings: sum(counts.weightReadings),
        caregivers: self ? (caregiversBy.get(self.id) ?? 0) : 0,
        dependents: dependents.length,
      };
    });

    // Onboarding by ISO week (Monday start, IST), inception → now — the
    // analysis half: every week since the first sign-up, zero-filled.
    const weekOf = (d: Date): string => {
      const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      const day = (ist.getUTCDay() + 6) % 7; // Mon=0
      ist.setUTCDate(ist.getUTCDate() - day);
      return ist.toISOString().slice(0, 10);
    };
    const weekCounts = new Map<string, number>();
    for (const u of users) weekCounts.set(weekOf(u.createdAt), (weekCounts.get(weekOf(u.createdAt)) ?? 0) + 1);
    const onboardingByWeek: { weekStart: string; count: number }[] = [];
    if (users.length > 0) {
      const cursorMs = Date.parse(weekOf(users[0]!.createdAt));
      const lastMs = Date.parse(weekOf(new Date()));
      for (let ms = cursorMs; ms <= lastMs; ms += 7 * 24 * 60 * 60 * 1000) {
        const key = new Date(ms).toISOString().slice(0, 10);
        onboardingByWeek.push({ weekStart: key, count: weekCounts.get(key) ?? 0 });
      }
    }

    const now = Date.now();
    const activeLast7d = items.filter((i) => i.lastActiveAt && now - Date.parse(i.lastActiveAt) < 7 * 24 * 60 * 60 * 1000).length;
    return {
      totals: {
        users: users.length,
        newLast7d: items.filter((i) => now - Date.parse(i.signedUpAt) < 7 * 24 * 60 * 60 * 1000).length,
        activeLast7d,
        singleDayUsers: items.filter((i) => i.usageDays <= 1).length,
      },
      onboardingByWeek,
      items,
    };
  }
}
