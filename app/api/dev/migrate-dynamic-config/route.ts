import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * One-time migration to populate structured semantic metadata on dynamic config:
 *
 * 1. policy_statuses: set `triggersInvoice: true` on statuses that match
 *    the previously hard-coded invoice trigger list.
 *
 * 2. premiumRecord_fields: set `premiumRole` based on premiumColumn mapping
 *    for fields that have well-known column names.
 *
 * Safe to run multiple times — only sets values that aren't already present.
 */
export async function POST() {
  const results: string[] = [];

  // --- 1. Migrate policy statuses: triggersInvoice ---
  const triggerValues = [
    "invoice_prepared", "invoice_sent", "pending_payment",
    "payment_received", "confirmed", "bound", "active",
  ];

  const statuses = await db
    .select({ id: formOptions.id, value: formOptions.value, meta: formOptions.meta })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, "policy_statuses"), eq(formOptions.isActive, true)));

  let statusUpdated = 0;
  for (const s of statuses) {
    const meta = (s.meta ?? {}) as Record<string, unknown>;
    if (meta.triggersInvoice !== undefined) continue;

    const normalizedValue = s.value.toLowerCase().replace(/[\s-]+/g, "_");
    const shouldTrigger = triggerValues.some((t) => normalizedValue.includes(t));
    if (!shouldTrigger) continue;

    await db
      .update(formOptions)
      .set({ meta: { ...meta, triggersInvoice: true } })
      .where(eq(formOptions.id, s.id));
    statusUpdated++;
  }
  results.push(`policy_statuses: set triggersInvoice on ${statusUpdated} statuses`);

  // --- 2. Migrate premiumRecord fields: premiumRole ---
  const columnToRole: Record<string, string> = {
    clientPremiumCents: "client",
    grossPremiumCents: "client",
    netPremiumCents: "net",
    agentPremiumCents: "agent",
    agentCommissionCents: "commission",
  };

  const fields = await db
    .select({ id: formOptions.id, meta: formOptions.meta })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, "premiumRecord_fields"), eq(formOptions.isActive, true)));

  let fieldUpdated = 0;
  const assignedRoles = new Set<string>();

  for (const f of fields) {
    const meta = (f.meta ?? {}) as Record<string, unknown>;
    if (meta.premiumRole) {
      assignedRoles.add(meta.premiumRole as string);
      continue;
    }

    const col = typeof meta.premiumColumn === "string"
      ? meta.premiumColumn.replace(/^"|"$/g, "")
      : undefined;
    if (!col) continue;

    const role = columnToRole[col];
    if (!role || assignedRoles.has(role)) continue;

    await db
      .update(formOptions)
      .set({ meta: { ...meta, premiumRole: role } })
      .where(eq(formOptions.id, f.id));
    assignedRoles.add(role);
    fieldUpdated++;
  }
  results.push(`premiumRecord_fields: set premiumRole on ${fieldUpdated} fields`);

  return NextResponse.json({ ok: true, results });
}
