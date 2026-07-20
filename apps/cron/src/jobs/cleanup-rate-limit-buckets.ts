/**
 * Purges rate-limit counter rows once their window is old enough that
 * they can never be read again (docs/26 app-level rate limiting). Windows
 * are at most an hour in this codebase; a day of retention is generous
 * headroom for debugging, not a functional requirement. Idempotent.
 */
import { runJob } from "../lib/run-job";

const RETENTION_HOURS = 24;

runJob("cleanup-rate-limit-buckets", async ({ prisma }) => {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
  const result = await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: cutoff } } });
  return { deleted: result.count };
});
