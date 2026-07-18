import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { Browser } from "puppeteer";
import { renderVisitSummaryHtml } from "./visit-summary-html";
import type { VisitSummaryDto } from "./visit-summary.service";

// puppeteer is ESM-only. Both tsc and ts-jest emit CommonJS here, and
// TypeScript downlevels a plain `import("puppeteer")` to a wrapped
// `require()` even under a dynamic import — which still can't load a pure
// ESM package. Building the import call via `new Function` hides it from
// TypeScript's transform entirely, so Node's real ESM loader runs it.
const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("puppeteer")>;

async function loadPuppeteer() {
  return dynamicImport("puppeteer");
}

/**
 * PDF export (docs/09 OD-14, docs/22 Stage 7 follow-up): server-side headless
 * Chromium, not a client-side PDF library — a real browser engine paginates
 * and prints HTML/CSS faithfully, which a client-side library can't
 * replicate reliably. OD-14's "worker" framing assumed a BullMQ queue, but
 * there's no Redis in this sandbox (same constraint as Stage 3/8's OCR), so
 * rendering happens synchronously in the API request — documented
 * simplification, not a redesign; moving this behind a queue later needs no
 * change here, just a different caller.
 *
 * The PDF is never stored — regenerated fresh on every request, same as the
 * live JSON summary (docs/12 H-12: a stale medication list is a safety
 * risk), so there's nothing to clean up and no staleness to worry about.
 */
@Injectable()
export class VisitSummaryPdfService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | undefined;

  private async getBrowser(): Promise<Browser> {
    // A `??=` singleton must not cache a *rejected* promise or a browser
    // that later crashed — either would permanently poison every future
    // request in this process with the same stale failure. Falling
    // through to a fresh launch on either condition keeps this self-healing.
    if (this.browserPromise) {
      const existing = await this.browserPromise.catch(() => undefined);
      if (existing?.connected) return existing;
      this.browserPromise = undefined;
    }
    this.browserPromise = loadPuppeteer()
      .then((puppeteer) =>
        puppeteer.default.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--single-process", "--no-zygote"],
        }),
      )
      .catch((err: unknown) => {
        this.browserPromise = undefined;
        throw err;
      });
    return this.browserPromise;
  }

  async render(summary: VisitSummaryDto): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      const html = renderVisitSummaryHtml(summary);
      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise;
    await browser.close();
  }
}
