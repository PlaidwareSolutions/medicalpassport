/**
 * One-shot Phase 4 backfill (docs_v2/04 §6, §14): mirrors every V1
 * `MedicalReport`/`ReportValue` into the V2 `DiagnosticReport`/
 * `DiagnosticResult` model. Not on a Railway schedule — run manually (see
 * apps/cron/README.md). Safe to re-run and safe to run while the API is
 * live: the unique legacy keys make it idempotent against itself and
 * against the dual-write in ReportsService.
 */
import { runJob } from "../lib/run-job";
import { backfillDiagnostics } from "../lib/backfill-diagnostics";

runJob("backfill-diagnostics", async ({ prisma, log }) => backfillDiagnostics(prisma, log));
