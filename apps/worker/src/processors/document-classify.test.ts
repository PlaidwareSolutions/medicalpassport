import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@medpass/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("./ocr", () => ({
  OCR_ENGINE: "tesseract.js",
  OCR_ENGINE_VERSION: "7.0.0",
  runOcr: vi.fn(async () => "OCR TEXT"),
}));
vi.mock("./pdf-text", () => ({
  PDF_TEXT_ENGINE: "pdf-parse",
  PDF_TEXT_ENGINE_VERSION: "1.1.1",
  extractPdfText: vi.fn(async () => "PDF TEXT"),
}));

import { writeAudit } from "@medpass/audit";
import { processDocumentClassify } from "./document-classify";
import { fakePrisma, fakeStorage, type FakeDocument } from "./document-fakes";
import { runOcr } from "./ocr";
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

describe("processDocumentClassify", () => {
  beforeEach(() => {
    vi.mocked(runOcr).mockClear();
    vi.mocked(extractPdfText).mockClear();
    vi.mocked(writeAudit).mockClear();
    vi.mocked(runOcr).mockImplementation(async () => PRESCRIPTION_PAGE_1);
  });

  it("OCRs every verified page, stores each page's text as its own ocr-tmp object, and points the page at it", async () => {
    const prisma = fakePrisma({ document: documentFixture() });
    const storage = storageWithPages();
    vi.mocked(runOcr)
      .mockImplementationOnce(async () => PRESCRIPTION_PAGE_1)
      .mockImplementationOnce(async () => PRESCRIPTION_PAGE_2);

    await processDocumentClassify(prisma, storage, payload);

    expect(runOcr).toHaveBeenCalledTimes(2);
    expect(storage.puts).toHaveLength(2);
    // Derived text lives in the 48 h bucket, never beside the original.
    expect(storage.puts.every((p) => p.bucket === "ocr-tmp")).toBe(true);
    expect(storage.puts[0]?.body.toString("utf8")).toBe(PRESCRIPTION_PAGE_1);
    expect(storage.puts[1]?.body.toString("utf8")).toBe(PRESCRIPTION_PAGE_2);

    expect(prisma.created.storedObjects).toHaveLength(2);
    expect(prisma.created.storedObjects[0]).toMatchObject({ bucket: "ocr_tmp", contentType: "text/plain", status: "verified" });
    // No PHI in the key (docs_v2/09 §9).
    expect(String(prisma.created.storedObjects[0]?.objectKey)).not.toMatch(/glycomet|sharma/i);
    expect(prisma.updated.pages).toHaveLength(2);
    expect(prisma.updated.pages[0]).toMatchObject({ where: { id: "page-1" }, data: { ocrTextObjectId: "obj-1" } });
  });

  it("classifies the whole document and enqueues extraction", async () => {
    const prisma = fakePrisma({ document: documentFixture() });
    await processDocumentClassify(prisma, storageWithPages(), payload);

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
    await processDocumentClassify(prisma, storageWithPages(), payload);

    const update = prisma.updated.documents[0]?.data as Record<string, unknown>;
    // The classifier's opinion is still recorded, for the accuracy metrics…
    expect(update.classification).toBeDefined();
    // …but the effective kind and its authorship are untouched.
    expect(update).not.toHaveProperty("kind");
    expect(update).not.toHaveProperty("classifiedBy");
  });

  it("prefers a PDF's text layer over OCR", async () => {
    const document = documentFixture();
    document.pages = [
      {
        ...document.pages[0]!,
        storedObject: { ...document.pages[0]!.storedObject, contentType: "application/pdf" },
      },
    ];
    const prisma = fakePrisma({ document });
    await processDocumentClassify(prisma, storageWithPages(), payload);

    expect(extractPdfText).toHaveBeenCalledTimes(1);
    expect(runOcr).not.toHaveBeenCalled();
  });

  it("skips pages whose object never passed verification", async () => {
    const document = documentFixture();
    document.pages[1]!.storedObject.status = "quarantined";
    const prisma = fakePrisma({ document });
    await processDocumentClassify(prisma, storageWithPages(), payload);

    expect(runOcr).toHaveBeenCalledTimes(1);
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
    await processDocumentClassify(prisma, storage, payload);

    expect(prisma.created.storedObjects).toHaveLength(0);
    expect(storage.puts[0]?.objectKey).toBe("ocr/key");
    expect(prisma.updated.storedObjects[0]).toMatchObject({ where: { id: "existing-text" } });
  });

  it("audits the classification with signal ids only — never page text", async () => {
    const prisma = fakePrisma({ document: documentFixture() });
    await processDocumentClassify(prisma, storageWithPages(), payload);

    const entry = vi.mocked(writeAudit).mock.calls[0]?.[1] as { action: string; context: Record<string, unknown> };
    expect(entry.action).toBe("document.classified");
    expect(entry.context.keptUserKind).toBe(false);
    expect(JSON.stringify(entry.context)).not.toMatch(/glycomet|sharma|jubilee/i);
  });
});
