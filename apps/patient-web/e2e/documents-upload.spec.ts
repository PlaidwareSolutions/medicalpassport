import { expect, test } from "@playwright/test";

/**
 * Multi-page documents (docs/07 §43/44): a test report or prescription is
 * routinely several pages. Drives the REAL upload path — authorize →
 * presigned PUT → complete, against the running api and object storage —
 * for both the multi-select create flow and the detail screens'
 * add-more-pages flow (which previously didn't exist: a record filed with
 * one photo could never grow a second page).
 *
 * The payloads are tiny synthetic JPEGs: the api's magic-byte verification
 * (file-signature.ts) checks the FF D8 FF signature, not image validity.
 */
const jpegPage = (name: string) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(`medpass-e2e-${name}`, "utf8"),
    Buffer.from([0xff, 0xd9]),
  ]),
});

// The gallery input is the `multiple` one; the camera input is single-shot.
const galleryInput = 'input[type="file"][multiple]';

test.describe("multi-page document upload", () => {
  test("report: two pages at create, a third added from the detail screen", async ({ page }) => {
    await page.goto("/reports/new");
    await page.setInputFiles(galleryInput, [jpegPage("report-page-1.jpg"), jpegPage("report-page-2.jpg")]);
    await expect(page.getByText("report-page-1.jpg")).toBeVisible();
    await expect(page.getByText("report-page-2.jpg")).toBeVisible();

    await page.getByRole("button", { name: "Save report" }).click();
    await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "View", exact: true })).toHaveCount(2);

    await page.setInputFiles(galleryInput, [jpegPage("report-page-3.jpg")]);
    await expect(page.getByRole("button", { name: "View", exact: true })).toHaveCount(3, { timeout: 30_000 });
  });

  test("prescription: one page at create, two more added from the detail screen", async ({ page }) => {
    await page.goto("/prescriptions/new");
    await page.setInputFiles(galleryInput, [jpegPage("rx-page-1.jpg")]);
    await expect(page.getByText("rx-page-1.jpg")).toBeVisible();

    await page.getByRole("button", { name: "Save prescription" }).click();
    await page.waitForURL(/\/prescriptions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "View", exact: true })).toHaveCount(1);

    await page.setInputFiles(galleryInput, [jpegPage("rx-page-2.jpg"), jpegPage("rx-page-3.jpg")]);
    await expect(page.getByRole("button", { name: "View", exact: true })).toHaveCount(3, { timeout: 30_000 });
  });
});
