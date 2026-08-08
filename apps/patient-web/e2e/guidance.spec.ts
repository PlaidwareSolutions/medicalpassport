import { expect, test } from "@playwright/test";
import { GUIDANCE_AUDIO } from "../lib/guidance-audio-manifest";
import type { GuidanceAudioId } from "../lib/guidance-audio-entries";
import { screenRoutes } from "./routes";

const LOCALES = ["en", "hi", "te", "ur"] as const;

/** The visible label of the listen button per locale — pinned here so a copy change is a conscious test change. */
const LISTEN_LABEL: Record<(typeof LOCALES)[number], string> = {
  en: "Listen",
  hi: "सुनें",
  te: "వినండి",
  ur: "سنیں",
};

/**
 * Which screen-purpose audio each route's header speaks (docs/07 screen 20).
 * Null = the screen intentionally has no header listen button (forms and
 * pre-auth screens; the tour and help screens arrive in later chunks).
 */
function expectedAudio(route: string): GuidanceAudioId | null {
  if (route === "/") return "screen.home";
  if (route === "/add") return "screen.add";
  if (route.startsWith("/add/scan")) return "screen.scan";
  if (route === "/allergies") return "screen.allergies";
  if (route === "/blood-sugar") return "screen.blood_sugar";
  if (route === "/caregivers") return "screen.caregivers";
  if (route === "/caregivers/invitations") return "screen.caregiver_invitations";
  if (route === "/help") return "screen.help";
  if (route === "/medicines") return "screen.medicines";
  if (route === "/medicines/confirm-type") return "screen.confirm_type";
  if (/^\/medicines\/[^/]+$/.test(route)) return "screen.medicine_detail";
  if (route === "/offline") return "screen.offline";
  if (route === "/prescriptions") return "screen.prescriptions";
  if (route === "/profile") return "screen.profile";
  if (route === "/profile/claim-invitations") return "screen.claim_invitations";
  if (route === "/reports") return "screen.reports";
  if (route === "/reports/values") return "screen.report_values";
  if (route === "/safety") return "screen.safety";
  if (route === "/share") return "screen.share";
  if (route === "/sync/conflicts") return "screen.sync_conflicts";
  if (route === "/timeline") return "screen.timeline";
  if (route === "/tour") return "tour.1";
  if (route === "/visit") return "screen.visit";
  return null;
}

/**
 * The listen button must be *honest* (docs/32: text always primary, never a
 * dead control). Headless CI Chromium has zero speechSynthesis voices, so a
 * button may appear here only when pre-generated audio exists for the
 * screen's guidance entry in the current locale — and then its MP3 must
 * actually be served. Before the first `generate:audio` run the manifest is
 * empty and this suite pins the opposite: no button anywhere. It self-
 * strengthens the moment audio artifacts are committed.
 */
for (const locale of LOCALES) {
  test.describe(`guidance read-aloud [${locale}]`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((l) => {
        window.localStorage.setItem("medpass_locale", l);
        // Deterministic no-browser-voice environment: Linux CI headless has
        // zero speechSynthesis voices, but macOS headless exposes system
        // voices *nondeterministically* (observed: a Telugu voice arriving
        // mid-test on 5 of 21 screens). This suite pins the pre-generated-
        // audio branch only; browser-TTS behavior is not e2e-testable
        // deterministically and is covered by the engine's unit-level rules.
        if (window.speechSynthesis) window.speechSynthesis.getVoices = () => [];
      }, locale);
    });

    for (const route of screenRoutes()) {
      const audioId = expectedAudio(route);

      test(`${route} ${audioId ? `speaks ${audioId}` : "has no listen button"}`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

        // Signed-in visits to pre-auth routes (welcome/login) redirect to
        // Home — judge the screen that actually rendered, not the URL asked
        // for, or this suite would demand button-absence on Home.
        const finalAudioId = expectedAudio(new URL(page.url()).pathname);
        const asset = finalAudioId ? GUIDANCE_AUDIO[finalAudioId]?.[locale] : undefined;

        const listenButtons = page.getByRole("button", { name: LISTEN_LABEL[locale], exact: true });

        if (asset) {
          await expect(listenButtons.first(), `header listen button on ${route}`).toBeVisible();
          await expect(listenButtons.first()).toHaveAttribute("aria-pressed", "false");
          const response = await page.request.get(`/audio/guidance/${asset.file}`);
          expect(response.status(), `${asset.file} must be served`).toBe(200);
        } else {
          // No pre-generated audio (or no button at all) and no CI voices:
          // an unplayable button must not render — this locks the fallback
          // tree's honest-absence branch, including dynamic-text-only
          // buttons like the clinical content blocks.
          await expect(listenButtons, `no dead listen button on ${route}`).toHaveCount(0);
        }
      });
    }
  });
}
