/** Removes OTP attempts past their retention window (docs/13: 30 days). */
import { runJob } from "../lib/run-job";

runJob("cleanup-expired-otps", async ({ prisma }) => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.otpAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { deleted: result.count };
});
