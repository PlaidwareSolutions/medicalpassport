import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { featureFlagsFromEnv } from "@medpass/config";
import type { FeatureFlag } from "@medpass/database";
import { env } from "../../common/env";
import { PrismaService } from "../../common/prisma.service";

/**
 * Feature flags served from `FeatureFlag` rows (docs_v2/05 §14) with
 * per-profile evaluation, falling back to the static env-seeded defaults
 * (`featureFlagsFromEnv`) for any key with no row. Seed-less: an admin
 * creates rows through `PUT admin/flags/:key`.
 *
 * Evaluation order for one flag and one profile:
 *  1. the profile id is in `allowProfileIds` → on;
 *  2. `rolloutPercent` > 0 and the profile's stable bucket (sha256 of
 *     `key:profileId`, mod 100) is below it → on;
 *  3. otherwise `defaultOn`.
 * Without a profile only step 3 applies. A row scoped to another
 * environment is ignored entirely (the static default then wins).
 *
 * Flags gate UI, never authorization (nothing server-side reads a flag to
 * decide access), so the profile id used for evaluation may come from an
 * unauthenticated header: the worst a spoofed id yields is a different
 * set of booleans for a screen the caller cannot open anyway.
 */
@Injectable()
export class FeatureFlagService {
  constructor(private readonly prisma: PrismaService) {}

  /** The static, env-seeded defaults — the floor every environment starts from. */
  staticDefaults(): Record<string, boolean> {
    return { ...featureFlagsFromEnv() };
  }

  /** 0–99, stable for a (flag, profile) pair across processes and deploys. */
  static bucket(key: string, profileId: string): number {
    const digest = createHash("sha256").update(`${key}:${profileId}`).digest();
    return digest.readUInt32BE(0) % 100;
  }

  static evaluateRow(row: Pick<FeatureFlag, "key" | "defaultOn" | "rolloutPercent" | "allowProfileIds">, profileId: string | null): boolean {
    if (profileId) {
      if (row.allowProfileIds.includes(profileId)) return true;
      if (row.rolloutPercent > 0 && FeatureFlagService.bucket(row.key, profileId) < row.rolloutPercent) return true;
    }
    return row.defaultOn;
  }

  private appliesHere(row: Pick<FeatureFlag, "environment">): boolean {
    return row.environment === null || row.environment === env().NODE_ENV;
  }

  /** Every flag (static defaults overlaid by rows), evaluated for the given profile. */
  async evaluateAll(profileId: string | null): Promise<Record<string, boolean>> {
    const flags = this.staticDefaults();
    const rows = await this.prisma.featureFlag.findMany();
    for (const row of rows) {
      if (!this.appliesHere(row)) continue;
      flags[row.key] = FeatureFlagService.evaluateRow(row, profileId);
    }
    return flags;
  }

  async evaluate(key: string, profileId: string | null): Promise<boolean> {
    const row = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (row && this.appliesHere(row)) return FeatureFlagService.evaluateRow(row, profileId);
    return this.staticDefaults()[key] ?? false;
  }
}
