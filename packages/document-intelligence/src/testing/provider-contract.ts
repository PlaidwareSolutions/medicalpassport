/**
 * Vendor contract checklist (docs_v2/06 P3-2, docs_v2/09 §7).
 *
 * Every OCR or document-AI adapter — Tesseract in the worker, a vendor behind OD-11/OD-12 —
 * must pass every check here before it can be selected by configuration. The checks are
 * plain async functions that throw on failure, with no test-framework dependency, so the
 * same list runs under vitest in this package, under vitest in apps/worker against the real
 * Tesseract adapter, and could run in a vendor evaluation script.
 *
 *   const checks = ocrProviderContract({ create: () => new MyProvider(), sample });
 *   it.each(checks.map((c) => [c.name, c]))("%s", async (_, c) => c.run());
 */
import type {
  BoundingBox,
  DocumentAiInput,
  DocumentAiProvider,
  ExtractionCandidateDraft,
  OcrInput,
  OcrProvider,
  OcrResult,
  OcrWord,
} from "../types.js";

export interface ContractCheck {
  name: string;
  run(): Promise<void>;
}

export interface OcrContractOptions {
  create(): OcrProvider | Promise<OcrProvider>;
  /** A small, real page image the provider can read; the contract only needs it to succeed. */
  sample: Omit<OcrInput, "pageNumber"> & { pageNumber?: number };
  /**
   * Some engines accept very large inputs; allocating `maxInputBytes + 1` for the oversize
   * check is fine up to this ceiling, beyond which the check verifies the limit is declared
   * and finite instead of allocating gigabytes.
   */
  maxAllocatedBytes?: number;
}

export function ocrProviderContract(options: OcrContractOptions): ContractCheck[] {
  const sample: OcrInput = { pageNumber: 1, ...options.sample };
  const ceiling = options.maxAllocatedBytes ?? 64 * 1024 * 1024;

  return [
    {
      name: "reports a stable engine name and version for provenance",
      async run() {
        const provider = await options.create();
        assert(isNonEmptyString(provider.engine), "engine must be a non-empty string");
        assert(isNonEmptyString(provider.engineVersion), "engineVersion must be a non-empty string");
        assert(!/unknown/i.test(provider.engineVersion), "engineVersion must be the real version, not a placeholder");
        const result = await provider.recognize(cloneInput(sample));
        assert(result.engine === provider.engine, "result.engine must echo the provider's engine");
        assert(result.engineVersion === provider.engineVersion, "result.engineVersion must echo the provider's version");
      },
    },
    {
      name: "returns per-line text with confidence in 0–1 (lines, words, page)",
      async run() {
        const provider = await options.create();
        const result = await provider.recognize(cloneInput(sample));
        assertOcrResultShape(result);
        if (result.text.trim().length > 0) {
          assert(result.lines.length > 0, "a non-empty page must be reported as at least one line");
          assert(
            result.lines.every((l) => l.text.trim().length > 0),
            "every line must carry its text",
          );
        }
      },
    },
    {
      name: "never mutates its input",
      async run() {
        const provider = await options.create();
        const input = cloneInput(sample);
        const bytesBefore = Uint8Array.from(input.bytes);
        const snapshot = JSON.stringify({ ...input, bytes: undefined });
        await provider.recognize(input);
        assert(input.bytes.length === bytesBefore.length, "input bytes length changed");
        for (let i = 0; i < bytesBefore.length; i++) {
          assert(input.bytes[i] === bytesBefore[i], `input byte ${i} changed`);
        }
        assert(JSON.stringify({ ...input, bytes: undefined }) === snapshot, "input fields changed");
      },
    },
    {
      name: "declares a finite size limit and rejects oversize input before any work",
      async run() {
        const provider = await options.create();
        assert(
          Number.isFinite(provider.maxInputBytes) && provider.maxInputBytes > 0,
          "maxInputBytes must be a positive finite number",
        );
        if (provider.maxInputBytes + 1 > ceiling) return;
        const oversize = new Uint8Array(provider.maxInputBytes + 1);
        oversize.set(sample.bytes.subarray(0, Math.min(sample.bytes.length, oversize.length)));
        let rejected = false;
        try {
          await provider.recognize({ ...cloneInput(sample), bytes: oversize });
        } catch {
          rejected = true;
        }
        assert(rejected, "an input larger than maxInputBytes must be rejected");
      },
    },
    {
      name: "normalizes every box into the page (0–1) and keeps words inside their line",
      async run() {
        const provider = await options.create();
        const result = await provider.recognize(cloneInput(sample));
        for (const line of result.lines) {
          if (line.box) assertBox(line.box, "line");
          for (const word of line.words) assertWord(word);
        }
        for (const word of result.words) assertWord(word);
      },
    },
  ];
}

