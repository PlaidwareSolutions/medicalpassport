/**
 * Professional-lead retention policy (Session 17).
 *
 * Approved V1 policy: a ProfessionalLead is retained for 24 months from its
 * last recorded meaningful interaction (`lastInteractionAt`). In V1 the only
 * interaction recorded is submission (there is no follow-up-recording
 * interface yet), so in practice this is 24 months from submission until an
 * operational workflow updates `lastInteractionAt`.
 *
 * Semantics are deliberately calendar-month + UTC (not 730 days) so the
 * boundary is stable across month lengths and DST, and independent of the
 * server's locale/timezone.
 */
export const LEAD_RETENTION_MONTHS = 24;

/**
 * The retention cutoff: leads whose `lastInteractionAt` is strictly older than
 * this are eligible for deletion. 24 calendar months before `now`, in UTC.
 */
export function leadRetentionCutoff(now: Date, months: number = LEAD_RETENTION_MONTHS): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - months,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

/**
 * Whether a lead is eligible for retention deletion. A null/undefined
 * `lastInteractionAt` is treated as NOT eligible — fail-safe: never delete a
 * row whose interaction time is ambiguous (the DB column is NOT NULL, this is
 * defence in depth).
 */
export function isLeadEligibleForDeletion(lastInteractionAt: Date | null | undefined, cutoff: Date): boolean {
  if (!lastInteractionAt) return false;
  return lastInteractionAt.getTime() < cutoff.getTime();
}
