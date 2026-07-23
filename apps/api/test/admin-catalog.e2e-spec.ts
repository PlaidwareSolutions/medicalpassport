import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword } from "../src/common/crypto";

/**
 * Admin catalog e2e: read browsing + the maker-checker change workflow
 * (propose -> approve/reject), including the solo-approval flag and the
 * maker != checker conflict with 2+ admins.
 */
// Synthetic, per-run-unique prefix so this suite's catalog rows never
// collide with real seed data or a previous run's leftovers, and can be
// cleanly identified for cleanup in afterAll.
const PREFIX = `zzz-e2e-admin-catalog-${Date.now()}-`;

describe("Admin catalog e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // Deliberately does NOT truncate the catalog reference tables
    // (medication_ingredients, manufacturers, etc.) — those are shared,
    // seeded fixture data other e2e suites (safety, documents-extraction,
    // the main api spec's catalog search) depend on for the whole
    // `pnpm test` run. This suite only ever creates clearly-synthetic,
    // per-run-unique rows there (see uniqueName() below) so it never
    // collides with real seed data or a previous run's leftovers.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, catalog_change_requests, admin_sessions, admin_users CASCADE
    `);
  });

  afterAll(async () => {
    // Only cleans up this suite's own synthetic rows (PREFIX-namespaced) —
    // never touches the shared, seeded catalog data other suites rely on.
    await prisma.medicationProduct.deleteMany({ where: { genericName: { startsWith: PREFIX } } });
    await prisma.medicationIngredient.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.manufacturer.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.medicationBrand.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.dosageForm.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.administrationRoute.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.therapeuticClass.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await app.close();
  });

  async function createAdmin(email: string, duties: string[] = ["catalog_write", "catalog_approve"]) {
    return prisma.adminUser.create({ data: { email, passwordHash: hashPassword("test-password-123"), duties: duties as never } });
  }

  async function fullSessionCookies(adminUserId: string): Promise<string[]> {
    // Bypass the HTTP login/enroll dance for tests that only need an
    // authenticated session, not to re-test auth itself (covered in
    // admin-auth.e2e-spec.ts) — insert a fully-verified AdminSession row
    // directly, mirroring how other e2e suites build direct fixtures.
    const { newOpaqueToken, hashSessionToken } = await import("../src/common/crypto");
    const token = newOpaqueToken();
    await prisma.adminSession.create({
      data: {
        adminUserId,
        tokenHash: hashSessionToken(token),
        refreshTokenHash: hashSessionToken(newOpaqueToken()),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return [`medpass_admin_session=${token}`];
  }

  it("lists ingredients (read_catalog needs no specific duty)", async () => {
    const admin = await createAdmin("catalog-reader@test.com", []);
    const cookies = await fullSessionCookies(admin.id);
    const name = `${PREFIX}Listable`;
    await prisma.medicationIngredient.create({ data: { name } });

    const res = await request(app.getHttpServer())
      .get(`/v1/admin/catalog/ingredient?q=${encodeURIComponent(PREFIX)}`)
      .set("Cookie", cookies)
      .expect(200);
    expect(res.body.items.some((i: { name: string }) => i.name === name)).toBe(true);
  });

  it("propose -> approve applies the change to the real ingredient table", async () => {
    // Solo-approval only means anything with exactly one active admin —
    // reset so this test's admin really is the only one, regardless of
    // fixtures earlier tests in this file created.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE admin_sessions, admin_users CASCADE`);
    const admin = await createAdmin("catalog-solo@test.com");
    const cookies = await fullSessionCookies(admin.id);

    const propose = await request(app.getHttpServer())
      .post("/v1/admin/catalog-changes")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ entityType: "ingredient", operation: "create", proposedData: { name: `${PREFIX}Amlodipine`, synonyms: ["Amlo"] } })
      .expect(201);
    expect(propose.body.status).toBe("pending");

    const decide = await request(app.getHttpServer())
      .post(`/v1/admin/catalog-changes/${propose.body.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(201);
    expect(decide.body.status).toBe("approved");
    // Only one active admin exists at decide-time -> solo-approval, durably flagged.
    expect(decide.body.isSoloApproval).toBe(true);

    const created = await prisma.medicationIngredient.findFirst({ where: { name: `${PREFIX}Amlodipine` } });
    expect(created).not.toBeNull();
    expect(created?.synonyms).toEqual(["Amlo"]);
  });

  it("rejects a change and never applies it", async () => {
    const admin = await createAdmin("catalog-reject@test.com");
    const cookies = await fullSessionCookies(admin.id);

    const propose = await request(app.getHttpServer())
      .post("/v1/admin/catalog-changes")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ entityType: "manufacturer", operation: "create", proposedData: { name: `${PREFIX}RejectedCo` } })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/catalog-changes/${propose.body.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "reject", rejectionReason: "duplicate of an existing manufacturer" })
      .expect(201);

    const created = await prisma.manufacturer.findFirst({ where: { name: `${PREFIX}RejectedCo` } });
    expect(created).toBeNull();
  });

  it("already-decided changes cannot be decided again (409)", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE admin_sessions, admin_users CASCADE`);
    const admin = await createAdmin("catalog-double@test.com");
    const cookies = await fullSessionCookies(admin.id);
    const propose = await request(app.getHttpServer())
      .post("/v1/admin/catalog-changes")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ entityType: "dosage_form", operation: "create", proposedData: { name: `${PREFIX}SublingualTablet` } })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/catalog-changes/${propose.body.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/catalog-changes/${propose.body.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(409);
  });

  it("maker != checker: with 2+ active admins, the proposer cannot approve their own change (403), a different admin can", async () => {
    const maker = await createAdmin("catalog-maker@test.com");
    const checker = await createAdmin("catalog-checker@test.com");
    const makerCookies = await fullSessionCookies(maker.id);
    const checkerCookies = await fullSessionCookies(checker.id);

    const propose = await request(app.getHttpServer())
      .post("/v1/admin/catalog-changes")
      .set("Cookie", makerCookies)
      .set("x-requested-with", "medpass")
      .send({ entityType: "route", operation: "create", proposedData: { name: `${PREFIX}Intranasal` } })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/catalog-changes/${propose.body.id}/decide`)
      .set("Cookie", makerCookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(403);

    const decide = await request(app.getHttpServer())
      .post(`/v1/admin/catalog-changes/${propose.body.id}/decide`)
      .set("Cookie", checkerCookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(201);
    expect(decide.body.isSoloApproval).toBe(false);
  });

  it("propose without catalog_write duty is forbidden (403)", async () => {
    const admin = await createAdmin("catalog-nowrite@test.com", []);
    const cookies = await fullSessionCookies(admin.id);
    await request(app.getHttpServer())
      .post("/v1/admin/catalog-changes")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ entityType: "ingredient", operation: "create", proposedData: { name: `${PREFIX}NoDutyMed` } })
      .expect(403);
  });
});
