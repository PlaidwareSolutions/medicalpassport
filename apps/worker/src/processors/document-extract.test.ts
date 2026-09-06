import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@medpass/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));

import { writeAudit } from "@medpass/audit";
import { combine, MATCH_QUALITY, NullDocumentAiProvider, type OcrWord } from "@medpass/document-intelligence";
import { processDocumentExtract } from "./document-extract";
import { encodeOcrTextObject } from "./ocr-text-object";
import { fakePrisma, fakeStorage, type FakeDocument } from "./document-fakes";

const PRESCRIPTION_TEXT = [
  "Sunrise Clinic, Jubilee Hills",
  "Dr. A K Sharma, MBBS, MD",
  "Regn. No: TSMC/12345",
  "Date: 12/03/2026",
  "Rx",
  "Tab Glycomet 500mg  1-0-1  after food  x 30 days",
].join("\n");

const PRODUCTS = [{ id: "product-glycomet", genericName: "Metformin", brand: { name: "Glycomet", aliases: [] } }];

function documentFixture(overrides: Partial<FakeDocument> = {}): FakeDocument {
  return {
    id: "doc-1",
    patientProfileId: "profile-1",
    kind: "prescription",
    classifiedBy: "deterministic",
    pages: [
      {
        id: "page-1",
        pageNumber: 1,
        storedObjectId: "so-1",
        ocrTextObjectId: "text-1",
        storedObject: { id: "so-1", bucket: "patient_docs", objectKey: "key-1", contentType: "image/png", status: "verified" },
      },
    ],
    ...overrides,
  };
}

function setup(document = documentFixture()) {
  const prisma = fakePrisma({
    document,
    storedObjects: [
      ...document.pages.map((p) => p.storedObject),
      { id: "text-1", bucket: "ocr_tmp", objectKey: "ocr/key-1", contentType: "text/plain", status: "verified" },
      { id: "text-2", bucket: "ocr_tmp", objectKey: "ocr/key-2", contentType: "text/plain", status: "verified" },
    ],
    products: PRODUCTS,
  });
  const storage = fakeStorage(
    new Map([
      ["ocr/key-1", Buffer.from(PRESCRIPTION_TEXT, "utf8")],
      ["ocr/key-2", Buffer.from("Advice: review after 4 weeks", "utf8")],
    ]),
  );
  return { prisma, storage };
}

const payload = {
  documentId: "doc-1",
  profileId: "profile-1",
  actorUserId: "user-1",
  actorType: "patient" as const,
  correlationId: "corr-1",
};

const DEPS = { documentAi: new NullDocumentAiProvider() };

function candidatesOf(prisma: ReturnType<typeof fakePrisma>) {
  return prisma.created.candidates as Array<Record<string, unknown>>;
}

describe("processDocumentExtract", () => {
  beforeEach(() => {
    vi.mocked(writeAudit).mockClear();
  });

  it("records the extraction run with the package's own engine name and version", async () => {
    const { prisma, storage } = setup();
    await processDocumentExtract(prisma, storage, payload, DEPS);

    expect(prisma.created.extractions[0]).toMatchObject({
      documentId: "doc-1",
      engine: "deterministic-extractor",
      engineVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/) as unknown as string,
      status: "running",
    });
    // Deterministic extraction has no model behind it; claiming one would be a
    // false provenance record (docs_v2/09 §8).
    expect(prisma.created.extractions[0]).not.toHaveProperty("modelProvider");
  });

  it("proposes the catalog-matched medicine from the printed line, citing that exact line", async () => {
    const { prisma, storage } = setup();
    await processDocumentExtract(prisma, storage, payload, DEPS);

    const brand = candidatesOf(prisma).find((c) => c.targetEntity === "medication" && c.targetField === "brandName");
    expect(brand).toBeDefined();
    expect(brand!.proposedValue).toMatchObject({ productId: "product-glycomet", label: "Glycomet" });
    expect(String(brand!.detectedText)).toContain("Glycomet");
    expect(brand!.pageNumber).toBe(1);
    expect(Number(brand!.confidence)).toBeGreaterThan(0.5);
    expect(brand!.patientProfileId).toBe("profile-1");
  });

  it("reads frequency, food and duration off the same line and groups them together", async () => {
    const { prisma, storage } = setup();
    await processDocumentExtract(prisma, storage, payload, DEPS);

    const medication = candidatesOf(prisma).filter((c) => c.targetEntity === "medication");
    const byField = Object.fromEntries(medication.map((c) => [c.targetField, c]));
    expect(byField.frequency?.proposedValue).toMatchObject({ code: "PATTERN", pattern: "1-0-1" });
    expect(byField.foodInstruction?.proposedValue).toBe("after");
    expect(byField.durationDays?.proposedValue).toBe(30);
    // One line, one group — so the UI can show these fields against one crop (H-36).
    expect(new Set(medication.map((c) => c.groupKey)).size).toBe(1);
  });

  it("never proposes a dose quantity from a photo (docs_v2/09 §1 rule 4, H-02)", async () => {
    const { prisma, storage } = setup();
    await processDocumentExtract(prisma, storage, payload, DEPS);

    expect(candidatesOf(prisma).some((c) => c.targetField === "doseQuantity")).toBe(false);
    expect(candidatesOf(prisma).some((c) => c.targetField === "interpretation")).toBe(false);
  });

  it("marks the extraction succeeded and the document processed", async () => {
    const { prisma, storage } = setup();
    await processDocumentExtract(prisma, storage, payload, DEPS);

    expect(prisma.updated.extractions[0]).toMatchObject({ data: { status: "succeeded" } });
    expect(prisma.updated.documents[0]).toMatchObject({ data: { status: "processed" } });

    const entry = vi.mocked(writeAudit).mock.calls[0]?.[1] as { action: string; context: Record<string, unknown> };
    expect(entry.action).toBe("extraction.processed");
    expect(entry.context.candidateCount).toBe(candidatesOf(prisma).length);
    // Counts and reason codes only — the dropped drafts hold page text.
    expect(JSON.stringify(entry.context)).not.toMatch(/glycomet|sharma/i);
  });

  it("reads every page's stored text, so a two-page document is extracted as one document", async () => {
    const document = documentFixture();
    document.pages.push({
      id: "page-2",
      pageNumber: 2,
      storedObjectId: "so-2",
      ocrTextObjectId: "text-2",
      storedObject: { id: "so-2", bucket: "patient_docs", objectKey: "key-2", contentType: "image/png", status: "verified" },
    });
    const { prisma, storage } = setup(document);
    await processDocumentExtract(prisma, storage, payload, DEPS);

    expect(storage.getObjectBytes).toHaveBeenCalledTimes(2);
    expect(prisma.created.extractions).toHaveLength(1);
  });

  it("fails the extraction and the document when the text can't be read, instead of storing an empty run", async () => {
    const { prisma } = setup();
    const storage = fakeStorage(new Map());

    await expect(processDocumentExtract(prisma, storage, payload, DEPS)).rejects.toThrow();
    expect(prisma.updated.extractions[0]).toMatchObject({ data: { status: "failed" } });
    expect(prisma.updated.documents[0]).toMatchObject({ data: { status: "failed" } });
  });
});

