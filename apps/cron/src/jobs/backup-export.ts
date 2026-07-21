/**
 * Daily independent Postgres backup (docs/27), separate from whatever
 * Railway's own managed-Postgres backup does: a real `pg_dump` logical
 * export (custom format, so it's directly `pg_restore`-able), client-side
 * AES-256-GCM encrypted before it ever leaves this process, uploaded to R2's
 * `backups` bucket. A per-table row-count manifest is captured in the same
 * run and stored on the `BackupExecution` row, so a later restore test has
 * something to check against without needing the source database to still
 * be in the same state.
 *
 * Shells out to the real `pg_dump` binary (installed in the cron Docker
 * image) rather than reimplementing a logical export in JS — schema,
 * sequences, and constraint fidelity are exactly what pg_dump already
 * guarantees, and reinventing that would be a real, easy-to-get-wrong
 * undertaking for no benefit.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createObjectStorage } from "@medpass/object-storage";
import { runJob } from "../lib/run-job";
import { encryptBackup } from "../lib/backup-crypto";

const execFileAsync = promisify(execFile);

async function tableRowCounts(prisma: { $queryRawUnsafe: (q: string) => Promise<unknown> }): Promise<Record<string, number>> {
  const tables = (await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  )) as Array<{ table_name: string }>;

  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const result = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table_name}"`)) as Array<{ count: number }>;
    counts[table_name] = result[0]?.count ?? 0;
  }
  return counts;
}

runJob("backup-export", async ({ prisma, log, config }) => {
  if (!config.BACKUP_ENCRYPTION_KEY) {
    log.info({}, "BACKUP_ENCRYPTION_KEY not configured — skipping (dev/local has no backup destination)");
    return { skipped: true };
  }
  if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET_PREFIX) {
    log.info({}, "R2 not configured — nowhere to put a backup, skipping");
    return { skipped: true };
  }

  const execution = await prisma.backupExecution.create({ data: { status: "running" } });
  const tmpDir = await mkdtemp(join(tmpdir(), "medpass-backup-"));
  const dumpPath = join(tmpDir, "dump.pgcustom");

  try {
    const rowCounts = await tableRowCounts(prisma);
    await execFileAsync("pg_dump", [config.DATABASE_URL, "-Fc", "-f", dumpPath]);
    const plaintext = await readFile(dumpPath);
    const encrypted = encryptBackup(plaintext, config.BACKUP_ENCRYPTION_KEY);

    const objectKey = `postgres/${new Date().toISOString().slice(0, 10)}/${execution.id}.pgcustom.enc`;
    const storage = createObjectStorage({
      r2: {
        accountId: config.R2_ACCOUNT_ID,
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY,
        bucketPrefix: config.R2_BUCKET_PREFIX,
      },
      local: { rootDir: ".dev-data/object-storage", secret: "unused-for-backups" },
    });
    await storage.putObjectBytes({ bucket: "backups", objectKey, body: encrypted, contentType: "application/octet-stream" });

    await prisma.backupExecution.update({
      where: { id: execution.id },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        objectKey,
        sizeBytes: encrypted.length,
        sha256: createHash("sha256").update(encrypted).digest("hex"),
        tableRowCounts: rowCounts,
      },
    });
    log.info({ executionId: execution.id, objectKey, sizeBytes: encrypted.length, tables: Object.keys(rowCounts).length }, "backup export succeeded");
    return { executionId: execution.id, sizeBytes: encrypted.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    await prisma.backupExecution.update({
      where: { id: execution.id },
      data: { status: "failed", completedAt: new Date(), errorDigest: message.slice(0, 500) },
    });
    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
