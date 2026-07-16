/** Purges sessions 30 days past expiry (docs/13 retention). Idempotent. */
import { runJob } from "../lib/run-job";

runJob("cleanup-expired-sessions", async ({ prisma }) => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  return { deleted: result.count };
});
