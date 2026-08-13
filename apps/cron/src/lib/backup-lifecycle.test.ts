import { describe, expect, it } from "vitest";
import { BACKUP_LIFECYCLE_RULE_ID, buildBackupLifecycleRule } from "@medpass/object-storage";

describe("buildBackupLifecycleRule", () => {
  const rule = buildBackupLifecycleRule("postgres/", 90);

  it("expires after the intended 90 days", () => {
    expect(rule.Expiration?.Days).toBe(90);
  });

  it("is enabled and stably identified", () => {
    expect(rule.Status).toBe("Enabled");
    expect(rule.ID).toBe(BACKUP_LIFECYCLE_RULE_ID);
  });

  it("is scoped strictly to the backup prefix — never a bucket-wide rule", () => {
    expect(rule.Filter?.Prefix).toBe("postgres/");
    // A missing/empty prefix would apply to the whole bucket — must not happen.
    expect(rule.Filter?.Prefix).toBeTruthy();
  });

  it("carries no unexpected transitions/deletions beyond expiration", () => {
    expect(rule.Transitions).toBeUndefined();
    expect(rule.NoncurrentVersionExpiration).toBeUndefined();
  });
});