describe("OCR confidence flows into candidates (docs_v2/16 §3 defect 5)", () => {
  function wordsFor(text: string, confidence: number): OcrWord[] {
    return text.split("\n").flatMap((line, row) =>
      line.split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, confidence, box: { x: Math.min(0.9, i * 0.1), y: row * 0.05, w: 0.08, h: 0.04 } })),
    );
  }

  function setupWith(body: Buffer) {
    const document = documentFixture();
    const prisma = fakePrisma({
      document,
      storedObjects: [
        ...document.pages.map((p) => p.storedObject),
        { id: "text-1", bucket: "ocr_tmp", objectKey: "ocr/key-1", contentType: "application/json", status: "verified" },
      ],
      products: PRODUCTS,
    });
    return { prisma, storage: fakeStorage(new Map([["ocr/key-1", body]])) };
  }

  it("uses the stored word confidences: a blurry page yields low-confidence candidates with boxes", async () => {
    const body = encodeOcrTextObject({
      version: 1,
      text: PRESCRIPTION_TEXT,
      words: wordsFor(PRESCRIPTION_TEXT, 0.5),
      confidence: 0.5,
      engine: "tesseract.js",
      engineVersion: "7.0.0",
      pdfTextLayer: false,
    });
    const { prisma, storage } = setupWith(body);
    await processDocumentExtract(prisma, storage, payload, DEPS);

    const frequency = candidatesOf(prisma).find((c) => c.targetField === "frequency");
    expect(frequency?.confidence).toBe(combine(0.5, MATCH_QUALITY.frequencyPattern));
    expect(frequency?.boundingBox).toMatchObject({ x: expect.any(Number), w: expect.any(Number) });
    const entry = vi.mocked(writeAudit).mock.calls.at(-1)?.[1] as { context: Record<string, unknown> };
    expect(entry.context.pagesWithWordBoxes).toBe(1);
  });

  it("uses the page-level confidence when the engine gave text but no word boxes", async () => {
    const body = encodeOcrTextObject({ version: 1, text: PRESCRIPTION_TEXT, words: [], confidence: 0.7, engine: "e", engineVersion: "1", pdfTextLayer: false });
    const { prisma, storage } = setupWith(body);
    await processDocumentExtract(prisma, storage, payload, DEPS);
    const frequency = candidatesOf(prisma).find((c) => c.targetField === "frequency");
    expect(frequency?.confidence).toBe(combine(0.7, MATCH_QUALITY.frequencyPattern));
  });

  it("still reads a legacy plain-text object written before word boxes were stored", async () => {
    const { prisma, storage } = setupWith(Buffer.from(PRESCRIPTION_TEXT, "utf8"));
    await processDocumentExtract(prisma, storage, payload, DEPS);
    expect(candidatesOf(prisma).some((c) => c.targetField === "brandName")).toBe(true);
  });

  it("records no model provenance with the null AI provider — an honest extraction row", async () => {
    const { prisma, storage } = setup();
    await processDocumentExtract(prisma, storage, payload, DEPS);
    const row = prisma.created.extractions[0] as Record<string, unknown>;
    expect(row.modelProvider).toBeUndefined();
    expect(row.engine).toBe("deterministic-extractor");
  });
});
