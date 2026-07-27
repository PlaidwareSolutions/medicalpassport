import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@medpass/database";
import type { AuditAction, AuditActorType } from "@medpass/domain";

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  actorType: AuditActorType;
  entityType?: string;
  entityId?: string;
  patientProfileId?: string;
  correlationId?: string;
  /** Digests and coarse context only — never raw PHI values. */
  context?: Record<string, unknown>;
}

type Tx = PrismaClient | Prisma.TransactionClient;

/** A fixed advisory-lock key serializing every writer's "read the tail, then append" step (see below). */
const CHAIN_LOCK_SQL = Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('audit_events_chain')::bigint)`;

function isFullClient(tx: Tx): tx is PrismaClient {
  return typeof (tx as PrismaClient).$transaction === "function";
}

/**
 * Appends a hash-chained audit event. Call inside the same transaction as the
 * mutation it records so a failed audit write fails the operation (docs/21).
 *
 * The chain links each row to the previous row's hash, so two concurrent
 * writers must never both read the same "current tail" before either
 * commits — otherwise both new rows chain to the same predecessor and the
 * chain is permanently broken (this happened in production: several
 * concurrent requests from one page load each wrote a `caregiver.access_used`
 * event via the plain client with no shared transaction). A Postgres
 * transaction-scoped advisory lock, keyed by a fixed constant, serializes the
 * read+insert across every caller — held until whichever transaction
 * acquired it commits (the caller's own ambient transaction, or, when given
 * the plain client, one opened here for exactly this write).
 */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  if (isFullClient(tx)) {
    await tx.$transaction(async (inner) => {
      await inner.$executeRaw(CHAIN_LOCK_SQL);
      await writeAuditRow(inner, entry);
    });
  } else {
    await tx.$executeRaw(CHAIN_LOCK_SQL);
    await writeAuditRow(tx, entry);
  }
}

async function writeAuditRow(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  const prev = await tx.auditEvent.findFirst({
    orderBy: { seq: "desc" },
    select: { rowHash: true },
  });

  const occurredAt = new Date();
  const rowHash = createHash("sha256")
    .update(
      JSON.stringify({
        prev: prev?.rowHash ?? null,
        action: entry.action,
        actorUserId: entry.actorUserId ?? null,
        actorType: entry.actorType,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        patientProfileId: entry.patientProfileId ?? null,
        context: entry.context ?? null,
        occurredAt: occurredAt.toISOString(),
      }),
    )
    .digest("hex");

  await tx.auditEvent.create({
    data: {
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorType,
      entityType: entry.entityType,
      entityId: entry.entityId,
      patientProfileId: entry.patientProfileId,
      correlationId: entry.correlationId,
      context: (entry.context ?? undefined) as Prisma.InputJsonValue | undefined,
      prevHash: prev?.rowHash ?? null,
      rowHash,
      occurredAt,
    },
  });
}

/**
 * Verifies the audit hash chain; returns the seq of the first *unacknowledged*
 * broken link, or null if intact (or every break found is at or before the
 * acknowledged boundary).
 *
 * A break can never be repaired retroactively — the whole point of a hash
 * chain is that it wasn't rewritten after the fact. A single concurrency
 * incident can also misdirect a whole scattered range of rows across a long
 * window (any time several writers race, not just once) — in medpass-prod's
 * real case, 210 rows across a day and a half, ending abruptly the moment
 * the underlying race was fixed. Enumerating every individual seq doesn't
 * scale for that shape, so once everything up to and including a specific
 * seq has been investigated and accepted as pre-fix historical noise
 * (docs/30 R7), passing that seq as a boundary here resumes verification
 * from each acknowledged row's own rowHash in turn, so a genuinely new break
 * anywhere *after* the boundary still fails loudly.
 */
export async function verifyAuditChain(
  prisma: PrismaClient,
  batchSize = 1000,
  acknowledgedBreaksBeforeSeq?: bigint,
): Promise<bigint | null> {
  let prevHash: string | null = null;
  let after: bigint | undefined;
  for (;;) {
    const rows: Array<{ seq: bigint; prevHash: string | null; rowHash: string }> =
      await prisma.auditEvent.findMany({
        orderBy: { seq: "asc" },
        take: batchSize,
        ...(after !== undefined ? { where: { seq: { gt: after } } } : {}),
        select: { seq: true, prevHash: true, rowHash: true },
      });
    if (rows.length === 0) return null;
    for (const row of rows) {
      if (row.prevHash !== prevHash) {
        if (acknowledgedBreaksBeforeSeq !== undefined && row.seq <= acknowledgedBreaksBeforeSeq) {
          prevHash = row.rowHash;
          continue;
        }
        return row.seq;
      }
      prevHash = row.rowHash;
    }
    after = rows[rows.length - 1]!.seq;
  }
}
