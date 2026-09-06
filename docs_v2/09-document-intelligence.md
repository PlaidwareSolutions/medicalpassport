# 09 — Document Intelligence Plan (Phase 3, feeding Phases 4, 13, 14)

Extends `docs/19-ai-use-and-guardrails.md`. The existing V1 pipeline (presigned upload → magic-byte/sha256 verification → quarantine → worker `ocr_extraction` with Tesseract.js + pdf-parse → deterministic candidates for brand/frequency/food → per-field confirm/reject) is kept as the floor and generalized.

## 1. Hard rules

1. AI extraction never destroys or replaces the original document. The original `StoredObject` per page is retained (deletion only via patient delete + retention policy).
2. Every extracted field retains: source document, source page and bounding box, confidence, extraction engine/model/version/prompt version, and any user correction.
3. Nothing extracted becomes a clinical row without confirmation by the patient, an authorized caregiver, or a provider acting through a proposal. There is exactly one code path that materializes candidates (`extraction-candidates/:id/confirm` and `extractions/:id/materialize`), and a test asserts no other writer exists.
4. Dose quantity is never auto-proposed from a photo in V2.0 (V1 hazard H-02 rule). From V2.1 it may be **proposed** with a mandatory explicit confirmation step that shows the source crop, after Gate 5 shows ≥ 98 % agreement on the printed corpus; handwritten dose stays never-proposed until a separate Gate 5 result.
5. No PHI leaves the region/provider boundary approved by the Privacy & Security Board; AI providers require contractual no-training terms (OD-12) before any real document is sent.

## 2. Pipeline

```
UPLOAD (camera | gallery | file | share target | provider import | ABDM bundle)
  ↓ PatientDocument + DocumentPage rows; StoredObject per page (status pending → verified)
Malware / file validation  (magic bytes, sha256, size, page count, AV adapter)
  ↓ job document_classify
Document classification     (kind + confidence; user choice always wins)
  ↓ job document_extract
OCR                         (Tesseract.js floor; vendor adapter for handwriting/Indic; pdf text layer first)
  ↓ raw text + word boxes stored as objects (ocr_tmp, 48 h) and a text object on the page
Clinical extraction         (deterministic extractors + optional AI extractor producing candidates)
  ↓
Normalization               (catalog match, analyte match, unit parse, date parse, practitioner/org match)
  ↓
Confidence scoring          (per candidate; policy in packages/document-intelligence/confidence.ts)
  ↓
Patient / provider confirmation   (UI shows source crop; corrections recorded)
  ↓
Structured record           (provenance: source=ocr_extracted, verification=patient_confirmed, sourceExtractionId)
  ↓
Original preserved; HealthEvent emitted
```

## 3. Sources

| Source | V1 | V2 | Notes |
|---|---|---|---|
| Camera / gallery / file | yes | yes | multi-page capture in one flow |
| PDF | yes | yes | text layer preferred over OCR |
| WhatsApp / share target | no | Web Share Target API in the PWA manifest; native share sheets later | `POST profiles/current/documents/share-target` |
| Email intake (labs) | no | Phase 13 L2: a per-patient or per-lab intake address with sender allowlist and manual approval | |
| Provider import | no | Phase 11–13 proposals | `source = clinic_entered` / `lab_imported` |
| ABDM record | no | Phase 8 | `source = abdm_imported` via the same candidate pipeline |

## 4. Document types and classification

Kinds: prescription, laboratory report, imaging report, discharge summary, consultation note, vaccination record, referral, insurance, invoice, medicine packaging (strip/box/bottle — V1), other.

Classifier: starts deterministic (keywords, layout heuristics, pdf metadata) to establish a baseline; an ML/LLM classifier adapter can be added behind the same interface. Output: `classification`, `classificationConfidence`, `classifiedBy`. The patient always confirms or overrides the kind before extraction runs (single tap). Per-kind accuracy is reported on the corpus in every CI run.

## 5. Extraction targets

`ExtractionCandidate.targetEntity` / `targetField` (schemas in `packages/validation/src/extraction-targets.ts`):

