/** Nightly tamper-evidence check of the audit hash chain (docs/21). */
import { verifyAuditChain } from "@medpass/audit";
import { runJob } from "../lib/run-job";

runJob("verify-audit-chain", async ({ prisma, log }) => {
  const brokenAt = await verifyAuditChain(prisma);
  if (brokenAt !== null) {
    log.error({ brokenAtSeq: brokenAt.toString() }, "AUDIT CHAIN BROKEN — treat as P1 incident (runbook R7)");
    process.exitCode = 1;
    return { intact: false, brokenAtSeq: brokenAt.toString() };
  }
  return { intact: true };
});
