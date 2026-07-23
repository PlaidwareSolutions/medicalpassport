import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";

/** Admin audit search e2e: filters, pagination, and the self-audit write. */
describe("Admin audit e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE audit_events, admin_sessions, admin_users CASCADE`);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAdminWithSession(email: string, duties: string[]): Promise<string[]> {
    const admin = await prisma.adminUser.create({ data: { email, passwordHash: hashPassword("test-password-123"), duties: duties as never } });
    const token = newOpaqueToken();
    await prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashSessionToken(token),
        refreshTokenHash: hashSessionToken(newOpaqueToken()),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return [`medpass_admin_session=${token}`];
  }

  it("without audit_search duty, search is forbidden (403)", async () => {
    const cookies = await createAdminWithSession("audit-noduty@test.com", []);
    await request(app.getHttpServer()).get("/v1/admin/audit").set("Cookie", cookies).expect(403);
  });

  it("searches by action and correlationId, and writes exactly one self-audit event per call", async () => {
    const cookies = await createAdminWithSession("audit-searcher@test.com", ["audit_search"]);
    const marker = `admin-audit-e2e-${Date.now()}`;

    await prisma.auditEvent.create({
      data: { action: "profile.created", actorType: "system", rowHash: "x", correlationId: marker },
    });
    await prisma.auditEvent.create({
      data: { action: "medication.created", actorType: "system", rowHash: "y", correlationId: marker },
    });

    const res = await request(app.getHttpServer())
      .get(`/v1/admin/audit?correlationId=${marker}&action=profile.created`)
      .set("Cookie", cookies)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].action).toBe("profile.created");

    const searchEvents = await prisma.auditEvent.findMany({ where: { action: "admin.audit_searched" } });
    expect(searchEvents).toHaveLength(1);
    expect(searchEvents[0]?.context).toMatchObject({ action: "profile.created" });
  });

  it("paginates with a cursor across a larger result set", async () => {
    const cookies = await createAdminWithSession("audit-paginate@test.com", ["audit_search"]);
    const marker = `admin-audit-paginate-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await prisma.auditEvent.create({ data: { action: "dose.recorded", actorType: "system", rowHash: `h${i}`, correlationId: marker } });
    }

    const page1 = await request(app.getHttpServer())
      .get(`/v1/admin/audit?correlationId=${marker}&limit=3`)
      .set("Cookie", cookies)
      .expect(200);
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app.getHttpServer())
      .get(`/v1/admin/audit?correlationId=${marker}&limit=3&cursor=${page1.body.nextCursor}`)
      .set("Cookie", cookies)
      .expect(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();

    const page1Ids = page1.body.items.map((i: { id: string }) => i.id);
    const page2Ids = page2.body.items.map((i: { id: string }) => i.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
  });
});
