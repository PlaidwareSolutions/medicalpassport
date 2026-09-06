import { beforeEach, describe, expect, it, vi } from "vitest";
import pdfParse from "pdf-parse";
import { PDF_TEXT_ENGINE, PDF_TEXT_ENGINE_VERSION, extractPdfText } from "./pdf-text";

// pdf-parse is the library boundary: mocked so the test never depends on
// pdf.js's font/worker machinery. What this module owns is the plumbing —
// bytes in, the text layer out, nothing else from the parse result.
vi.mock("pdf-parse", () => ({ default: vi.fn() }));

const mockedParse = vi.mocked(pdfParse);

describe("extractPdfText", () => {
  beforeEach(() => {
    mockedParse.mockReset();
  });

  it("passes the raw buffer to pdf-parse and returns only the text layer", async () => {
    const bytes = Buffer.from("%PDF-1.4 fake");
    mockedParse.mockResolvedValueOnce({
      numpages: 1,
      numrender: 1,
      info: { Producer: "clinic-system" },
      metadata: null,
      version: "default",
      text: "Tab Glycomet 500\n1-0-1 after food\n",
    });

    const text = await extractPdfText(bytes);

    expect(text).toBe("Tab Glycomet 500\n1-0-1 after food\n");
    expect(mockedParse).toHaveBeenCalledTimes(1);
    expect(mockedParse.mock.calls[0]?.[0]).toBe(bytes);
    // No options: every page is parsed with the library's default renderer.
    expect(mockedParse.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("returns an empty string for a PDF with no text layer (scanned image) rather than inventing text", async () => {
    mockedParse.mockResolvedValueOnce({ numpages: 1, numrender: 1, info: {}, metadata: null, version: "default", text: "" });
    await expect(extractPdfText(Buffer.alloc(0))).resolves.toBe("");
  });

  it("propagates parse failures so the job fails instead of storing an empty extraction", async () => {
    mockedParse.mockRejectedValueOnce(new Error("Invalid PDF structure"));
    await expect(extractPdfText(Buffer.from("not a pdf"))).rejects.toThrow("Invalid PDF structure");
  });

  it("records a stable engine name/version for extraction provenance", () => {
    expect(PDF_TEXT_ENGINE).toBe("pdf-parse");
    expect(PDF_TEXT_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
