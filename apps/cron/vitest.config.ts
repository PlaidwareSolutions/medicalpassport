import { defineConfig } from "vitest/config";

/**
 * The DB-backed specs (caregiver-notifications, daily-cap, test-due,
 * measurement-reminders, backfills) share one Postgres and several of them
 * drive `dispatchPendingNotifications`, which by design takes every pending
 * row in the table. Two such files in parallel dispatch each other's
 * fixtures. Serial files — the same choice apps/api makes with
 * `--runInBand` — keep each spec the only dispatcher while it runs; the
 * whole suite is a few seconds either way.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