| Entity | Fields (V2.0 unless noted) | Never auto-proposed |
|---|---|---|
| prescription | prescribedAt, diagnosisText, validUntil, followUpOn | — |
| practitioner | displayName, speciality, registrationNumber | — |
| organization | displayName, city | — |
| medication (per line) | brandName, genericName, strengthLabel, form, route, frequency, foodInstruction, durationDays, instructionsText | doseQuantity (V2.1 printed only) |
| diagnostic_report | title, testedAt, reportedAt, specimenCollectedAt, labName | — |
| diagnostic_result (per row) | analyteLabelText → analyteKey, enteredValueText, enteredUnit, referenceText, comparator | interpretation (never; only the lab's own flag is copied as text) |
| encounter | kind, startedAt, endedAt, reasonText | — |
| condition | label | — |
| allergy | label | — |
| immunization | vaccineText, administeredOn, doseNumber | — |

Each candidate carries `pageNumber`, `boundingBox` (normalized 0–1 coordinates), `detectedText`, `proposedValue`, `confidence`, and for AI-derived candidates `modelProvider/modelName/modelVersion/promptVersion` via `DocumentExtraction`.

## 6. Confidence policy

- Confidence is per candidate, 0–1, from the extractor (OCR word confidence × match quality for deterministic; model-reported or calibrated for AI).
- UI thresholds: ≥ 0.9 shows as pre-selected "looks right?"; 0.6–0.9 shows as "please check"; < 0.6 is shown only in an "other things we saw" list, never pre-selected. Thresholds are constants with tests and are re-tuned only with Gate 5 evidence.
- No auto-confirm at any threshold.

## 7. Provider adapters

```ts
interface OcrProvider { extract(page: PageInput): Promise<OcrResult /* text, words with boxes, language, confidence */> }
interface DocumentClassifier { classify(doc: DocumentInput): Promise<ClassificationResult> }
interface ClinicalExtractor { extract(input: ExtractionInput): Promise<ExtractionCandidateDraft[]> }
interface MalwareScanner { scan(object: ObjectRef): Promise<ScanResult> }
```

Implementations: `TesseractOcrProvider` (exists), `PdfTextLayerProvider` (exists), `VendorOcrProvider` (OD-11; candidates evaluated against the Gate 5 corpus: handwriting, Hindi/Telugu/Urdu scripts), `DeterministicExtractor` (exists, generalized), `LlmClinicalExtractor` (OD-12; JSON-schema-constrained output, no free text, prompt version pinned, temperature 0, refusal on ambiguity), `ClamAvScanner` or vendor.

Provider selection is configuration per environment; local and CI use deterministic + Tesseract only.

## 8. AI governance (roadmap §30)

AI may support OCR, classification, medication extraction, lab extraction, terminology mapping suggestions, voice entry, and summarization of approved content. AI must not change authoritative clinical data. Required workflow: AI result → confidence → user/provider confirmation → structured record. Model provenance stored for every medically significant extraction (`DocumentExtraction`). Gate 6 suites (hallucination, unsupported claims, prompt injection via document content) run on every prompt or model version change. Prompt injection specifically: document text is untrusted input; extractors run with tool-less, schema-constrained outputs and the worker treats any instruction-like content as data.

## 9. Storage and retention

- Originals: `patient-docs` bucket, lifecycle = account life + retention policy (OD-7).
- Derived (thumbnails, OCR text): `derived` bucket, regenerable.
- OCR temp: `ocr-tmp`, 48 h (exists).
- ABDM inbox: `abdm-inbox`, erased on `dataEraseAt`.
- No PHI in object keys (opaque ids), no public URLs, every access audited (`ObjectAccessEvent`, exists).

## 10. UI (patient-web)

One "Add a document" entry point (Home + Documents). Steps: capture pages → we detect the kind (confirm/override) → "we found these" per-field review with the page crop beside each field → done. Corrections are single-tap or typing-free pickers where the V1 patterns exist (frequency, food, analyte). Every screen speaks (guidance audio) and passes axe/reflow in all published locales.

## 11. Metrics (PHI-free)

Pages uploaded, classification agreement rate, candidate acceptance rate by field and confidence bucket, time-to-confirm, OCR failure rate, extraction cost per page, provider latency. Feeds Gate 5 and the admin document-processing status page.

## 12. Hazards added to the log

H-34 classifier mislabels a discharge summary as a prescription and medicines are proposed from a stopped list · H-35 lab units mis-parsed (mg/dL vs mmol/L) · H-36 candidate from page 2 attached to the wrong report in a multi-document upload · H-37 AI extractor hallucinates a medicine not on the page · H-38 share-target ingestion accepts a document from the wrong family member's chat. Mitigations and owners in [10](10-clinical-safety-and-ai-governance.md).
