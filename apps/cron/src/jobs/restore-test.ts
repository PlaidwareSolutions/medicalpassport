/**
 * Monthly restore test (docs/27: "a backup without a passing restore test
 * does not count toward RPO"). Fetches the latest successful backup,
 * decrypts it, restores it into a genuinely separate scratch database on
 * the same Postgres server (`CREATE DATABASE` + `pg_restore`, then
 * `DROP DATABASE` once done — never touching the real application
 * database), and compares restored row counts against the manifest
 * `backup-export` captured at export time. This is the one thing that
 * actually proves a backup is restorable, rather than just present.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createObjectStorage } from "@medpass/object-storage";
import { runJob } from "../lib/run-job";
import { decryptBackup } from "../lib/backup-crypto";

const execFileAsync = promisify(execFile);

function withDatabase(databaseUrl: string, dbName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function rowCount(connectionUrl: string, tableName: string): Promise<number> {
  const { stdout } = await execFileAsync("psql", [connectionUrl, "-t", "-A", "-c", `SELECT COUNT(*) FROM "${tableName}"`]);
  return Number.parseInt(stdout.trim(), 10);
}

runJob("restore-test", async ({ prisma, log, config }) => {
  if (!config.BACKUP_ENCRYPTION_KEY) {
    log.info({}, "BACKUP_ENCRYPTION_KEY not configured — nothing to restore-test");
    return { skipped: true };
  }
  if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET_PREFIX) {
    log.info({}, "R2 not configured — nothing to restore-test");
    return { skipped: true };
  }

  const backup = await prisma.backupExecution.findFirst({ where: { status: "succeeded" }, orderBy: { completedAt: "desc" } });
  if (!backup || !backup.objectKey) {
    log.error({}, "no successful backup to restore-test");
    return { ok: false, reason: "no_backup" };
  }

  const restoreTest = await prisma.restoreTest.create({ data: { backupExecutionId: backup.id, status: "running" } });
  const scratchDbName = `medpass_restore_test_${Date.now()}`;
  const tmpDir = await mkdtemp(join(tmpdir(), "medpass-restore-"));
  const dumpPath = join(tmpDir, "dump.pgcustom");
  let scratchCreated = false;

  try {
    const storage = createObjectStorage({
      r2: {
        accountId: config.R2_ACCOUNT_ID,
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY,
        bucketPrefix: config.R2_BUCKET_PREFIX,
      },
      local: { rootDir: ".dev-data/object-storage", secret: "unused-for-backups" },
    });
    const encrypted = await storage.getObjectBytes({ bucket: "backups", objectKey: backup.objectKey });
    const plaintext = decryptBackup(encrypted, config.BACKUP_ENCRYPTION_KEY);
    await writeFile(dumpPath, plaintext);

    await execFileAsync("psql", [config.DATABASE_URL, "-c", `CREATE DATABASE "${scratchDbName}"`]);
    scratchCreated = true;
    const scratchUrl = withDatabase(config.DATABASE_URL, scratchDbName);
    await execFileAsync("pg_restore", ["-d", scratchUrl, "--no-owner", "--no-privileges", dumpPath]);

    const manifest = (backup.tableRowCounts as Record<string, number> | null) ?? {};
    const detail: Record<string, { expected: number; actual: number; match: boolean }> = {};
    let allMatch = true;
    for (const [table, expected] of Object.entries(manifest)) {
      const actual = await rowCount(scratchUrl, table);
      const match = actual === expected;
      detail[table] = { expected, actual, match };
      if (!match) allMatch = false;
    }

    await prisma.restoreTest.update({
      where: { id: restoreTest.id },
      data: { status: allMatch ? "passed" : "failed", completedAt: new Date(), rowCountsMatch: allMatch, detail },
    });
    log.info({ restoreTestId: restoreTest.id, backupExecutionId: backup.id, allMatch, tablesChecked: Object.keys(manifest).length }, "restore test completed");
    return { ok: allMatch, restoreTestId: restoreTest.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    await prisma.restoreTest.update({
      where: { id: restoreTest.id },
      data: { status: "failed", completedAt: new Date(), errorDigest: message.slice(0, 500) },
    });
    log.error({ restoreTestId: restoreTest.id, err: message }, "restore test failed — treat as P2 (docs/30 R12)");
    throw err;
  } finally {
    if (scratchCreated) {
      await execFileAsync("psql", [config.DATABASE_URL, "-c", `DROP DATABASE IF EXISTS "${scratchDbName}"`]).catch((err) =>
        log.error({ scratchDbName, err: String(err) }, "failed to drop scratch restore-test database — needs manual cleanup"),
      );
    }
    await rm(tmpDir, { recursive: true, force: true });
  }
});
