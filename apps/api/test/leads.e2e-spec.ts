import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Professional lead capture (OD-LP-2). Public, unauthenticated. Turnstile is
 * unconfigured in the test env (LEAD_TURNSTILE_SECRET_KEY unset), so the
 * optional-vendor path skips verification — these tests exercise schema,
 * persistence, and the "no patient data" strictness, not the Cloudflare call.
 */
describe("Professional leads e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const created: string[] = [];

  const base = {
    name: "Dr. Test Clinician",
    organization: "Test Clinic",
    role: "doctor",
    city: "Hyderabad",
    consentToContact: true,
  };

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/v1/public/leads").set("x-requested-with", "medpass").send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = app.get(PrismaService);
  });

  // The lead limiter is 5/hour per IP; every test here shares the test
  // client's IP, so reset the bucket before each case. The dedicated
  // rate-limit test below intentionally does NOT get a reset mid-run.
  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: "lead_submit" } } });
  });

  afterAll(async () => {
    if (created.length) await prisma.professionalLead.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  it("accepts a valid lead with email only and persists exactly the schema fields", async () => {
    const res = await post({ ...base, email: "clinic@example.com" }).expect(201);
    expect(res.body.id).toBeTruthy();
    created.push(res.body.id);
    const row = await prisma.professionalLead.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({
      name: "Dr. Test Clinician",
      organization: "Test Clinic",
      role: "doctor",
      city: "Hyderabad",
      email: "clinic@example.com",
      phone: null,
      consentToContact: true,
      source: "website-for-clinics",
      status: "new",
    });
  });

  it("accepts a valid lead with phone only", async () => {
    const res = await post({ ...base, phone: "+91 98000 12345" }).expect(201);
    created.push(res.body.id);
  });

  it("accepts a lead with both email and phone plus an optional message", async () => {
    const res = await post({ ...base, email: "c@example.com", phone: "+919800012345", message: "We have 6 doctors." }).expect(201);
    created.push(res.body.id);
  });

  it("rejects a lead with neither email nor phone", async () => {
    await post({ ...base }).expect(400);
  });

  it("rejects when consent is not true", async () => {
    await post({ ...base, email: "c@example.com", consentToContact: false }).expect(400);
  });

  it("rejects a malformed email", async () => {
    await post({ ...base, email: "not-an-email" }).expect(400);
  });

  it("rejects a malformed phone", async () => {
    await post({ ...base, phone: "abc" }).expect(400);
  });

  it("rejects an unknown role", async () => {
    await post({ ...base, email: "c@example.com", role: "wizard" }).expect(400);
  });

  it("rejects over-length fields", async () => {
    await post({ ...base, email: "c@example.com", name: "x".repeat(200) }).expect(400);
  });

  it("rejects unknown/patient-health fields rather than storing arbitrary JSON", async () => {
    // The schema is .strict(): anything resembling patient data is refused.
    await post({ ...base, email: "c@example.com", patientName: "Jane Doe", diagnosis: "diabetes", medications: ["metformin"] }).expect(400);
    const leaked = await prisma.professionalLead.findFirst({ where: { name: { contains: "Jane" } } });
    expect(leaked).toBeNull();
  });

  it("never returns lead contact details in the response", async () => {
    const res = await post({ ...base, email: "secret@example.com", phone: "+919800099999" }).expect(201);
    created.push(res.body.id);
    expect(JSON.stringify(res.body)).not.toContain("secret@example.com");
    expect(JSON.stringify(res.body)).not.toContain("9800099999");
    expect(Object.keys(res.body)).toEqual(["id"]);
  });

  it("rate-limits repeated submissions from the same IP (5/hour)", async () => {
    // The service default limit is 5/hour; earlier tests already consumed
    // some of the budget, so a short burst here must eventually 429.
    let sawLimit = false;
    for (let i = 0; i < 8; i++) {
      const res = await post({ ...base, email: `burst${i}@example.com` });
      if (res.body?.id) created.push(res.body.id);
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});
