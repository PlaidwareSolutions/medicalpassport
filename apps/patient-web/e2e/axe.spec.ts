import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { screenRoutes } from "./routes";

/**
 * axe-core per screen (docs/33 engineering-enforcement table): zero
 * serious/critical violations gate merges. Moderate/minor findings are
 * reported in the failure message when a serious one trips, but do not
 * fail the build — matching docs/33's stated threshold.
 */
for (const route of screenRoutes()) {
  test(`axe: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle").catch(() => {});

    const results = await new AxeBuilder({ page }).analyze();
    const gating = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");

    expect(
      gating.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
      })),
      `serious/critical axe violations on ${route}`,
    ).toEqual([]);
  });
}
