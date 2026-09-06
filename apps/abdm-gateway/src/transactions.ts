import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { getPrisma, type PrismaClient } from "@medpass/database";

/**
 * `AbdmTransaction` persistence (docs_v2/08 §4: "every inbound callback is verified, persisted as
 * AbdmTransaction, and enqueued"; §10: every exchange carries our correlationId and the ABDM
 * requestId/transactionId). Bodies are never stored — only a SHA-256 digest, so the row proves
 * what arrived without holding health information in Postgres.
 */

export type GatewayEnv = "mock" | "sandbox" | "production";

export interface TransactionRecord {
  id: string;
  kind: string;
  direction: "inbound" | "outbound";
  status: string;
  requestId: string | null;
  transactionId: string | null;
  correlationId: string | null;
  requestDigest: string | null;
  errorCode: string | null;
  gatewayEnv: GatewayEnv;
  startedAt: Date;
  completedAt: Date | null;
}

export interface NewTransaction {
  kind: string;
  direction: "inbound" | "outbound";
  requestId?: string | null;
  transactionId?: string | null;
  correlationId?: string | null;
  /** Raw body to digest (never stored). */
  body?: unknown;
  patientProfileId?: string | null;
}

export interface EnqueuedJob {
  queue: "abdm_inbound_import" | "abdm_outbound";
  jobKey: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
}

export interface TransactionStore {
  record(input: NewTransaction, gatewayEnv: GatewayEnv): Promise<TransactionRecord>;
  complete(id: string, outcome: { status: "completed" | "failed"; errorCode?: string; errorText?: string; responseBody?: unknown }): Promise<void>;
  /** Hands the callback to the worker queue (Postgres-backed, ADR-V2-006); idempotent on `jobKey`. */
  enqueue(job: EnqueuedJob): Promise<void>;
  findByTransactionId(transactionId: string): Promise<TransactionRecord | null>;
}

export function digestOf(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  return createHash("sha256").update(typeof body === "string" ? body : JSON.stringify(body)).digest("hex");
}

/** Production store: the shared Postgres (private network), same tables the API reads. */
@Injectable()
export class PrismaTransactionStore implements TransactionStore {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async record(input: NewTransaction, gatewayEnv: GatewayEnv): Promise<TransactionRecord> {
    const row = await this.prisma.abdmTransaction.create({
      data: {
        patientProfileId: input.patientProfileId ?? null,
        kind: input.kind,
        direction: input.direction,
        status: "received",
        requestId: input.requestId ?? null,
        transactionId: input.transactionId ?? null,
        correlationId: input.correlationId ?? null,
        requestDigest: digestOf(input.body),
        gatewayEnv,
      },
    });
    return row as TransactionRecord;
  }

  async complete(id: string, outcome: { status: "completed" | "failed"; errorCode?: string; errorText?: string; responseBody?: unknown }): Promise<void> {
    await this.prisma.abdmTransaction.update({
      where: { id },
      data: { status: outcome.status, errorCode: outcome.errorCode ?? null, errorText: outcome.errorText?.slice(0, 500) ?? null, responseDigest: digestOf(outcome.responseBody), completedAt: new Date() },
    });
  }

  async enqueue(job: EnqueuedJob): Promise<void> {
    await this.prisma.backgroundJob.upsert({
      where: { jobKey: job.jobKey },
      create: { queue: job.queue, jobKey: job.jobKey, payload: job.payload as never, correlationId: job.correlationId },
      update: {},
    });
  }

  async findByTransactionId(transactionId: string): Promise<TransactionRecord | null> {
    const row = await this.prisma.abdmTransaction.findFirst({ where: { transactionId }, orderBy: { startedAt: "desc" } });
    return (row as TransactionRecord | null) ?? null;
  }
}

/** Unit-test store: same contract, no database. */
export class InMemoryTransactionStore implements TransactionStore {
  readonly rows: TransactionRecord[] = [];
  readonly jobs: EnqueuedJob[] = [];

  async record(input: NewTransaction, gatewayEnv: GatewayEnv): Promise<TransactionRecord> {
    const row: TransactionRecord = {
      id: randomUUID(),
      kind: input.kind,
      direction: input.direction,
      status: "received",
      requestId: input.requestId ?? null,
      transactionId: input.transactionId ?? null,
      correlationId: input.correlationId ?? null,
      requestDigest: digestOf(input.body),
      errorCode: null,
      gatewayEnv,
      startedAt: new Date(),
      completedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async complete(id: string, outcome: { status: "completed" | "failed"; errorCode?: string }): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return;
    row.status = outcome.status;
    row.errorCode = outcome.errorCode ?? null;
    row.completedAt = new Date();
  }

  async enqueue(job: EnqueuedJob): Promise<void> {
    if (!this.jobs.some((j) => j.jobKey === job.jobKey)) this.jobs.push(job);
  }

  async findByTransactionId(transactionId: string): Promise<TransactionRecord | null> {
    return [...this.rows].reverse().find((r) => r.transactionId === transactionId) ?? null;
  }
}

export const TRANSACTION_STORE = "TRANSACTION_STORE";
