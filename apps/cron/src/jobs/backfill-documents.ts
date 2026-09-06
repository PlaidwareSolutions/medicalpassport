/**
 * One-shot Phase 3 backfill (docs_v2/04 §7.3, §14): remaps every V1
 * `PrescriptionDocument` onto the V2 `PatientDocument` + `DocumentPage`
 * shape. Not on a Railway schedule — run manually after the diagnostics
 * backfill, so V1 `reportId` links can resolve to their `DiagnosticReport`
 * (see apps/cron/README.md). Safe to re-run: rows are keyed on
 * `legacyPrescriptionDocumentId`.
 */
import { runJob } from "../lib/run-job";
import { backfillDocuments } from "../lib/backfill-documents";

runJob("backfill-documents", async ({ prisma, log }) => ({ ...(await backfillDocuments(prisma, log)) }));
