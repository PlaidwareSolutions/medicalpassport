import { expect, test, type Page } from "@playwright/test";
import { en } from "@medpass/localization/dist/dictionaries/en.js";
import { screenRoutes } from "./routes";

/**
 * Exploratory crawl (docs_v2/13 §1). The axe/reflow/guidance sweeps prove
 * every screen is accessible; this one proves every screen is *working*.
 * For every route in every locale it records the things a screenshot would
 * not show and a happy-path spec never looks for:
 *
 *   - uncaught page errors (a React render crash, a thrown promise);
 *   - console errors, minus a short allow-list of known browser noise;
 *   - API responses of 500 or above (a 4xx can be a legitimate "not yet");
 *   - a dictionary key rendered verbatim, or an unfilled `{param}`, in the
 *     visible text — the localization layer falls back to the key so gaps
 *     are visible rather than blank, and this is where they get caught;
 *   - and, once, every internal link on every page: none may land on the
 *     Next.js not-found page.
 *
 * It runs on the built app against the real API, like the other sweeps.
 */

const LOCALES = ["en", "hi", "te", "ur"] as const;

/** Every English dictionary key, so a verbatim key in visible text is detectable exactly. */
const KEY_SET = new Set(Object.keys(en));

/** Console lines that are browser or platform noise, not product defects. */
const CONSOLE_ALLOW = [
  /Download the React DevTools/i,
  /the server responded with a status of 401/i, // the session probe on a signed-out route
  /Failed to load resource: net::ERR_INTERNET_DISCONNECTED/i, // the offline screen goes offline on purpose
  /A tree hydrated but some attributes/i, // locale direction is set client-side; already covered by the a11y suite
  /ServiceWorker/i, // registration is best-effort and absent under file-less test contexts
];

interface Findings {
  pageErrors: string[];
  consoleErrors: string[];
  serverErrors: string[];
  rawKeys: string[];
  unfilledParams: string[];
}

function attach(page: Page): Findings {
  const f: Findings = { pageErrors: [], consoleErrors: [], serverErrors: [], rawKeys: [], unfilledParams: [] };
  page.on("pageerror", (err) => f.pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (CONSOLE_ALLOW.some((re) => re.test(text))) return;
    f.consoleErrors.push(text);
  });
  page.on("response", (res) => {
    if (res.status() >= 500) f.serverErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
  return f;
}

async function scanVisibleText(page: Page, f: Findings): Promise<void> {
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  // A dictionary key is dot-separated lowercase words; an unfilled param is
  // `{word}`. Both are things a patient must never see.
  for (const token of text.split(/\s+/)) {
    const bare = token.replace(/^[("'[]+|[)"'\].,:;!?]+$/g, "");
    if (KEY_SET.has(bare)) f.rawKeys.push(bare);
  }
  for (const m of text.matchAll(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g)) f.unfilledParams.push(m[0]);
}

function assertClean(route: string, locale: string, f: Findings): void {
  const where = `${route} [${locale}]`;
  expect(f.pageErrors, `uncaught errors on ${where}`).toEqual([]);
  expect(f.serverErrors, `5xx responses on ${where}`).toEqual([]);
  expect([...new Set(f.rawKeys)], `dictionary keys rendered verbatim on ${where}`).toEqual([]);
  expect([...new Set(f.unfilledParams)], `unfilled message params on ${where}`).toEqual([]);
  expect(f.consoleErrors, `console errors on ${where}`).toEqual([]);
}

for (const locale of LOCALES) {
  test.describe(`crawl [${locale}]`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((l) => {
        window.localStorage.setItem("medpass_locale", l);
      }, locale);
    });

    for (const route of screenRoutes()) {
      test(`${route} renders without errors`, async ({ page }) => {
        const f = attach(page);
        await page.goto(route);
        await page.waitForLoadState("networkidle").catch(() => {});
        // Give deferred data hooks a moment: most screens fetch after mount
        // and render their real content or empty state on the second frame.
        await page.waitForTimeout(400);
        await scanVisibleText(page, f);
        assertClean(route, locale, f);
      });
    }
  });
}

/**
 * Dead-link pass. Collects every same-origin link on every screen (English
 * is enough: hrefs do not vary by locale), then visits each distinct target
 * once. A target that shows the Next.js not-found page is a broken link.
 */
test("no internal link leads to a not-found page", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const seen = new Map<string, string>(); // href -> first page it was found on
  for (const route of screenRoutes()) {
    await page.goto(route);
    await page.waitForLoadState("networkidle").catch(() => {});
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .map((a) => a.getAttribute("href") ?? "")
        .filter((h) => h.startsWith("/") && !h.startsWith("//")),
    );
    for (const h of hrefs) {
      const clean = h.split("#")[0]!.split("?")[0]!;
      if (clean && !seen.has(clean)) seen.set(clean, route);
    }
  }

  const broken: string[] = [];
  for (const [href, from] of seen) {
    const res = await page.goto(href);
    await page.waitForLoadState("networkidle").catch(() => {});
    const notFound =
      res?.status() === 404 ||
      (await page.evaluate(() => /this page could not be found/i.test(document.body?.innerText ?? "")));
    if (notFound) broken.push(`${href} (linked from ${from})`);
  }
  expect(broken, "links that land on a not-found page").toEqual([]);
});
