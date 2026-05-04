/**
 * Policy-number generation with collision-safe retry.
 *
 * Why this exists
 * ---------------
 * `policies.policy_number` has a `NOT NULL UNIQUE` constraint. Before
 * this helper, the auto-generated path was:
 *
 *   `${recordPrefix}-${Date.now()}`
 *
 * Two requests landing in the same millisecond compute the same value
 * and the second `INSERT` fails with Postgres error 23505 (the user
 * sees a 500). That's rare in normal use but real during bulk imports
 * (`lib/import/batch-service.ts`) and any tight automation loop.
 *
 * This module mirrors the proven pattern from `lib/document-number.ts`:
 *
 *   - First attempts use `Date.now() + 4-char random tail` so two
 *     concurrent generators almost never collide.
 *   - Each candidate is checked against the live `policies` table
 *     under the same connection.
 *   - On collision we retry with a fresh random tail (up to 20 times).
 *   - If all 20 retries collide (essentially impossible), we fall
 *     back to a much longer random tail for guaranteed uniqueness.
 *
 * The helper does NOT decide WHEN to auto-generate — callers still
 * prefer insurer-supplied / covernote numbers first. It only owns
 * the "auto-generated suffix" piece.
 *
 * Usage
 * -----
 *   import { generatePolicyNumber } from "@/lib/policy-number";
 *
 *   const policyNumber =
 *     body.insurerPolicyNo ||
 *     body.covernoteNo ||
 *     await generatePolicyNumber(recordPrefix);
 *
 * Optional: pass a Drizzle transaction so the uniqueness check runs
 * inside the same atomic unit as the eventual INSERT. This protects
 * against a narrow "check-then-insert" race that would otherwise
 * exist between the helper and the row insert (we'd pick a number
 * that's free at check time but get taken before INSERT). Inside a
 * transaction we still rely on the UNIQUE constraint as the final
 * guarantee, so even without `tx` the database is safe — `tx` just
 * gives us a head-start on conflicts.
 */

import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db/client";

const RANDOM_TAIL_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1
const RETRY_LIMIT = 20;

function randomTail(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += RANDOM_TAIL_CHARS[Math.floor(Math.random() * RANDOM_TAIL_CHARS.length)];
  }
  return out;
}

/**
 * Generate a policy number that is unique against `policies.policy_number`.
 *
 * Format: `${prefix}-${msTimestamp}-${randomTail}`
 *   e.g. `POL-1735999999123-X7K2`
 *
 * The millisecond timestamp keeps numbers human-readable and roughly
 * monotonic (helpful when scanning the policies table). The 4-char
 * random tail eliminates the same-millisecond collision risk.
 */
export async function generatePolicyNumber(
  prefix: string,
  tx?: PgTransaction<any, any, any>,
): Promise<string> {
  const safePrefix = (prefix || "POL").trim() || "POL";
  const runner = tx ?? db;

  for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
    const candidate = `${safePrefix}-${Date.now()}-${randomTail(4)}`;

    // Pre-flight check. The UNIQUE constraint on policy_number is the
    // source of truth, but checking first turns a hard failure into a
    // graceful retry without burning an INSERT round trip.
    const existing = await runner.execute(
      sql`SELECT 1 FROM policies WHERE policy_number = ${candidate} LIMIT 1`,
    );
    const rows = existing as unknown as Array<unknown>;
    if (!rows || rows.length === 0) {
      return candidate;
    }
  }

  // Almost impossible to reach (would need 20 same-ms collisions on
  // a 31^4 = 923 521-space tail). Fall back to a longer tail that
  // brings the collision space to 31^8 = 8.5e11.
  return `${safePrefix}-${Date.now()}-${randomTail(8)}`;
}

/**
 * Translate Postgres unique-violation errors into a friendly check.
 * Useful for callers that want to retry their entire INSERT path
 * (rather than trust the pre-flight) on the rare 23505 from this column.
 */
export function isPolicyNumberUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code =
    (err as { code?: string }).code ??
    (err as { cause?: { code?: string } }).cause?.code;
  if (code !== "23505") return false;
  const msg = String((err as { message?: string }).message ?? "").toLowerCase();
  // pg messages look like:
  //   duplicate key value violates unique constraint "policies_policy_number_unique"
  return msg.includes("policy_number");
}
