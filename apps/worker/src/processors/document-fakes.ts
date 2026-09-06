import { vi } from "vitest";
import type { PrismaClient } from "@medpass/database";
import type { ObjectStorage } from "@medpass/object-storage";

/**
 * Hand-rolled stand-ins for the two boundaries the document processors talk
 * to. Test-only, but kept in src/ (not a *.test.ts) so both document
 * processor suites share exactly the same fakes and neither drifts.
 *
 * Deliberately not a Prisma mock library: the processors use a handful of
 * calls, and a fake that records them plainly makes the assertions read like
 * the behaviour under test rather than like mock plumbing.
 */

export interface FakeStoredObject {
  id: string;
  bucket: string;
  objectKey: string;
  contentType: string | null;
  status: string;
  sha256?: string | null;
  sizeBytes?: number | null;
}

export interface FakePage {
  id: string;
  pageNumber: number;
  storedObjectId: string;
  ocrTextObjectId: string | null;
  storedObject: FakeStoredObject;
}

export interface FakeDocument {
  id: string;
  patientProfileId: string;
  kind: string;
  classifiedBy: string | null;
  classification?: string | null;
  title?: string | null;
  pages: FakePage[];
}

export function fakeStorage(files: Map<string, Buffer> = new Map()) {
  const puts: Array<{ bucket: string; objectKey: string; body: Buffer; contentType?: string }> = [];
  const storage = {
    files,
    puts,
    getObjectBytes: vi.fn(async ({ objectKey }: { objectKey: string }) => {
      const bytes = files.get(objectKey);
      if (!bytes) throw new Error(`no such object: ${objectKey}`);
      return bytes;
    }),
    putObjectBytes: vi.fn(async (opts: { bucket: string; objectKey: string; body: Buffer; contentType?: string }) => {
      files.set(opts.objectKey, opts.body);
      puts.push(opts);
    }),
    presignUpload: vi.fn(),
    presignDownload: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
  };
  return storage as typeof storage & ObjectStorage;
}

export interface FakePrismaOptions {
  document: FakeDocument;
  storedObjects?: FakeStoredObject[];
  products?: Array<{ id: string; genericName: string; brand: { name: string; aliases: string[] } | null }>;
  existingExtractJob?: { id: string; status: string } | null;
}

/** Records every write so a test can assert on what the processor actually did. */
export function fakePrisma(options: FakePrismaOptions) {
  const storedObjects = new Map<string, FakeStoredObject>(
    (options.storedObjects ?? options.document.pages.map((p) => p.storedObject)).map((o) => [o.id, o]),
  );
  const created = {
    storedObjects: [] as Array<Record<string, unknown>>,
    candidates: [] as Array<Record<string, unknown>>,
    backgroundJobs: [] as Array<Record<string, unknown>>,
    extractions: [] as Array<Record<string, unknown>>,
  };
  const updated = {
    documents: [] as Array<Record<string, unknown>>,
    pages: [] as Array<Record<string, unknown>>,
    storedObjects: [] as Array<Record<string, unknown>>,
    extractions: [] as Array<Record<string, unknown>>,
    backgroundJobs: [] as Array<Record<string, unknown>>,
  };

  let extractionSeq = 0;
  let objectSeq = 0;

  const client: Record<string, unknown> = {
    created,
    updated,
    patientDocument: {
      findFirstOrThrow: vi.fn(async () => options.document),
      findUnique: vi.fn(async () => options.document),
      update: vi.fn(async (args: Record<string, unknown>) => {
        updated.documents.push(args);
        return options.document;
      }),
    },
    documentPage: {
      update: vi.fn(async (args: Record<string, unknown>) => {
        updated.pages.push(args);
        return {};
      }),
    },
    storedObject: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedObjects.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        objectSeq += 1;
        const row = { id: `obj-${objectSeq}`, ...data } as unknown as FakeStoredObject;
        storedObjects.set(row.id, row);
        created.storedObjects.push(data);
        return row;
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        updated.storedObjects.push(args);
        return {};
      }),
    },
    documentExtraction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        extractionSeq += 1;
        created.extractions.push(data);
        return { id: `extraction-${extractionSeq}`, ...data };
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        updated.extractions.push(args);
        return {};
      }),
    },
    documentCandidate: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.candidates.push(data);
        return { id: `candidate-${created.candidates.length}`, ...data };
      }),
    },
    backgroundJob: {
      findUnique: vi.fn(async () => options.existingExtractJob ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.backgroundJobs.push(data);
        return { id: "job-1", ...data };
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        updated.backgroundJobs.push(args);
        return {};
      }),
    },
    medicationProduct: {
      findMany: vi.fn(async () => options.products ?? []),
    },
  };

  // Both call shapes the processors use: a callback transaction and an array
  // of promises (the failure path).
  client.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: unknown) => Promise<unknown>)(client);
    return Promise.all(arg as Promise<unknown>[]);
  });

  return client as typeof client & PrismaClient & { created: typeof created; updated: typeof updated };
}
