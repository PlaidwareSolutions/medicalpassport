import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { adminRulesQualityQuerySchema } from "@medpass/validation";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard } from "../../common/admin-auth.guard";
import { requireAdminDuty } from "../../common/admin-access";
import type { ApiRequest } from "../../common/http";
import { PrismaService } from "../../common/prisma.service";
import { parseWith } from "../../common/zod";

/** One row of the Gate 3 dashboard: a rule version and what happened to the findings it raised. */
export interface RuleQualityRow {
  ruleKey: string;
  ruleVersion: string;
  raised: number;
  acknowledged: number;
  reviewedWithProfessional: number;
  dismissedNotRelevant: number;
  /** acknowledged / raised, 0–1; null when nothing was raised. */
  acknowledgementRate: number | null;
  /** dismissedNotRelevant / raised, 0–1; null when nothing was raised. */
  falsePositiveRate: number | null;
  /** Median seconds from the finding's evaluation to its first acknowledgement; null when none. */
  medianSecondsToAcknowledge: number | null;
}

/**
 * Gate 3 alert-quality dashboard (docs_v2/06 P9-4, docs_v2/10 §4 "admin dashboard for FP
 * rate and acknowledgement"). Per rule version over the window: findings raised, how many
 * were acknowledged, reviewed with a professional, or dismissed as not relevant — the
 * false-positive signal — plus the two rates and the median time to acknowledgement.
 *
 * Counts only. No finding id, no profile id, no medicine, no ingredient, no note: the rule
 * key and version are code constants, and everything else is arithmetic over them. Not
 * audited, for the same reason as admin/operations and admin/documents/status.
 */
@Public()
@UseGuards(AdminAuthGuard)
@Controller("admin/rules")
export class AdminRulesQualityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("quality")
  async quality(@Query() query: Record<string, string | undefined>, @Req() req: ApiRequest) {
    requireAdminDuty(req, "view_rules");
    const input = parseWith(adminRulesQualityQuerySchema, query);
    const to = input.to ?? new Date();
    const from = input.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    const findings = await this.prisma.safetyFinding.findMany({
      where: { evaluatedAt: { gte: from, lte: to } },
      select: {
        ruleKey: true,
        ruleVersion: true,
        evaluatedAt: true,
        actions: { select: { action: true, occurredAt: true }, orderBy: { occurredAt: "asc" } },
      },
    });

    const rows = new Map<string, RuleQualityRow & { ackSeconds: number[] }>();
    for (const finding of findings) {
      const key = `${finding.ruleKey}@${finding.ruleVersion}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          ruleKey: finding.ruleKey,
          ruleVersion: finding.ruleVersion,
          raised: 0,
          acknowledged: 0,
          reviewedWithProfessional: 0,
          dismissedNotRelevant: 0,
          acknowledgementRate: null,
          falsePositiveRate: null,
          medianSecondsToAcknowledge: null,
          ackSeconds: [],
        };
        rows.set(key, row);
      }
      row.raised += 1;
      const firstAck = finding.actions.find((a) => a.action === "acknowledged");
      if (firstAck) {
        row.acknowledged += 1;
        row.ackSeconds.push(Math.max(0, (firstAck.occurredAt.getTime() - finding.evaluatedAt.getTime()) / 1000));
      }
      if (finding.actions.some((a) => a.action === "reviewed_with_professional")) row.reviewedWithProfessional += 1;
      if (finding.actions.some((a) => a.action === "dismissed_not_relevant")) row.dismissedNotRelevant += 1;
    }

    const items: RuleQualityRow[] = [...rows.values()]
      .map(({ ackSeconds, ...row }) => ({
        ...row,
        acknowledgementRate: row.raised > 0 ? round4(row.acknowledged / row.raised) : null,
        falsePositiveRate: row.raised > 0 ? round4(row.dismissedNotRelevant / row.raised) : null,
        medianSecondsToAcknowledge: median(ackSeconds),
      }))
      .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey) || a.ruleVersion.localeCompare(b.ruleVersion));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        raised: items.reduce((n, r) => n + r.raised, 0),
        acknowledged: items.reduce((n, r) => n + r.acknowledged, 0),
        dismissedNotRelevant: items.reduce((n, r) => n + r.dismissedNotRelevant, 0),
      },
      items,
    };
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
