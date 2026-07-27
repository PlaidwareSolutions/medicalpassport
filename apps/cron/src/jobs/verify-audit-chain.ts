/** Nightly tamper-evidence check of the audit hash chain (docs/21). */
import { verifyAuditChain } from "@medpass/audit";
import { runJob } from "../lib/run-job";

runJob("verify-audit-chain", async ({ prisma, log, config }) => {
  const acknowledgedBreakAtSeq = config.AUDIT_CHAIN_ACKNOWLEDGED_BREAK_SEQ
    ? BigInt(config.AUDIT_CHAIN_ACKNOWLEDGED_BREAK_SEQ)
    : undefined;
  const brokenAt = await verifyAuditChain(prisma, undefined, acknowledgedBreakAtSeq);
  if (brokenAt !== null) {
    log.error({ brokenAtSeq: brokenAt.toString() }, "AUDIT CHAIN BROKEN — treat as P1 incident (runbook R7)");
    process.exitCode = 1;
    return { intact: false, brokenAtSeq: brokenAt.toString() };
  }
  return {
    intact: true,
    ...(acknowledgedBreakAtSeq !== undefined ? { knownHistoricalBreakAtSeq: acknowledgedBreakAtSeq.toString() } : {}),
  };
});
