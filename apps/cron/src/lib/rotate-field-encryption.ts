import type { FieldCrypto } from "@medpass/field-crypto";
import type { PrismaClient } from "@medpass/database";

/**
 * Every column that holds an application-level ciphertext, in one place.
 *
 * The rotation job used to hard-code three of these. Three more had been
 * added since — an organisation's phone, an emergency contact's phone, an
 * ABHA number — and the job never saw them, so running runbook R-KEY-1 and
 * then retiring the old key would have made those rows permanently
 * unreadable (docs_v2 reconciliation, 2026-09-06). The test beside this file
 * reads schema.prisma and fails the build the moment a `*Ciphertext` column
 * exists that is not listed here.
 */
export const ENCRYPTED_COLUMNS = [
  { model: "User", delegate: "user", field: "phoneCiphertext", nullable: false },
  { model: "NotificationChannel", delegate: "notificationChannel", field: "addressCiphertext", nullable: false },
  { model: "AdminUser", delegate: "adminUser", field: "mfaSecretCiphertext", nullable: true },
  { model: "Organization", delegate: "organization", field: "phoneCiphertext", nullable: true },
  { model: "EmergencyContact", delegate: "emergencyContact", field: "phoneCiphertext", nullable: false },
  { model: "AbhaLink", delegate: "abhaLink", field: "abhaNumberCiphertext", nullable: false },
] as const;

export type EncryptedColumn = (typeof ENCRYPTED_COLUMNS)[number];

export interface RotationSummary {
  activeVersion: number;
  /** Rows rewritten, per model. */
  rotated: Record<EncryptedColumn["model"], number>;
  /**
   * Rows whose stored value the keyring could not read at all (corrupt, or
   * written under a key that is no longer in the keyring). Skipped, not
   * fatal: one bad row must not block retiring a key for every other row.
   * Anything above zero needs a person to look at the ids logged.
   */
  unreadable: Record<EncryptedColumn["model"], number>;
  /** Rows still on a non-active version after the pass (should be 0). */
  stillStale: number;
}

/** Optional per-row reporter so the job can log an id (never a value) for rows it had to skip. */
export type UnreadableReporter = (model: EncryptedColumn["model"], id: string, reason: string) => void;

/** The two operations the job needs from any delegate, typed loosely on purpose: the column name is data here. */
interface RotatableDelegate {
  findMany(args: {
    select: Record<string, boolean>;
    orderBy: { id: "asc" };
    take: number;
    skip?: number;
    cursor?: { id: string };
  }): Promise<Array<{ id: string } & Record<string, string | null>>>;
  update(args: { where: { id: string }; data: Record<string, string> }): Promise<unknown>;
}

function delegateFor(prisma: PrismaClient, column: EncryptedColumn): RotatableDelegate {
  return (prisma as unknown as Record<string, RotatableDelegate>)[column.delegate]!;
}

/**
 * Re-encrypts every listed column whose ciphertext is not on the active
 * keyring version. Idempotent and resumable: rows are rewritten one at a
 * time and only when stale, so a re-run after a crash simply continues.
 * Never touches plaintext outside the crypto call; the summary is counts.
 */
export async function rotateFieldEncryption(
  prisma: PrismaClient,
  crypto: FieldCrypto,
  batch = 500,
  onUnreadable: UnreadableReporter = () => undefined,
): Promise<RotationSummary> {
  const rotated = Object.fromEntries(ENCRYPTED_COLUMNS.map((c) => [c.model, 0])) as RotationSummary["rotated"];
  const unreadable = Object.fromEntries(ENCRYPTED_COLUMNS.map((c) => [c.model, 0])) as RotationSummary["unreadable"];
  let stillStale = 0;

  for (const column of ENCRYPTED_COLUMNS) {
    const delegate = delegateFor(prisma, column);
    for (let cursor: string | undefined; ; ) {
      const rows = await delegate.findMany({
        select: { id: true, [column.field]: true },
        orderBy: { id: "asc" },
        take: batch,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const ciphertext = row[column.field];
        if (ciphertext === null || ciphertext === undefined) continue; // nullable column, nothing stored
        if (!crypto.isStale(ciphertext)) continue;
        let rewritten: string;
        try {
          rewritten = crypto.rotate(ciphertext);
        } catch (err) {
          unreadable[column.model] += 1;
          onUnreadable(column.model, row.id, err instanceof Error ? err.message : String(err));
          continue;
        }
        await delegate.update({ where: { id: row.id }, data: { [column.field]: rewritten } });
        rotated[column.model] += 1;
      }
      cursor = rows[rows.length - 1]!.id;
    }

    // Anything still stale is a version the keyring knows but is not active
    // (a row written by a newer active version); a version it cannot read
    // would have thrown above.
    for (let cursor: string | undefined; ; ) {
      const rows = await delegate.findMany({
        select: { id: true, [column.field]: true },
        orderBy: { id: "asc" },
        take: batch,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const ciphertext = row[column.field];
        if (!ciphertext || !crypto.isStale(ciphertext)) continue;
        // A row the pass could not rewrite is counted above, not here.
        try {
          crypto.decrypt(ciphertext);
          stillStale += 1;
        } catch {
          /* unreadable: already counted */
        }
      }
      cursor = rows[rows.length - 1]!.id;
    }
  }

  return { activeVersion: crypto.activeVersion, rotated, unreadable, stillStale };
}
