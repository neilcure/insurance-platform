/**
 * Share-token generation for the public document download surface.
 *
 * Mirrors the proven `lib/policy-number.ts` retry pattern:
 *   - Mint a random 32-char hex token (~128 bits of entropy).
 *   - Confirm uniqueness against `document_shares.token`.
 *   - Retry up to RETRY_LIMIT times in the astronomically unlikely
 *     case of a collision.
 *
 * The token IS the credential. Anyone with the URL `/d/<token>` can
 * download the listed files until `expires_at`. Recipients receive
 * the token via WhatsApp (end-to-end encrypted), so the threat model
 * is the same as our existing `signing_sessions` token flow.
 */

import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

const TOKEN_BYTES = 16; // → 32 hex chars → 128 bits of entropy.
const RETRY_LIMIT = 5;

function mintToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export async function generateShareToken(): Promise<string> {
  for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
    const candidate = mintToken();
    const existing = await db.execute(
      sql`SELECT 1 FROM document_shares WHERE token = ${candidate} LIMIT 1`,
    );
    const rows = existing as unknown as Array<unknown>;
    if (!rows || rows.length === 0) return candidate;
  }
  return mintToken();
}
