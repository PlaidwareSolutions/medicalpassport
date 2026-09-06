# Synthetic test corpus

Everything in this folder is **synthetic**: invented clinics, invented practitioners, invented
registration numbers, printed (not handwritten) text, and no real person's data. It exists so
the classifier and extractor have deterministic fixtures in CI and so per-kind accuracy can be
reported on every run (docs_v2/09 §4).

The consented Gate 5 corpus (real documents, handwriting, Indic scripts) is **never** committed.
It lives in a private R2 bucket whose access is restricted to the nightly job's credential
(docs_v2/13 §5 "Test data policy"). Do not add real documents, screenshots, or OCR dumps of
real documents here — synthetic only.

Files:

- `synthetic.ts` — one or more documents per `DocumentKind` for the classifier, plus
  prescription / laboratory-report / discharge-summary fixtures (with synthetic word boxes)
  for the extractor.
