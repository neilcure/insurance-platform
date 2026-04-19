/**
 * Quick inspection: dump the form_options config for the `driver` package
 * so we can see whether `moreDriver` (or any field) is configured as a
 * repeatable, and what its sub-fields look like.
 *
 * Run:  npx tsx scripts/inspect-driver-package.ts
 */
import { db } from "../db/client";
import { formOptions } from "../db/schema/form_options";
import { and, eq } from "drizzle-orm";

async function main() {
  const fieldRows = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.groupKey, "driver_fields"),
        eq(formOptions.isActive, true),
      ),
    );

  console.log(`Found ${fieldRows.length} active field(s) under "driver_fields":\n`);
  for (const r of fieldRows) {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    console.log(`---- ${r.value} (id=${r.id}, sortOrder=${r.sortOrder})`);
    console.log(`     label:      ${r.label}`);
    console.log(`     inputType:  ${meta.inputType}`);
    console.log(`     required:   ${meta.required}`);
    console.log(`     repeatable: ${meta.repeatable ? JSON.stringify(meta.repeatable, null, 2) : "(none)"}`);
    if (meta.booleanChildren) {
      console.log(`     booleanChildren: ${JSON.stringify(meta.booleanChildren, null, 2)}`);
    }
    if (Array.isArray(meta.subFields) && meta.subFields.length > 0) {
      console.log(`     subFields:  ${JSON.stringify(meta.subFields, null, 2)}`);
    }
  }

  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
