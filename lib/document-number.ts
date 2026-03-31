import { db } from "@/db/client";
import { sql } from "drizzle-orm";

function randomFourDigits(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Generates a unique document number with a random 4-digit code.
 * Format: PREFIX-YYYY-NNNN or PREFIX-YYYY-NNNN(A) for agent copies.
 *
 * Uses form_options with group_key='document_numbers' to track used numbers
 * and guarantee uniqueness via the (group_key, value) unique index.
 *
 * @param prefix  - e.g. "QUO", "INV", "REC"
 * @param suffix  - e.g. "(A)" for agent copies, "" for client copies
 */
export async function generateDocumentNumber(
  prefix: string,
  suffix?: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const sfx = suffix || "";
  const maxRetries = 20;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const code = randomFourDigits();
    const docNumber = `${prefix}-${year}-${code}${sfx}`;
    const counterKey = `dn_${docNumber}`;
    const metaJson = JSON.stringify({ prefix, year, code, suffix: sfx });

    try {
      await db.execute(sql`
        INSERT INTO form_options (group_key, value, label, sort_order, is_active, meta)
        VALUES (
          'document_numbers',
          ${counterKey},
          ${docNumber},
          0,
          true,
          ${metaJson}::jsonb
        )
      `);
      return docNumber;
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "23505") {
        continue;
      }
      throw err;
    }
  }

  // Exhausted retries — fall back to 6-digit code for guaranteed uniqueness
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const docNumber = `${prefix}-${year}-${code}${sfx}`;
  const counterKey = `dn_${docNumber}`;
  const metaJson = JSON.stringify({ prefix, year, code, suffix: sfx });
  await db.execute(sql`
    INSERT INTO form_options (group_key, value, label, sort_order, is_active, meta)
    VALUES (
      'document_numbers',
      ${counterKey},
      ${docNumber},
      0,
      true,
      ${metaJson}::jsonb
    )
  `);
  return docNumber;
}
