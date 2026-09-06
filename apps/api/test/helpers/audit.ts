import { flushAuditQueue } from "@medpass/audit";

/**
 * Read-path audit rows (`*_viewed`, `*_listed`, `*_searched`, and
 * `caregiver.access_used` for a `view_*` action) are queued and written a
 * moment later in batches (docs_v2/19 ticket 0.18; `@medpass/audit`
 * `writeAuditDeferred`). A spec that asserts on one of those rows right after
 * the request must drain the queue first — this is that call, named for what
 * a test means by it. Mutation audit rows are still written inside the
 * mutation's transaction and need nothing.
 */
export async function awaitReadAudits(): Promise<void> {
  await flushAuditQueue();
}
