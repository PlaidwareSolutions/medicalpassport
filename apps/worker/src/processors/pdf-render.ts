import type { Browser } from "puppeteer";
import { renderVisitSummaryHtml, type VisitSummaryDto } from "./visit-summary-html";

// puppeteer is ESM-only; both tsc and ts-jest emit CommonJS, and TypeScript
// downlevels a plain dynamic import() to require() even under a CommonJS
// module target — building the call via `new Function` hides it from that
// transform so Node's real ESM loader runs it (same issue and fix as
// apps/api's visit-summary-pdf.service.ts).
const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("puppeteer")>;

let browserPromise: Promise<Browser> | undefined;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => undefined);
    if (existing?.connected) return existing;
    browserPromise = undefined;
  }
  browserPromise = dynamicImport("puppeteer")
    .then((puppeteer) =>
      puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--single-process", "--no-zygote"],
      }),
    )
    .catch((err: unknown) => {
      browserPromise = undefined;
      throw err;
    });
  return browserPromise;
}

/**
 * Moved here from apps/api (docs/22 Stage 7 follow-up: async via the
 * Postgres-backed queue instead of synchronous-in-request). Unlike the API's
 * per-request lazy browser, the worker is a long-running process, so one
 * browser instance serves every PDF job for the process's lifetime.
 */
export async function renderPdf(summary: VisitSummaryDto): Promise<Buffer> {
  const browser = await getBrowser();
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

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => undefined);
  if (browser) await browser.close();
  browserPromise = undefined;
}
