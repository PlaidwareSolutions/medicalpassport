import { describe, expect, it, vi } from "vitest";

// The Tesseract adapter is constructed lazily; nothing here should start an engine.
vi.mock("tesseract.js", () => ({ createWorker: vi.fn() }));

import { documentAiProviders, ocrProviders, resolveProviders } from "./providers";

describe("provider registries (docs_v2/06 P3-2)", () => {
  it("ship tesseract and the null AI provider as the only adapters", () => {
    expect(ocrProviders.names()).toEqual(["tesseract"]);
    expect(documentAiProviders.names()).toEqual(["null"]);
  });

  it("resolve the configured defaults", () => {
    const providers = resolveProviders({ OCR_PROVIDER: "tesseract", DOCUMENT_AI_PROVIDER: "null" });
    expect(providers.ocr.engine).toBe("tesseract.js");
    expect(providers.documentAi.provenance.provider).toBe("null");
  });

  it("fail loudly on an unknown name, listing what is registered", () => {
    expect(() => resolveProviders({ OCR_PROVIDER: "vendor-x", DOCUMENT_AI_PROVIDER: "null" })).toThrow(/"vendor-x" is not registered \(known: tesseract\)/);
    expect(() => resolveProviders({ OCR_PROVIDER: "tesseract", DOCUMENT_AI_PROVIDER: "gpt" })).toThrow(/"gpt" is not registered \(known: null\)/);
  });
});
