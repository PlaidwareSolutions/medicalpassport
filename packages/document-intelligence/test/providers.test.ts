import { describe, expect, it } from "vitest";
import {
  documentAiProviderContract,
  NullDocumentAiProvider,
  NULL_DOCUMENT_AI_PROVENANCE,
  ocrProviderContract,
  ProviderRegistry,
  type DocumentAiInput,
  type OcrInput,
  type OcrProvider,
  type OcrResult,
} from "../src/index.js";
import { fixtures } from "./fixtures/malware-fixtures.js";
import { textDocument } from "./helpers.js";

/**
 * The vendor contract checklist (docs_v2/06 P3-2) against the adapters this package ships,
 * plus a deliberately broken adapter to prove the checklist actually rejects things. The
 * real Tesseract adapter runs the same checklist in apps/worker.
 */

/** A well-behaved fake OCR engine: one line per newline, all words at 0.8. */
class FakeOcrProvider implements OcrProvider {
  readonly engine = "fake-ocr";
  readonly engineVersion: string = "1.2.3";
  readonly maxInputBytes = 1024;
  constructor(private readonly text = "Tab Glycomet 500mg\n1-0-1 after food") {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    if (input.bytes.length > this.maxInputBytes) throw new Error("too large");
    const lines = this.text.split("\n").map((text, row) => {
      const words = text.split(" ").map((w, i) => ({ text: w, confidence: 0.8, box: { x: i * 0.2, y: row * 0.1, w: 0.18, h: 0.05 } }));
      return { text, confidence: 0.8, words, box: { x: 0, y: row * 0.1, w: 0.9, h: 0.05 } };
    });
    return { text: this.text, lines, words: lines.flatMap((l) => l.words), confidence: 0.8, engine: this.engine, engineVersion: this.engineVersion };
  }
}

/** Confidence on tesseract's 0–100 scale, boxes in pixels, and it scribbles on the input. */
class BadOcrProvider extends FakeOcrProvider {
  override async recognize(input: OcrInput): Promise<OcrResult> {
    input.bytes[0] = 0;
    const result = await super.recognize(input);
    return { ...result, confidence: 80, words: result.words.map((w) => ({ ...w, box: { ...w.box, x: 120 } })) };
  }
}

const sample: OcrContractSample = { bytes: fixtures.tinyPng, contentType: "image/png" };
type OcrContractSample = Omit<OcrInput, "pageNumber">;

describe("ocrProviderContract", () => {
  const checks = ocrProviderContract({ create: () => new FakeOcrProvider(), sample });

  it.each(checks.map((c) => [c.name, c] as const))("a conforming adapter passes: %s", async (_name, check) => {
    await expect(check.run()).resolves.toBeUndefined();
  });

  it("rejects an adapter that mutates its input or reports 0–100 confidences / pixel boxes", async () => {
    const bad = ocrProviderContract({ create: () => new BadOcrProvider(), sample });
    const failures: string[] = [];
    for (const check of bad) {
      try {
        await check.run();
      } catch (err) {
        failures.push(`${check.name}: ${(err as Error).message}`);
      }
    }
    expect(failures.some((f) => f.includes("never mutates"))).toBe(true);
    expect(failures.some((f) => f.includes("page confidence must be within 0–1"))).toBe(true);
    expect(failures.some((f) => f.includes("box.x must be within 0–1"))).toBe(true);
  });

  it("rejects a placeholder version — provenance must be real", async () => {
    class Unversioned extends FakeOcrProvider {
      override readonly engineVersion = "unknown";
    }
    const [provenance] = ocrProviderContract({ create: () => new Unversioned(), sample });
    await expect(provenance!.run()).rejects.toThrow(/real version/);
  });
});

describe("NullDocumentAiProvider", () => {
  const sampleDocument: DocumentAiInput = { document: textDocument(["Tab Glycomet 500mg 1-0-1"]) };
  const checks = documentAiProviderContract({ create: () => new NullDocumentAiProvider(), sample: sampleDocument });

  it.each(checks.map((c) => [c.name, c] as const))("passes the contract: %s", async (_name, check) => {
    await expect(check.run()).resolves.toBeUndefined();
  });

  it("proposes nothing and says who it is", async () => {
    const provider = new NullDocumentAiProvider();
    expect(await provider.extract(sampleDocument)).toEqual([]);
    expect(provider.provenance).toEqual(NULL_DOCUMENT_AI_PROVENANCE);
    expect(provider.provenance.provider).toBe("null");
  });
});

describe("ProviderRegistry", () => {
  it("resolves by name, case-insensitively, and lists what it knows on a miss", () => {
    const registry = new ProviderRegistry<OcrProvider>("ocr");
    registry.register("tesseract", () => new FakeOcrProvider());
    expect(registry.resolve(" Tesseract ").engine).toBe("fake-ocr");
    expect(registry.names()).toEqual(["tesseract"]);
    expect(() => registry.resolve("vendor-x")).toThrow(/"vendor-x" is not registered \(known: tesseract\)/);
  });

  it("constructs lazily and refuses duplicate names", () => {
    let constructed = 0;
    const registry = new ProviderRegistry<OcrProvider>("ocr").register("a", () => {
      constructed += 1;
      return new FakeOcrProvider();
    });
    expect(constructed).toBe(0);
    registry.resolve("a");
    expect(constructed).toBe(1);
    expect(() => registry.register("A", () => new FakeOcrProvider())).toThrow(/already registered/);
    expect(() => registry.register(" ", () => new FakeOcrProvider())).toThrow(/name is required/);
  });
});
