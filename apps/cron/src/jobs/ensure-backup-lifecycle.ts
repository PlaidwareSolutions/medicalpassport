/**
 * Enforce the backup retention target (Session 17): objects in the dedicated
 * backups bucket under the `postgres/` prefix expire after 90 days. This is the
 * technical enforcement of the approved ≤90-day backup-persistence target —
 * without it, encrypted `pg_dump` exports accumulate forever.
 *
 * Idempotent: reads the current R2 lifecycle, and only writes when our rule is
 * missing or different. Scoped strictly to the `postgres/` prefix in the
 * `backups` bucket, so it can never affect marketing media, patient documents,
 * or any other namespace. Touches no database (safe to run via `railway run`).
 *
 * Dry run: pass `--dry-run` (or LIFECYCLE_DRY_RUN=1) to print current + desired
 * config and the backup-age evidence without writing.
 */
import {
  R2ObjectStorage,
  BACKUP_LIFECYCLE_RULE_ID,
  buildBackupLifecycleRule,
} from "@medpass/object-storage";
import { runJob } from "../lib/run-job";

const BACKUP_PREFIX = "postgres/";
const RETENTION_DAYS = 90;

runJob("ensure-backup-lifecycle", async ({ log, config }) => {
  if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET_PREFIX) {
    log.info({}, "R2 not configured — no backup bucket to manage (dev/local), skipping");
    return { skipped: true };
  }
  const dryRun = process.argv.includes("--dry-run") || process.env.LIFECYCLE_DRY_RUN === "1";

  const storage = new R2ObjectStorage({
    accountId: config.R2_ACCOUNT_ID,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    bucketPrefix: config.R2_BUCKET_PREFIX,
  });

  // Evidence (§7/§9): the object keys are `postgres/YYYY-MM-DD/…`, so the date
  // range is visible without decrypting anything.
  const keys = await storage.listObjects("backups", BACKUP_PREFIX, 1000);
  const dates = keys
    .map((k) => k.match(/postgres\/(\d{4}-\d{2}-\d{2})\//)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort();
  const oldest = dates[0];
  const newest = dates[dates.length - 1];

  const current = await storage.getBucketLifecycle("backups");
  // Idempotent by the *meaning* of our rule (R2's GET normalizes field
  // ordering, so a full JSON round-trip would never match) — other rules on
  // the bucket (e.g. R2's default multipart-abort rule) are always preserved.
  const ours = current.find((r) => r.ID === BACKUP_LIFECYCLE_RULE_ID);
  const alreadyCorrect =
    ours?.Status === "Enabled" && ours?.Expiration?.Days === RETENTION_DAYS && ours?.Filter?.Prefix === BACKUP_PREFIX;
  const desired = [
    ...current.filter((r) => r.ID !== BACKUP_LIFECYCLE_RULE_ID),
    buildBackupLifecycleRule(BACKUP_PREFIX, RETENTION_DAYS),
  ];

  log.info(
    {
      bucketPurpose: "backups",
      prefix: BACKUP_PREFIX,
      retentionDays: RETENTION_DAYS,
      backupObjects: keys.length,
      oldestBackupDate: oldest,
      newestBackupDate: newest,
      currentRuleIds: current.map((r) => r.ID),
      alreadyCorrect,
      dryRun,
    },
    "backup lifecycle status",
  );

  if (dryRun) return { dryRun: true, alreadyCorrect, backupObjects: keys.length, oldestBackupDate: oldest };
  if (alreadyCorrect) return { changed: false, backupObjects: keys.length, oldestBackupDate: oldest };

  await storage.putBucketLifecycle("backups", desired);
  const verified = await storage.getBucketLifecycle("backups");
  const rule = verified.find((r) => r.ID === BACKUP_LIFECYCLE_RULE_ID);
  const ok = rule?.Status === "Enabled" && rule?.Expiration?.Days === RETENTION_DAYS && rule?.Filter?.Prefix === BACKUP_PREFIX;
  log.info({ applied: true, verifiedRulePresent: Boolean(rule), verifiedCorrect: ok }, "backup lifecycle applied");
  if (!ok) throw new Error("backup lifecycle applied but remote verification did not match the intended rule");
  return { changed: true, verifiedCorrect: ok, oldestBackupDate: oldest };
});
