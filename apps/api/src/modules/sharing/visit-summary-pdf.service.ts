import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import { createLogger } from "@medpass/observability";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import type { VisitSummaryDto } from "./visit-summary.service";

const POLL_INTERVAL_MS = 150;
const TIMEOUT_MS = 8000;

// Not app.module's logger instance: importing it here would be circular
// (app.module registers this service). Same name + config, same stdout.
const logger = createLogger("api");

/**
 * PDF export (docs/09 OD-14, docs/22 Stage 7 follow-up): enqueues a render
 * job on the Postgres-backed queue and polls for the result — apps/worker
 * actually runs headless Chromium. OD-14's "worker" framing assumed a
 * BullMQ queue; there's no Redis in this sandbox, so Postgres is the
 * primary queue instead (same substitution as Stage 3/8's OCR). The bounded
 * poll keeps the simple "click and get a PDF" request/response shape for
 * callers even though rendering now happens in a separate process — PDF
 * generation is fast enough (well under a second once the worker's browser
 * is warm) that this rarely waits more than one or two polls.
 *
 * The PDF is never stored: each call enqueues a fresh render and the result
 * is read back once, matching the live-JSON-summary principle (docs/12
 * H-12 — a stale medication list handed to a doctor is a safety risk).
 */
@Injectable()
export class VisitSummaryPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async render(summary: VisitSummaryDto): Promise<Buffer> {
    const job = await this.prisma.backgroundJob.create({
      data: { queue: "pdf_render", jobKey: `pdf:${randomUUID()}`, payload: { summary } as object },
    });

    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const fresh = await this.prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
      if (fresh.status === "succeeded") {
        const { pdfBase64 } = fresh.result as { pdfBase64: string };
        return Buffer.from(pdfBase64, "base64");
      }
      if (fresh.status === "failed") {
        // The worker stores the render error on the job row; without this
        // line a failed render is an opaque 500 (the worker's own stdout is
        // not surfaced in e2e/CI runs, which made a real failure undiagnosable).
        logger.warn({ jobId: job.id, jobError: fresh.errorDigest }, "pdf render job failed");
        throw new ApiProblem(ERROR_CODES.INTERNAL, "Couldn't create the PDF. Please try again.", 500);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new ApiProblem(ERROR_CODES.INTERNAL, "This is taking longer than expected. Please try again.", 503);
  }
}
