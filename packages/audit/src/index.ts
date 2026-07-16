import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@medpass/database";
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

/**
 * Appends a hash-chained audit event. Call inside the same transaction as the
 * mutation it records so a failed audit write fails the operation (docs/21).
 *
 * The chain links each row to the previous row's hash. Chain reads are
 * serialized by the caller's transaction; verification is a nightly cron.
 */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
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

/** Verifies the audit hash chain; returns the seq of the first broken link, or null. */
export async function verifyAuditChain(prisma: PrismaClient, batchSize = 1000): Promise<bigint | null> {
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
      if (row.prevHash !== prevHash) return row.seq;
      prevHash = row.rowHash;
    }
    after = rows[rows.length - 1]!.seq;
  }
}
