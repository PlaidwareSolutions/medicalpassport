import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";

/** Raw recordings land here — gitignored, never in public/, never in R2 (Session 8 §13). */
export const RAW_DIR = resolve(__dirname, "../../../artifacts/marketing-media/raw");

/** A short, deliberate hold so the viewer can read the state — kept small and
 *  uniform; real pacing decisions belong to Session 9 editing. */
export const HOLD_MS = 900;

export async function hold(page: Page, ms: number = HOLD_MS) {
  await page.waitForTimeout(ms);
}

/** Privacy-review still: captured at key moments of every flow so frames can
 *  be inspected for personal data without a video tool (Session 8 §19). */
export async function snap(page: Page, recordingId: string, name: string) {
  const dir = join(RAW_DIR, `${recordingId}-frames`);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

/**
 * Finalize: close the context (flushes the WebM), then persist the raw
 * recording as artifacts/marketing-media/raw/<id>.webm.
 */
export async function saveRecording(page: Page, recordingId: string) {
  mkdirSync(RAW_DIR, { recursive: true });
  const video = page.video();
  await page.context().close();
  if (!video) throw new Error("no video captured — is video.mode 'on' in playwright.marketing.config.ts?");
  await video.saveAs(join(RAW_DIR, `${recordingId}.webm`));
}
