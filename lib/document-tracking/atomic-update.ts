/**
 * Atomic update helper for `policies.documentTracking` (jsonb).
 *
 * Why this exists
 * ---------------
 * `documentTracking` is mutated by many concurrent flows:
 *   - the document-tracking API (prepare / send / confirm / reject / reset)
 *   - form-selection persistence (checkboxes & radios)
 *   - send-document (stamps the signing token onto the entry)
 *   - public signing flow (submit / decline updates the entry)
 *   - the admin migration script for set codes
 *
 * Without coordination, these all do read → mutate-in-memory → write.
 * If two writes interleave, the slower one silently overwrites the
 * faster one's fields and the JSONB loses information.
 *
 * This helper wraps every mutation in a transaction with
 * `SELECT ... FOR UPDATE`, so concurrent writers to the SAME policy
 * serialize on the row lock. Writers to DIFFERENT policies are
 * unaffected. The transaction body is intentionally tiny — file
 * uploads, email sends, status auto-advance and accounting writes all
 * stay OUTSIDE the transaction (the caller orchestrates them around
 * the helper) so the lock is held for milliseconds, not seconds.
 *
 * Usage
 * -----
 *   const next = await updateDocumentTracking(policyId, (current) => {
 *     const entry = current[docType] ?? ({} as DocumentStatusEntry);
 *     return { ...current, [docType]: { ...entry, status: "sent" } };
 *   });
 *
 * The mutator receives the latest snapshot read inside the transaction
 * (NOT a stale value the caller already had) so each writer sees the
 * effects of the previous writer.
 *
 * Returns
 * -------
 * - The new `DocumentTrackingData` that was actually written, OR
 * - `null` when the policy row does not exist (caller decides whether
 *   that is fatal — most flows treat it as best-effort).
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { DocumentTrackingData } from "@/lib/types/accounting";

export type DocumentTrackingMutator = (
  current: DocumentTrackingData,
) => DocumentTrackingData;

export async function updateDocumentTracking(
  policyId: number,
  mutator: DocumentTrackingMutator,
): Promise<DocumentTrackingData | null> {
  if (!Number.isFinite(policyId) || policyId <= 0) {
    throw new Error(`updateDocumentTracking: invalid policyId ${policyId}`);
  }

  return db.transaction(async (tx) => {
    // Lock the single policy row for the rest of this transaction.
    // Concurrent callers on the same policy block here until we COMMIT.
    // We use raw SQL so the lock + read + write all share one prepared
    // round trip per statement and don't depend on Drizzle's evolving
    // `.for("update")` typing.
    const result = await tx.execute(
      sql`SELECT document_tracking FROM policies WHERE id = ${policyId} FOR UPDATE`,
    );
    const rows = result as unknown as Array<{ document_tracking: unknown }>;
    if (!rows || rows.length === 0) {
      return null;
    }

    const current: DocumentTrackingData =
      (rows[0]?.document_tracking as DocumentTrackingData | null) ?? {};

    let next: DocumentTrackingData;
    try {
      next = mutator(current);
    } catch (err) {
      // Surface mutator errors as transaction failures so the lock is
      // released and nothing partial gets written.
      throw err instanceof Error
        ? err
        : new Error(`documentTracking mutator threw: ${String(err)}`);
    }

    if (!next || typeof next !== "object") {
      throw new Error("documentTracking mutator must return an object");
    }

    // Bind the JSON as a TEXT parameter and cast to jsonb in SQL.
    // This keeps the value fully parameterised (no SQL-injection
    // surface even if a key/value contains quotes) while ensuring
    // Postgres stores it as the right column type.
    const nextJson = JSON.stringify(next);
    await tx.execute(
      sql`UPDATE policies SET document_tracking = ${nextJson}::jsonb WHERE id = ${policyId}`,
    );
    return next;
  });
}

/**
 * Convenience wrapper for the common case of mutating a single entry
 * inside the tracking map. The mutator receives the previous entry
 * (or an empty object when missing) and must return the next entry,
 * or `null` to delete it.
 */
export async function updateDocumentTrackingEntry<TEntry extends Record<string, unknown>>(
  policyId: number,
  docType: string,
  mutator: (prev: TEntry) => TEntry | null,
): Promise<DocumentTrackingData | null> {
  return updateDocumentTracking(policyId, (current) => {
    const prev = (current[docType] as TEntry | undefined) ?? ({} as TEntry);
    const next = mutator(prev);
    const out: DocumentTrackingData = { ...current };
    if (next === null) {
      delete out[docType];
    } else {
      out[docType] = next as unknown as DocumentTrackingData[string];
    }
    return out;
  });
}

