import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@medpass/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("./pdf-text", () => ({
  PDF_TEXT_ENGINE: "pdf-parse",
  PDF_TEXT_ENGINE_VERSION: "1.1.1",
  extractPdfText: vi.fn(async () => "PDF TEXT"),
}));

import { writeAudit } from "@medpass/audit";
import type { MalwareScanner, OcrInput, OcrProvider, OcrResult } from "@medpass/document-intelligence";
import { processDocumentClassify, type DocumentClassifyDeps } from "./document-classify";
import { fakePrisma, fakeStorage, type FakeDocument } from "./document-fakes";
import { decodeOcrTextObject } from "./ocr-text-object";
import { extractPdfText } from "./pdf-text";

const PRESCRIPTION_PAGE_1 = [
  "Sunrise Clinic, Jubilee Hills",
  "Dr. A K Sharma, MBBS, MD",
  "Regn. No: TSMC/12345",
  "Date: 12/03/2026",
  "Rx",
  "Tab Glycomet 500mg  1-0-1  after food  x 30 days",
].join("\n");

const PRESCRIPTION_PAGE_2 = ["Advice", "Review after 4 weeks", "Tab Ecosprin 75mg  0-0-1  after food"].join("\n");

/** An OCR provider stand-in: returns the queued texts in order, with one word box per token. */
function fakeOcr(texts: string[] = [PRESCRIPTION_PAGE_1, PRESCRIPTION_PAGE_2], confidence = 0.82) {
  const calls: OcrInput[] = [];
  let next = 0;
  const provider: OcrProvider & { calls: OcrInput[] } = {
    engine: "fake-ocr",
    engineVersion: "9.9.9",
    maxInputBytes: 1024 * 1024,
    calls,
    async recognize(input): Promise<OcrResult> {
      calls.push(input);
      const text = texts[Math.min(next, texts.length - 1)] ?? "";
      next += 1;
      const lines = text.split("\n").map((line, row) => {
        const words = line.split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, confidence, box: { x: Math.min(0.9, i * 0.1), y: row * 0.05, w: 0.08, h: 0.04 } }));
        return { text: line, confidence, words };
      });
      return { text, lines, words: lines.flatMap((l) => l.words), confidence, engine: "fake-ocr", engineVersion: "9.9.9" };
    },
  };
  return provider;
}

function cleanScanner(): MalwareScanner & { scanned: Array<{ bytes: Uint8Array; contentType: string }> } {
  const scanned: Array<{ bytes: Uint8Array; contentType: string }> = [];
  return {
    engine: "fake-scanner",
    engineVersion: "0.1",
    scanned,
    async scan(bytes, contentType) {
      scanned.push({ bytes, contentType });
      return { verdict: "clean", engine: "fake-scanner", engineVersion: "0.1" };
    },
  };
}

function infectedScanner(onKey: string, reason = "Eicar-Test-Signature"): MalwareScanner {
  return {
    engine: "fake-scanner",
    engineVersion: "0.1",
    async scan(bytes) {
      const infected = bytes.toString() === onKey;
      return infected
        ? { verdict: "infected", reason, engine: "fake-scanner", engineVersion: "0.1" }
        : { verdict: "clean", engine: "fake-scanner", engineVersion: "0.1" };
    },
  };
}

function documentFixture(overrides: Partial<FakeDocument> = {}): FakeDocument {
  return {
    id: "doc-1",
    patientProfileId: "profile-1",
    kind: "other",
    classifiedBy: null,
    pages: [
      {
        id: "page-1",
        pageNumber: 1,
        storedObjectId: "so-1",
        ocrTextObjectId: null,
        storedObject: { id: "so-1", bucket: "patient_docs", objectKey: "key-1", contentType: "image/png", status: "verified" },
      },
      {
        id: "page-2",
        pageNumber: 2,
        storedObjectId: "so-2",
        ocrTextObjectId: null,
        storedObject: { id: "so-2", bucket: "patient_docs", objectKey: "key-2", contentType: "image/png", status: "verified" },
      },
    ],
    ...overrides,
  };
}

function storageWithPages() {
  return fakeStorage(
    new Map([
      ["key-1", Buffer.from("page one bytes")],
      ["key-2", Buffer.from("page two bytes")],
    ]),
  );
}

const payload = {
  documentId: "doc-1",
  profileId: "profile-1",
  actorUserId: "user-1",
  actorType: "patient" as const,
  correlationId: "corr-1",
};

function deps(overrides: Partial<DocumentClassifyDeps> = {}): DocumentClassifyDeps {
  return { scanner: cleanScanner(), ocr: fakeOcr(), ...overrides };
}

