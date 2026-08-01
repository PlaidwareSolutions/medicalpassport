import { expect, test } from "@playwright/test";
import { screenRoutes } from "./routes";

const LOCALES = ["en", "hi", "te", "ur"] as const;

/** WCAG 1.4.4/1.4.10 (docs/33): 320px viewport allowing 1px of rounding. */
const MAX_WIDTH = 321;

/**
 * Reflow sweep: every screen, every locale, 320px viewport, root font at
 * 200% — the exact conditions under which docs/22 recorded Profile at
 * 591px. Text-only zoom is reproduced faithfully by doubling the root font
 * size: every font in the app is rem-based while spacing stays px, which
 * is what real browser text scaling does to this stylesheet.
 */
test.use({ viewport: { width: 320, height: 568 } });

for (const locale of LOCALES) {
  test.describe(`reflow 320px @ 200% [${locale}]`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((l) => {
        window.localStorage.setItem("medpass_locale", l);
      }, locale);
    });

    for (const route of screenRoutes()) {
      test(`${route} stays within the viewport`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("networkidle").catch(() => {});

        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        // Two frames: one for style recalc, one for any resize-driven JS.
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );

        const m = await page.evaluate(() => {
          const overflowing: string[] = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
            const pos = getComputedStyle(el).position;
            // Fixed/sticky elements never widen scrollWidth — check their
            // rects directly so an overflowing nav can't hide from the
            // document-level measurement.
            if (pos !== "fixed" && pos !== "sticky") continue;
            const rect = el.getBoundingClientRect();
            if (rect.right > 321 || rect.left < -1) {
              overflowing.push(`${el.tagName.toLowerCase()} [${Math.round(rect.left)}..${Math.round(rect.right)}]`);
            }
          }
          return {
            url: location.pathname,
            scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            overflowing,
          };
        });

        expect(m.scrollWidth, `document scrollWidth on ${m.url} (rendered for ${route})`).toBeLessThanOrEqual(MAX_WIDTH);
        expect(m.overflowing, `fixed/sticky elements outside viewport on ${m.url}`).toEqual([]);
      });
    }
  });
}
