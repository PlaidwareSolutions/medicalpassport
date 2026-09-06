import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ocrProviderContract } from "@medpass/document-intelligence";

// tesseract.js spawns a child process and downloads traineddata on first
// use — the boundary is mocked; what this module owns is the language
// selection, the one-worker-per-process lifecycle, and the mapping from the
// engine's output (0–100 confidences, pixel boxes) to the provider contract
// (0–1, page-normalized).
const mocks = vi.hoisted(() => {
  const recognize = vi.fn();
  const terminate = vi.fn();
  const createWorker = vi.fn();
  return { recognize, terminate, createWorker };
});

vi.mock("tesseract.js", () => ({
  createWorker: (...args: unknown[]) => mocks.createWorker(...args),
}));

type OcrModule = typeof import("./ocr");

async function loadFreshModule(): Promise<OcrModule> {
  // The module keeps a process-wide worker promise; each test starts clean.
  vi.resetModules();
  return import("./ocr");
}

/** 1×1 PNG — a real header, so the adapter can read its dimensions. */
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** What tesseract.js returns for a 200×100 image with one line of two words. */
function enginePage(overrides: Partial<{ text: string; confidence: number }> = {}) {
  const word = (text: string, confidence: number, x0: number, x1: number) => ({
    text,
    confidence,
    bbox: { x0, y0: 10, x1, y1: 30 },
    symbols: [],
    choices: [],
    font_name: "",
  });
  const words = [word("Tab", 91, 10, 50), word("Glycomet", 78.5, 60, 150)];
  const line = { text: "Tab Glycomet\n", confidence: 84.75, bbox: { x0: 10, y0: 10, x1: 150, y1: 30 }, words, baseline: {}, rowAttributes: {} };
  return {
    text: "Tab Glycomet\n",
    confidence: 84.75,
    blocks: [{ text: "Tab Glycomet\n", confidence: 84.75, bbox: line.bbox, blocktype: "", paragraphs: [{ text: "", confidence: 84.75, bbox: line.bbox, is_ltr: true, lines: [line] }] }],
    ...overrides,
  };
}

describe("runOcr", () => {
  beforeEach(() => {
    mocks.recognize.mockReset();
    mocks.terminate.mockReset().mockResolvedValue(undefined);
    mocks.createWorker.mockReset().mockImplementation(async () => ({ recognize: mocks.recognize, terminate: mocks.terminate }));
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("creates an English-only worker and returns the recognised text", async () => {
    const { runOcr } = await loadFreshModule();
    const image = Buffer.from("fake-png-bytes");
    mocks.recognize.mockResolvedValueOnce({ data: { text: "Tab Amlong 5mg OD\n", confidence: 87, blocks: null } });

    const text = await runOcr(image);

    expect(text).toBe("Tab Amlong 5mg OD\n");
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.createWorker).toHaveBeenCalledWith("eng", undefined, { errorHandler: expect.any(Function) });
    // Word boxes are requested so the V2 path gets confidences; text is still text.
    expect(mocks.recognize).toHaveBeenCalledWith(expect.any(Buffer), {}, { text: true, blocks: true });
    expect(Buffer.from(mocks.recognize.mock.calls[0]![0] as Buffer).equals(image)).toBe(true);
  });

  it("registers an engine error handler, so an unreadable page cannot crash the process", async () => {
    // tesseract.js rejects the job's promise AND, without a handler, throws
    // from its message listener where nothing can catch it. A truncated
    // JPEG took the worker down that way on 2026-09-06.
    const { runOcr } = await loadFreshModule();
    mocks.recognize.mockResolvedValueOnce({ data: { text: "", confidence: 0, blocks: null } });
    await runOcr(Buffer.from("x"));
    const options = mocks.createWorker.mock.calls[0]?.[2] as { errorHandler: (e: unknown) => void };
    expect(() => options.errorHandler(new Error("Error attempting to read image."))).not.toThrow();
    expect(() => options.errorHandler("Premature end of JPEG file")).not.toThrow();
  });

  it("reuses one worker across calls (lazy singleton) even when calls overlap", async () => {
    const { runOcr } = await loadFreshModule();
    mocks.recognize.mockResolvedValue({ data: { text: "same", confidence: 50, blocks: null } });

    await Promise.all([runOcr(Buffer.from("a")), runOcr(Buffer.from("b"))]);
    await runOcr(Buffer.from("c"));

    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.recognize).toHaveBeenCalledTimes(3);
  });

  it("propagates recognition errors so the job is retried/dead-lettered, not silently empty", async () => {
    const { runOcr } = await loadFreshModule();
    mocks.recognize.mockRejectedValueOnce(new Error("image decode failed"));
    await expect(runOcr(Buffer.alloc(1))).rejects.toThrow("image decode failed");
  });
});