describe("processDocumentClassify", () => {
  beforeEach(() => {
    vi.mocked(extractPdfText).mockClear();
    vi.mocked(writeAudit).mockClear();
  });

  it("OCRs every verified page, stores each page's text + word boxes as its own ocr-tmp object, and points the page at it", async () => {
    const prisma = fakePrisma({ document: documentFixture() });
    const storage = storageWithPages();
    const ocr = fakeOcr();

    await processDocumentClassify(prisma, storage, payload, deps({ ocr }));

    expect(ocr.calls.map((c) => c.pageNumber)).toEqual([1, 2]);
    expect(ocr.calls[0]?.contentType).toBe("image/png");
    expect(storage.puts).toHaveLength(2);
    // Derived text lives in the 48 h bucket, never beside the original.
    expect(storage.puts.every((p) => p.bucket === "ocr-tmp")).toBe(true);
    const first = decodeOcrTextObject(storage.puts[0]!.body);
    expect(first.text).toBe(PRESCRIPTION_PAGE_1);
    expect("version" in first && first.words.length).toBeGreaterThan(5);
    expect("version" in first && first.confidence).toBe(0.82);
    expect("version" in first && first.engine).toBe("fake-ocr");
    expect(decodeOcrTextObject(storage.puts[1]!.body).text).toBe(PRESCRIPTION_PAGE_2);

    expect(prisma.created.storedObjects).toHaveLength(2);
    expect(prisma.created.storedObjects[0]).toMatchObject({ bucket: "ocr_tmp", contentType: "application/json", status: "verified" });
    // No PHI in the key (docs_v2/09 §9).
    expect(String(prisma.created.storedObjects[0]?.objectKey)).not.toMatch(/glycomet|sharma/i);
    expect(prisma.updated.pages).toHaveLength(2);
    expect(prisma.updated.pages[0]).toMatchObject({ where: { id: "page-1" }, data: { ocrTextObjectId: "obj-1" } });
  });

  it("classifies the whole document and enqueues extraction", async () => {
    const prisma = fakePrisma({ document: documentFixture() });
    await processDocumentClassify(prisma, storageWithPages(), payload, deps());

    const update = prisma.updated.documents[0]?.data as Record<string, unknown>;
    expect(update.classification).toBe("prescription");
    expect(update.kind).toBe("prescription");
    expect(update.classifiedBy).toBe("deterministic");
    expect(Number(update.classificationConfidence)).toBeGreaterThan(0.5);

    expect(prisma.created.backgroundJobs).toHaveLength(1);
    expect(prisma.created.backgroundJobs[0]).toMatchObject({ queue: "document_extract" });
    expect(String(prisma.created.backgroundJobs[0]?.jobKey)).toContain("document-extract:doc-1");
  });

  it("never overwrites a kind the patient chose (docs_v2/09 §4)", async () => {
    const prisma = fakePrisma({
      document: documentFixture({ kind: "discharge_summary", classifiedBy: "user" }),
    });
    await processDocumentClassify(prisma, storageWithPages(), payload, deps());

    const update = prisma.updated.documents[0]?.data as Record<string, unknown>;
    // The classifier's opinion is still recorded, for the accuracy metrics…
    expect(update.classification).toBeDefined();
    // …but the effective kind and its authorship are untouched.
    expect(update).not.toHaveProperty("kind");
    expect(update).not.toHaveProperty("classifiedBy");
  });

  it("prefers a PDF's text layer over OCR and records that engine's provenance", async () => {
    const document = documentFixture();
    document.pages = [
      {
        ...document.pages[0]!,
        storedObject: { ...document.pages[0]!.storedObject, contentType: "application/pdf" },
      },
    ];
    const prisma = fakePrisma({ document });
    const ocr = fakeOcr();
    const storage = storageWithPages();
    await processDocumentClassify(prisma, storage, payload, deps({ ocr }));

    expect(extractPdfText).toHaveBeenCalledTimes(1);
    expect(ocr.calls).toHaveLength(0);
    const stored = decodeOcrTextObject(storage.puts[0]!.body);
    expect("version" in stored && stored.pdfTextLayer).toBe(true);
    expect("version" in stored && stored.engine).toBe("pdf-parse");
    const entry = vi.mocked(writeAudit).mock.calls[0]?.[1] as { context: Record<string, unknown> };
    expect(entry.context.engine).toBe("pdf-parse");
  });

  it("skips pages whose object never passed verification", async () => {
    const document = documentFixture();
    document.pages[1]!.storedObject.status = "quarantined";
    const prisma = fakePrisma({ document });
    const ocr = fakeOcr();
    await processDocumentClassify(prisma, storageWithPages(), payload, deps({ ocr }));

    expect(ocr.calls).toHaveLength(1);
    expect(prisma.created.storedObjects).toHaveLength(1);
  });

  it("re-uses a page's existing text object on a re-run rather than orphaning it", async () => {
    const document = documentFixture();
    document.pages = [{ ...document.pages[0]!, ocrTextObjectId: "existing-text" }];
    const prisma = fakePrisma({
      document,
      storedObjects: [
        document.pages[0]!.storedObject,
        { id: "existing-text", bucket: "ocr_tmp", objectKey: "ocr/key", contentType: "text/plain", status: "verified" },
      ],
    });
    const storage = storageWithPages();
    await processDocumentClassify(prisma, storage, payload, deps());

    expect(prisma.created.storedObjects).toHaveLength(0);
    expect(storage.puts[0]?.objectKey).toBe("ocr/key");
    expect(prisma.updated.storedObjects[0]).toMatchObject({ where: { id: "existing-text" } });
  });

  it("audits the classification with signal ids and the provider's engine/version — never page text", async () => {
    const prisma = fakePrisma({ document: documentFixture() });
    await processDocumentClassify(prisma, storageWithPages(), payload, deps());

    const entry = vi.mocked(writeAudit).mock.calls[0]?.[1] as { action: string; context: Record<string, unknown> };
    expect(entry.action).toBe("document.classified");
    expect(entry.context.keptUserKind).toBe(false);
    expect(entry.context.engine).toBe("fake-ocr");
    expect(entry.context.engineVersion).toBe("9.9.9");
    expect(entry.context.scanner).toBe("fake-scanner");
    expect(JSON.stringify(entry.context)).not.toMatch(/glycomet|sharma|jubilee/i);
  });

  describe("malware scan (docs_v2/06 P3-3)", () => {
    it("scans every page's bytes with its declared type before any OCR runs", async () => {
      const prisma = fakePrisma({ document: documentFixture() });
      const scanner = cleanScanner();
      const ocr = fakeOcr();
      await processDocumentClassify(prisma, storageWithPages(), payload, { scanner, ocr });

      expect(scanner.scanned.map((s) => s.bytes.toString())).toEqual(["page one bytes", "page two bytes"]);
      expect(scanner.scanned.every((s) => s.contentType === "image/png")).toBe(true);
      expect(ocr.calls).toHaveLength(2);
    });

    it("quarantines the document on an infected page: object + document flagged, audited, no OCR, no extraction", async () => {
      const prisma = fakePrisma({ document: documentFixture() });
      const storage = storageWithPages();
      const ocr = fakeOcr();
      await processDocumentClassify(prisma, storage, payload, { scanner: infectedScanner("page two bytes"), ocr });

      // Page 2 is infected: page 1 was scanned clean but OCR never ran on either.
      expect(ocr.calls).toHaveLength(0);
      expect(storage.puts).toHaveLength(0);
      expect(prisma.created.backgroundJobs).toHaveLength(0);

      expect(prisma.updated.storedObjects).toEqual([expect.objectContaining({ where: { id: "so-2" }, data: { status: "quarantined" } })]);
      expect(prisma.updated.documents).toEqual([expect.objectContaining({ where: { id: "doc-1" }, data: { status: "quarantined" } })]);

      const entry = vi.mocked(writeAudit).mock.calls[0]?.[1] as { action: string; entityId: string; context: Record<string, unknown> };
      expect(entry.action).toBe("document.quarantined");
      expect(entry.entityId).toBe("doc-1");
      expect(entry.context).toMatchObject({ pageNumber: 2, reason: "Eicar-Test-Signature", engine: "fake-scanner", engineVersion: "0.1" });
    });

    it("keeps the page bytes (nothing is deleted) and does not throw — the job is done, not failed", async () => {
      const prisma = fakePrisma({ document: documentFixture() });
      const storage = storageWithPages();
      await expect(
        processDocumentClassify(prisma, storage, payload, { scanner: infectedScanner("page one bytes"), ocr: fakeOcr() }),
      ).resolves.toBeUndefined();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("a scanner failure (daemon down) fails the job so it retries — never an unscanned page", async () => {
      const prisma = fakePrisma({ document: documentFixture() });
      const scanner: MalwareScanner = {
        engine: "clamav",
        engineVersion: "x",
        async scan() {
          throw new Error("clamd: connect ECONNREFUSED");
        },
      };
      const ocr = fakeOcr();
      await expect(processDocumentClassify(prisma, storageWithPages(), payload, { scanner, ocr })).rejects.toThrow(/ECONNREFUSED/);
      expect(ocr.calls).toHaveLength(0);
      expect(prisma.updated.documents).toHaveLength(0);
    });
  });
});
