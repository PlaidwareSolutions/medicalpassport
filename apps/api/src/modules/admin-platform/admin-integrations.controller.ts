import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { BackgroundJobQueue } from "@medpass/database";
import { TERMINOLOGY_VERSION } from "@medpass/terminology";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import { env } from "../../common/env";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";

type Health = "configured" | "not_configured" | "none" | "mock";

interface IntegrationRow {
  key: string;
  label: string;
  health: Health;
  /** Engine / model / table version where one is known; null when nothing has run yet. */
  version: string | null;
  lastSuccessAt: string | null;
  /** Where `lastSuccessAt` was derived from, so an operator can trust or discount it. */
  lastSuccessSource: "background_jobs" | "document_extractions" | "notification_attempts" | "abdm_transactions" | null;
  note: string | null;
}

/**
 * Adapter health (docs_v2/14 §3 "Integrations", operations_view): one row
 * per external dependency — OCR / classifier / extractor engines (versions
 * from the latest DocumentExtraction rows the worker wrote), the
 * terminology catalog version, push / SMS / email transports, the ABDM
 * gateway, the FHIR validator — and the ones that are honestly not there
 * yet (interaction provider, WhatsApp BSP, lab APIs). Last-success
 * timestamps come from BackgroundJob rows where a queue exists for the
 * adapter, otherwise from the attempt / transaction ledgers. Configuration
 * facts only — no key material, no addresses.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/integrations")
export class AdminIntegrationsController {
  constructor(private readonly prisma: PrismaService) {}

  private async lastSucceededJob(queue: BackgroundJobQueue): Promise<string | null> {
    const job = await this.prisma.backgroundJob.findFirst({ where: { queue, status: "succeeded" }, orderBy: { completedAt: "desc" }, select: { completedAt: true } });
    return job?.completedAt?.toISOString() ?? null;
  }

  private async latestExtraction(engines: string[]): Promise<{ engine: string; engineVersion: string; finishedAt: Date | null } | null> {
    return this.prisma.documentExtraction.findFirst({
      where: { engine: { in: engines }, status: "succeeded" },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      select: { engine: true, engineVersion: true, finishedAt: true },
    });
  }

  private async lastSentAttempt(channel: "web_push" | "sms" | "email"): Promise<string | null> {
    const a = await this.prisma.notificationAttempt.findFirst({ where: { channel, status: { in: ["sent", "delivered"] } }, orderBy: { attemptedAt: "desc" }, select: { attemptedAt: true } });
    return a?.attemptedAt.toISOString() ?? null;
  }

  @Get()
  async list(@Req() req: ApiRequest) {
    requireAdminDuty(req, "view_operations");
    const e = env();

    const [ocr, extractor, classifyJob, extractJob, ocrJob, fhirJob, abdmJob, pushLast, smsLast, emailLast, abdmLast, enrichmentJob] = await Promise.all([
      this.latestExtraction(["tesseract.js", "pdf-text", "pdf_text", "ocr"]),
      this.latestExtraction(["deterministic", "deterministic-extractor"]),
      this.lastSucceededJob("document_classify"),
      this.lastSucceededJob("document_extract"),
      this.lastSucceededJob("ocr_extraction"),
      this.lastSucceededJob("fhir_validate"),
      this.lastSucceededJob("abdm_outbound"),
      this.lastSentAttempt("web_push"),
      this.lastSentAttempt("sms"),
      this.lastSentAttempt("email"),
      this.prisma.abdmTransaction.findFirst({ where: { completedAt: { not: null }, errorCode: null }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
      this.lastSucceededJob("content_enrichment"),
    ]);

    // Any successful extraction row names the engine that produced it; the
    // classifier's own version is only in audit context, so it is reported
    // through the classify queue's last success instead.
    const anyExtraction = await this.prisma.documentExtraction.findFirst({ where: { status: "succeeded" }, orderBy: [{ finishedAt: "desc" }], select: { engine: true, engineVersion: true, finishedAt: true } });

    const rows: IntegrationRow[] = [
      {
        key: "ocr",
        label: "OCR engine",
        health: "configured",
        version: ocr ? `${ocr.engine}@${ocr.engineVersion}` : anyExtraction ? `${anyExtraction.engine}@${anyExtraction.engineVersion}` : null,
        lastSuccessAt: ocrJob ?? classifyJob ?? ocr?.finishedAt?.toISOString() ?? null,
        lastSuccessSource: ocrJob || classifyJob ? "background_jobs" : ocr ? "document_extractions" : null,
        note: "In-process (tesseract.js / PDF text layer) — no external vendor.",
      },
      {
        key: "classifier",
        label: "Document classifier",
        health: "configured",
        version: null,
        lastSuccessAt: classifyJob,
        lastSuccessSource: classifyJob ? "background_jobs" : null,
        note: "Deterministic; version stamped on each document's audit event.",
      },
      {
        key: "extractor",
        label: "Extraction engine",
        health: "configured",
        version: extractor ? `${extractor.engine}@${extractor.engineVersion}` : null,
        lastSuccessAt: extractJob ?? extractor?.finishedAt?.toISOString() ?? null,
        lastSuccessSource: extractJob ? "background_jobs" : extractor ? "document_extractions" : null,
        note: "Deterministic; model extraction (docs_v2/09) not enabled.",
      },
      { key: "catalog", label: "Terminology catalog", health: "configured", version: TERMINOLOGY_VERSION, lastSuccessAt: null, lastSuccessSource: null, note: "Static, versioned code tables in @medpass/terminology." },
      {
        key: "content_enrichment",
        label: "Clinical content enrichment (openFDA / DailyMed)",
        health: "configured",
        version: null,
        lastSuccessAt: enrichmentJob,
        lastSuccessSource: enrichmentJob ? "background_jobs" : null,
        note: null,
      },
      { key: "interaction_provider", label: "Drug-interaction provider", health: "not_configured", version: null, lastSuccessAt: null, lastSuccessSource: null, note: "No provider contracted (docs_v2/16 open decision); rules run on the local catalog only." },
      {
        key: "web_push",
        label: "Web push (VAPID)",
        health: e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY ? "configured" : "not_configured",
        version: null,
        lastSuccessAt: pushLast,
        lastSuccessSource: pushLast ? "notification_attempts" : null,
        note: null,
      },
      {
        key: "sms",
        label: "SMS (Telnyx)",
        health: e.TELNYX_API_KEY && e.TELNYX_FROM_NUMBER ? "configured" : "not_configured",
        version: null,
        lastSuccessAt: smsLast,
        lastSuccessSource: smsLast ? "notification_attempts" : null,
        note: `OTP transport: ${e.OTP_TRANSPORT}.`,
      },
      {
        key: "email",
        label: "Email",
        health: e.EMAIL_TRANSPORT === "log" ? "mock" : "configured",
        version: null,
        lastSuccessAt: emailLast,
        lastSuccessSource: emailLast ? "notification_attempts" : null,
        note: "EMAIL_TRANSPORT=log — attempts are recorded, nothing is sent (no SMTP provider yet).",
      },
      { key: "whatsapp_bsp", label: "WhatsApp (BSP)", health: "not_configured", version: null, lastSuccessAt: null, lastSuccessSource: null, note: "OD-10: no Business Solution Provider contracted; POST notification-channels/whatsapp answers 501." },
      {
        key: "abdm_gateway",
        label: "ABDM gateway",
        health: e.ABDM_GATEWAY_URL ? "configured" : "mock",
        version: e.ABDM_GATEWAY_ENV,
        lastSuccessAt: abdmJob ?? abdmLast?.completedAt?.toISOString() ?? null,
        lastSuccessSource: abdmJob ? "background_jobs" : abdmLast ? "abdm_transactions" : null,
        note: e.ABDM_GATEWAY_URL ? null : "In-process mock gateway (deterministic fixtures).",
      },
      {
        key: "fhir_validator",
        label: "FHIR validator",
        health: "configured",
        version: null,
        lastSuccessAt: fhirJob,
        lastSuccessSource: fhirJob ? "background_jobs" : null,
        note: "In-process (@medpass/fhir); IG versions pinned in packages/fhir/IG-VERSIONS.md.",
      },
      { key: "lab_apis", label: "Laboratory APIs", health: "none", version: null, lastSuccessAt: null, lastSuccessSource: null, note: "No lab integration; reports arrive by upload, provider proposal, or ABDM." },
    ];

    return { items: rows, generatedAt: new Date().toISOString() };
  }
}
