/** Nightly tamper-evidence check of the audit hash chain (docs/21). */
import { verifyAuditChain } from "@medpass/audit";
import { runJob } from "../lib/run-job";

runJob("verify-audit-chain", async ({ prisma, log, config }) => {
  const acknowledgedBreaksBeforeSeq = config.AUDIT_CHAIN_ACKNOWLEDGED_BREAKS_BEFORE_SEQ
    ? BigInt(config.AUDIT_CHAIN_ACKNOWLEDGED_BREAKS_BEFORE_SEQ)
    : undefined;
  const brokenAt = await verifyAuditChain(prisma, undefined, acknowledgedBreaksBeforeSeq);
  if (brokenAt !== null) {
    log.error({ brokenAtSeq: brokenAt.toString() }, "AUDIT CHAIN BROKEN — treat as P1 incident (runbook R7)");
    process.exitCode = 1;
    return { intact: false, brokenAtSeq: brokenAt.toString() };
  }
  return {
    intact: true,
    ...(acknowledgedBreaksBeforeSeq !== undefined
      ? { knownHistoricalBreaksBeforeSeq: acknowledgedBreaksBeforeSeq.toString() }
      : {}),
  };
});