describe("TesseractOcrProvider", () => {
  beforeEach(() => {
    mocks.recognize.mockReset().mockImplementation(async () => ({ data: enginePage() }));
    mocks.terminate.mockReset().mockResolvedValue(undefined);
    mocks.createWorker.mockReset().mockImplementation(async () => ({ recognize: mocks.recognize, terminate: mocks.terminate }));
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("surfaces engine confidence on 0–1 for the page, each line and each word (docs_v2/16 §3 defect 5)", async () => {
    const { TesseractOcrProvider } = await loadFreshModule();
    const result = await new TesseractOcrProvider().recognize({ bytes: TINY_PNG, contentType: "image/png", pageNumber: 1 });
    expect(result.confidence).toBe(0.8475);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.confidence).toBe(0.8475);
    expect(result.words.map((w) => w.confidence)).toEqual([0.91, 0.785]);
    expect(result.engine).toBe("tesseract.js");
    expect(result.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("normalizes pixel boxes against the image header (1×1 png → boxes clamp into the page)", async () => {
    const { toOcrResult, OCR_ENGINE, OCR_ENGINE_VERSION } = await loadFreshModule();
    const result = toOcrResult(enginePage(), { width: 200, height: 100 }, { engine: OCR_ENGINE, engineVersion: OCR_ENGINE_VERSION });
    expect(result.words[0]?.box).toEqual({ x: 0.05, y: 0.1, w: 0.2, h: 0.2 });
    expect(result.words[1]?.box).toEqual({ x: 0.3, y: 0.1, w: 0.45, h: 0.2 });
    expect(result.lines[0]?.box).toEqual({ x: 0.05, y: 0.1, w: 0.7, h: 0.2 });
    expect(result.width).toBe(200);
  });

  it("falls back to the words' own extent when the image size is unknown, so boxes still land in 0–1", async () => {
    const { toOcrResult } = await loadFreshModule();
    const result = toOcrResult(enginePage(), undefined, { engine: "e", engineVersion: "1" });
    for (const w of result.words) {
      expect(w.box.x + w.box.w).toBeLessThanOrEqual(1);
      expect(w.box.y + w.box.h).toBeLessThanOrEqual(1);
    }
    expect(result.words[1]!.box.x + result.words[1]!.box.w).toBe(1);
  });

  it("still returns per-line text when the engine gave no block output", async () => {
    const { toOcrResult } = await loadFreshModule();
    const result = toOcrResult({ text: "line one\n\nline two\n", confidence: 60, blocks: null }, undefined, { engine: "e", engineVersion: "1" });
    expect(result.lines.map((l) => l.text)).toEqual(["line one", "line two"]);
    expect(result.lines.every((l) => l.confidence === 0.6)).toBe(true);
    expect(result.words).toEqual([]);
  });

  it("rejects a page larger than its declared limit before touching the engine", async () => {
    const { TesseractOcrProvider, TESSERACT_MAX_INPUT_BYTES } = await loadFreshModule();
    const provider = new TesseractOcrProvider();
    const oversize = new Uint8Array(TESSERACT_MAX_INPUT_BYTES + 1);
    await expect(provider.recognize({ bytes: oversize, contentType: "image/png", pageNumber: 1 })).rejects.toThrow(/too large/);
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });

  describe("vendor contract checklist (docs_v2/06 P3-2)", () => {
    const checks = ocrProviderContract({
      create: async () => new (await loadFreshModule()).TesseractOcrProvider(),
      sample: { bytes: TINY_PNG, contentType: "image/png" },
    });

    it.each(checks.map((c) => [c.name, c] as const))("%s", async (_name, check) => {
      await expect(check.run()).resolves.toBeUndefined();
    });
  });
});

describe("terminateOcrWorker", () => {
  beforeEach(() => {
    mocks.recognize.mockReset().mockResolvedValue({ data: { text: "", confidence: 0, blocks: null } });
    mocks.terminate.mockReset().mockResolvedValue(undefined);
    mocks.createWorker.mockReset().mockImplementation(async () => ({ recognize: mocks.recognize, terminate: mocks.terminate }));
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("is a no-op when no worker was ever started", async () => {
    const { terminateOcrWorker } = await loadFreshModule();
    await terminateOcrWorker();
    expect(mocks.createWorker).not.toHaveBeenCalled();
    expect(mocks.terminate).not.toHaveBeenCalled();
  });

  it("terminates the worker and lets the next call start a fresh one", async () => {
    const { runOcr, terminateOcrWorker } = await loadFreshModule();

    await runOcr(Buffer.alloc(1));
    await terminateOcrWorker();
    expect(mocks.terminate).toHaveBeenCalledTimes(1);

    await terminateOcrWorker(); // idempotent
    expect(mocks.terminate).toHaveBeenCalledTimes(1);

    await runOcr(Buffer.alloc(1));
    expect(mocks.createWorker).toHaveBeenCalledTimes(2);
  });
});

describe("engine provenance", () => {
  it("records a stable engine name/version, and the provider carries the same", async () => {
    const { OCR_ENGINE, OCR_ENGINE_VERSION, TesseractOcrProvider } = await loadFreshModule();
    expect(OCR_ENGINE).toBe("tesseract.js");
    expect(OCR_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const provider = new TesseractOcrProvider();
    expect(provider.engine).toBe(OCR_ENGINE);
    expect(provider.engineVersion).toBe(OCR_ENGINE_VERSION);
  });
});
