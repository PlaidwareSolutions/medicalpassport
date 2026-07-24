import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";

/**
 * Admin content e2e: read browsing + the maker-checker review workflow
 * (propose -> approve/reject), mirroring admin-catalog.e2e-spec.ts's
 * conventions exactly, plus the one behavior unique to content: a
 * system-authored draft (no human "maker") can be decided by any reviewer,
 * with no maker != checker conflict, unlike a manually-proposed one.
 */
const PREFIX = `zzz-e2e-admin-content-${Date.now()}-`;

describe("Admin content e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // clinical_content(_versions) are exclusively this feature's tables —
    // safe to truncate. medication_ingredients is shared seeded fixture
    // data other suites depend on, so this suite only ever creates
    // clearly-synthetic, PREFIX-namespaced ingredient rows there instead.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, clinical_content_versions, clinical_content, admin_sessions, admin_users CASCADE
    `);
  });

  afterAll(async () => {
    const ingredients = await prisma.medicationIngredient.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
    const ingredientIds = ingredients.map((i) => i.id);
    await prisma.clinicalContent.updateMany({ where: { ingredientId: { in: ingredientIds } }, data: { currentVersionId: null } });
    await prisma.clinicalContentVersion.deleteMany({ where: { content: { ingredientId: { in: ingredientIds } } } });
    await prisma.clinicalContent.deleteMany({ where: { ingredientId: { in: ingredientIds } } });
    await prisma.medicationIngredient.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await app.close();
  });

  async function createIngredient(suffix: string) {
    return prisma.medicationIngredient.create({ data: { name: `${PREFIX}${suffix}` } });
  }

  async function createAdmin(email: string, duties: string[] = ["content_write", "content_approve"]) {
    return prisma.adminUser.create({ data: { email, passwordHash: hashPassword("test-password-123"), duties: duties as never } });
  }

  async function fullSessionCookies(adminUserId: string): Promise<string[]> {
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

  it("lists content (read_content needs no specific duty)", async () => {
    const ingredient = await createIngredient("Listable");
    await prisma.clinicalContent.create({ data: { kind: "education", ingredientId: ingredient.id } });

    const admin = await createAdmin("content-reader@test.com", []);
    const cookies = await fullSessionCookies(admin.id);

    const res = await request(app.getHttpServer()).get("/v1/admin/content").set("Cookie", cookies).expect(200);
    expect(res.body.items.some((c: { ingredient: { name: string } }) => c.ingredient.name === ingredient.name)).toBe(true);
  });

  it("the reviewer queue lists draft versions across ingredients", async () => {
    const ingredient = await createIngredient("QueueMed");
    const content = await prisma.clinicalContent.create({ data: { kind: "education", ingredientId: ingredient.id } });
    await prisma.clinicalContentVersion.create({
      data: { contentId: content.id, body: "Used for queue testing.", sourceKind: "daily_med", sourceCitation: "test fixture" },
    });

    const admin = await createAdmin("content-queue@test.com", []);
    const cookies = await fullSessionCookies(admin.id);

    const res = await request(app.getHttpServer()).get("/v1/admin/content/versions?status=draft").set("Cookie", cookies).expect(200);
    expect(res.body.items.some((v: { content: { ingredient: { name: string } } }) => v.content.ingredient.name === ingredient.name)).toBe(true);
  });

  it("propose -> approve applies the change: sets currentVersionId and the version's reviewStatus", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE admin_sessions, admin_users CASCADE`);
    const ingredient = await createIngredient("Amlodipine");
    const admin = await createAdmin("content-solo@test.com");
    const cookies = await fullSessionCookies(admin.id);

    const propose = await request(app.getHttpServer())
      .post("/v1/admin/content")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ ingredientId: ingredient.id, kind: "education", body: "Used to treat high blood pressure." })
      .expect(201);
    expect(propose.body.reviewStatus).toBe("draft");

    const decide = await request(app.getHttpServer())
      .post(`/v1/admin/content/versions/${propose.body.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(201);
    expect(decide.body.reviewStatus).toBe("approved");
    // Only one active admin exists at decide-time -> solo-approval, durably flagged.
    expect(decide.body.isSoloApproval).toBe(true);

    const content = await prisma.clinicalContent.findUnique({ where: { kind_ingredientId: { kind: "education", ingredientId: ingredient.id } } });
    expect(content?.currentVersionId).toBe(propose.body.id);
  });

  it("rejects a version and never makes it current", async () => {
    const ingredient = await createIngredient("RejectedMed");
    const admin = await createAdmin("content-reject@test.com");
    const cookies = await fullSessionCookies(admin.id);

    const propose = await request(app.getHttpServer())
      .post("/v1/admin/content")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ ingredientId: ingredient.id, kind: "education", body: "Unverified claim." })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/content/versions/${propose.body.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "reject", rejectionReason: "not a confident single-ingredient match" })
      .expect(201);

    const content = await prisma.clinicalContent.findUnique({ where: { kind_ingredientId: { kind: "education", ingredientId: ingredient.id } } });
    expect(content?.currentVersionId).toBeNull();
  });

  it("already-decided versions cannot be decided again (409)", async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE admin_sessions, admin_users CASCADE`);
    const ingredient = await createIngredient("SublingualMed");
    const admin = await createAdmin("content-double@test.com");
    const cookies = await fullSessionCookies(admin.id);

    const propose = await request(app.getHttpServer())
      .post("/v1/admin/content")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ ingredientId: ingredient.id, kind: "education", body: "Some text." })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/content/versions/${propose.body.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/content/versions/${propose.body.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(409);
  });

  it("maker != checker: with 2+ active admins, the proposer cannot approve their own manual draft (403), a different admin can", async () => {
    const ingredient = await createIngredient("Intranasal");
    const maker = await createAdmin("content-maker@test.com");
    const checker = await createAdmin("content-checker@test.com");
    const makerCookies = await fullSessionCookies(maker.id);
    const checkerCookies = await fullSessionCookies(checker.id);

    const propose = await request(app.getHttpServer())
      .post("/v1/admin/content")
      .set("Cookie", makerCookies)
      .set("x-requested-with", "medpass")
      .send({ ingredientId: ingredient.id, kind: "education", body: "Manually authored text." })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/admin/content/versions/${propose.body.id}/decide`)
      .set("Cookie", makerCookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(403);

    const decide = await request(app.getHttpServer())
      .post(`/v1/admin/content/versions/${propose.body.id}/decide`)
      .set("Cookie", checkerCookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(201);
    expect(decide.body.isSoloApproval).toBe(false);
  });

  it("a system-authored draft has no maker to conflict with — any reviewer may approve it, even alongside other admins", async () => {
    const ingredient = await createIngredient("SystemDrafted");
    const content = await prisma.clinicalContent.create({ data: { kind: "education", ingredientId: ingredient.id } });
    const version = await prisma.clinicalContentVersion.create({
      data: {
        contentId: content.id,
        body: "Indicated for type 2 diabetes mellitus.",
        sourceKind: "daily_med",
        sourceCitation: "openFDA/DailyMed structured product label, set id test-set, fetched 2026-01-01",
        proposedByAdminUserId: null,
      },
    });

    // A second, unrelated admin exists too — proving this isn't just an
    // accidental solo-approval case.
    await createAdmin("content-other-admin@test.com", []);
    const reviewer = await createAdmin("content-system-reviewer@test.com");
    const cookies = await fullSessionCookies(reviewer.id);

    const decide = await request(app.getHttpServer())
      .post(`/v1/admin/content/versions/${version.id}/decide`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(201);
    expect(decide.body.reviewStatus).toBe("approved");
    expect(decide.body.isSoloApproval).toBe(false);
  });

  it("propose without content_write duty is forbidden (403)", async () => {
    const ingredient = await createIngredient("NoDutyMed");
    const admin = await createAdmin("content-nowrite@test.com", []);
    const cookies = await fullSessionCookies(admin.id);
    await request(app.getHttpServer())
      .post("/v1/admin/content")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ ingredientId: ingredient.id, kind: "education", body: "Some text." })
      .expect(403);
  });

  it("decide without content_approve duty is forbidden (403)", async () => {
    const ingredient = await createIngredient("NoApproveMed");
    const proposer = await createAdmin("content-noapprove-proposer@test.com");
    const proposerCookies = await fullSessionCookies(proposer.id);
    const propose = await request(app.getHttpServer())
      .post("/v1/admin/content")
      .set("Cookie", proposerCookies)
      .set("x-requested-with", "medpass")
      .send({ ingredientId: ingredient.id, kind: "education", body: "Some text." })
      .expect(201);

    const noApprove = await createAdmin("content-noapprove@test.com", ["content_write"]);
    const noApproveCookies = await fullSessionCookies(noApprove.id);
    await request(app.getHttpServer())
      .post(`/v1/admin/content/versions/${propose.body.id}/decide`)
      .set("Cookie", noApproveCookies)
      .set("x-requested-with", "medpass")
      .send({ decision: "approve" })
      .expect(403);
  });
});
