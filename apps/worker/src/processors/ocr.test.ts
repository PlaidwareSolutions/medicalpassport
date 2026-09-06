import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// tesseract.js spawns a child process and downloads traineddata on first
// use — the boundary is mocked; what this module owns is the language
// selection, the one-worker-per-process lifecycle and the text plumbing.
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
    mocks.recognize.mockResolvedValueOnce({ data: { text: "Tab Amlong 5mg OD\n", confidence: 87 } });

    const text = await runOcr(image);

    expect(text).toBe("Tab Amlong 5mg OD\n");
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.createWorker).toHaveBeenCalledWith("eng", undefined, { errorHandler: expect.any(Function) });
    expect(mocks.recognize).toHaveBeenCalledWith(image);
  });

  it("registers an engine error handler, so an unreadable page cannot crash the process", async () => {
    // tesseract.js rejects the job's promise AND, without a handler, throws
    // from its message listener where nothing can catch it. A truncated
    // JPEG took the worker down that way on 2026-09-06.
    const { runOcr } = await loadFreshModule();
    mocks.recognize.mockResolvedValueOnce({ data: { text: "", confidence: 0 } });
    await runOcr(Buffer.from("x"));
    const options = mocks.createWorker.mock.calls[0]?.[2] as { errorHandler: (e: unknown) => void };
    expect(() => options.errorHandler(new Error("Error attempting to read image."))).not.toThrow();
    expect(() => options.errorHandler("Premature end of JPEG file")).not.toThrow();
  });

  it("returns only the text — engine confidence is not surfaced to callers", async () => {
    // Candidate detection assigns its own fixed per-rule confidences; the
    // OCR-level score is dropped here. Pinned so a future change to plumb
    // it through is a deliberate one.
    const { runOcr } = await loadFreshModule();
    mocks.recognize.mockResolvedValueOnce({ data: { text: "x", confidence: 12 } });
    const result: string = await runOcr(Buffer.alloc(1));
    expect(result).toBe("x");
  });

  it("reuses one worker across calls (lazy singleton) even when calls overlap", async () => {
    const { runOcr } = await loadFreshModule();
    mocks.recognize.mockResolvedValue({ data: { text: "same", confidence: 50 } });

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

describe("terminateOcrWorker", () => {
  beforeEach(() => {
    mocks.recognize.mockReset().mockResolvedValue({ data: { text: "", confidence: 0 } });
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
  it("records a stable engine name/version", async () => {
    const { OCR_ENGINE, OCR_ENGINE_VERSION } = await loadFreshModule();
    expect(OCR_ENGINE).toBe("tesseract.js");
    expect(OCR_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
