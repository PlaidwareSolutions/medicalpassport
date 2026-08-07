import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@medpass/domain";
import { t } from "@medpass/localization";
import { GUIDANCE_AUDIO_ENTRIES, type GuidanceAudioId } from "./guidance-audio-entries";
import { GUIDANCE_AUDIO } from "./guidance-audio-manifest";

/**
 * The staleness gate for pre-generated guidance audio: any edit to a
 * dictionary key referenced by `guidance-audio-entries.ts` invalidates its
 * committed MP3s, and this suite is what makes that loud in CI (the
 * generator itself never runs there). Fix = rerun
 * `pnpm --filter @medpass/patient-web generate:audio` and commit.
 */

const audioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/audio/guidance");
const ids = Object.keys(GUIDANCE_AUDIO_ENTRIES) as GuidanceAudioId[];

function joinedText(id: GuidanceAudioId, locale: (typeof SUPPORTED_LOCALES)[number]): string {
  return GUIDANCE_AUDIO_ENTRIES[id].sourceKeys.map((key) => t(locale, key)).join(" ");
}

describe("guidance audio", () => {
  it("entries reference only static copy — no interpolation params", () => {
    for (const id of ids) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(joinedText(id, locale), `${id} (${locale}) must not carry {param} placeholders`).not.toContain("{");
      }
    }
  });

  it("committed audio matches the current dictionary copy", () => {
    for (const [id, locales] of Object.entries(GUIDANCE_AUDIO)) {
      for (const [locale, asset] of Object.entries(locales)) {
        const currentHash = createHash("sha256")
          .update(joinedText(id as GuidanceAudioId, locale as (typeof SUPPORTED_LOCALES)[number]))
          .digest("hex");
        expect(
          asset.textHash,
          `"${id}" (${locale}) copy drifted from its generated audio — run pnpm --filter @medpass/patient-web generate:audio`,
        ).toBe(currentHash);
        expect(asset.file).toBe(`${id}.${locale}.${currentHash.slice(0, 8)}.mp3`);
        expect(existsSync(path.join(audioDir, asset.file)), `${asset.file} missing from public/audio/guidance`).toBe(true);
      }
    }
  });

  it("no orphaned audio files", () => {
    if (!existsSync(audioDir)) return;
    const referenced = new Set(
      Object.values(GUIDANCE_AUDIO).flatMap((locales) => Object.values(locales).map((asset) => asset.file)),
    );
    for (const file of readdirSync(audioDir)) {
      expect(referenced.has(file), `${file} is not referenced by the manifest — rerun generate:audio`).toBe(true);
    }
  });

  // Until the very first generation run the manifest is empty and every
  // entry honestly falls back to browser TTS — that bootstrap state is
  // legal. The moment any audio is committed, partial coverage is not:
  // adding an entry then requires regenerating.
  const generated = Object.keys(GUIDANCE_AUDIO).length > 0;
  (generated ? it : it.skip)("every entry has audio for every locale once generation has begun", () => {
    for (const id of ids) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(GUIDANCE_AUDIO[id]?.[locale], `"${id}" (${locale}) has no generated audio — run generate:audio`).toBeDefined();
      }
    }
  });
});