export interface DocumentAiContractOptions {
  create(): DocumentAiProvider | Promise<DocumentAiProvider>;
  /** A document the provider can process (synthetic text only — never a real patient's). */
  sample: DocumentAiInput;
}

export function documentAiProviderContract(options: DocumentAiContractOptions): ContractCheck[] {
  return [
    {
      name: "reports model provenance (provider, model, version, prompt version)",
      async run() {
        const provider = await options.create();
        const p = provider.provenance;
        for (const key of ["provider", "model", "version", "promptVersion"] as const) {
          assert(isNonEmptyString(p[key]), `provenance.${key} must be a non-empty string`);
        }
      },
    },
    {
      name: "returns candidates only, each with confidence 0–1, a page, and the provider's provenance",
      async run() {
        const provider = await options.create();
        const drafts = await provider.extract(cloneDocumentInput(options.sample));
        assert(Array.isArray(drafts), "extract must return an array");
        for (const draft of drafts) assertDraft(draft, provider);
      },
    },
    {
      name: "never mutates its input",
      async run() {
        const provider = await options.create();
        const input = cloneDocumentInput(options.sample);
        const snapshot = JSON.stringify(input);
        await provider.extract(input);
        assert(JSON.stringify(input) === snapshot, "input changed");
      },
    },
    {
      name: "declares a finite size limit and rejects oversize input",
      async run() {
        const provider = await options.create();
        assert(
          Number.isFinite(provider.maxInputChars) && provider.maxInputChars > 0,
          "maxInputChars must be a positive finite number",
        );
        const input = cloneDocumentInput(options.sample);
        const first = input.document.pages[0];
        assert(first !== undefined, "sample needs at least one page");
        first.text = "x".repeat(provider.maxInputChars + 1);
        let rejected = false;
        try {
          await provider.extract(input);
        } catch {
          rejected = true;
        }
        assert(rejected, "an input larger than maxInputChars must be rejected");
      },
    },
  ];
}

// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`provider contract: ${message}`);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function inUnit(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

function assertBox(box: BoundingBox, what: string): void {
  for (const key of ["x", "y", "w", "h"] as const) {
    assert(inUnit(box[key]), `${what} box.${key} must be within 0–1 (got ${box[key]})`);
  }
  assert(box.x + box.w <= 1.000001 && box.y + box.h <= 1.000001, `${what} box must not extend past the page`);
}

function assertWord(word: OcrWord): void {
  assert(typeof word.text === "string", "word.text must be a string");
  assert(inUnit(word.confidence), `word confidence must be within 0–1 (got ${word.confidence})`);
  assertBox(word.box, "word");
}

function assertOcrResultShape(result: OcrResult): void {
  assert(typeof result.text === "string", "result.text must be a string");
  assert(Array.isArray(result.lines), "result.lines must be an array");
  assert(Array.isArray(result.words), "result.words must be an array");
  assert(inUnit(result.confidence), `page confidence must be within 0–1 (got ${result.confidence})`);
  for (const line of result.lines) {
    assert(typeof line.text === "string", "line.text must be a string");
    assert(inUnit(line.confidence), `line confidence must be within 0–1 (got ${line.confidence})`);
    assert(Array.isArray(line.words), "line.words must be an array");
  }
}

function assertDraft(draft: ExtractionCandidateDraft, provider: DocumentAiProvider): void {
  assert(isNonEmptyString(draft.targetEntity) && isNonEmptyString(draft.targetField), "candidate must name entity and field");
  assert(Number.isInteger(draft.pageNumber) && draft.pageNumber >= 1, "candidate must cite a page");
  assert(inUnit(draft.confidence), `candidate confidence must be within 0–1 (got ${draft.confidence})`);
  assert(typeof draft.detectedText === "string", "candidate must cite the detected text");
  if (draft.boundingBox) assertBox(draft.boundingBox, "candidate");
  assert(
    JSON.stringify(draft.modelProvenance) === JSON.stringify(provider.provenance),
    "candidate.modelProvenance must equal the provider's provenance",
  );
}

function cloneInput(input: OcrInput): OcrInput {
  return { ...input, bytes: Uint8Array.from(input.bytes), ...(input.languageHints ? { languageHints: [...input.languageHints] } : {}) };
}

function cloneDocumentInput(input: DocumentAiInput): DocumentAiInput {
  return JSON.parse(JSON.stringify(input)) as DocumentAiInput;
}
