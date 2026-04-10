import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATEMENT_SECTIONS = [
  {
    id: "statement_header",
    title: "Statement Details",
    source: "statement",
    fields: [
      { key: "statementNumber", label: "Statement No." },
      { key: "statementDate", label: "Date", format: "date" },
      { key: "statementStatus", label: "Status" },
      { key: "entityName", label: "Bill To" },
      { key: "currency", label: "Currency" },
    ],
  },
  {
    id: "agent_info",
    title: "Agent / Payee",
    source: "agent",
    audience: "agent",
    fields: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "userNumber", label: "Agent No." },
    ],
  },
  {
    id: "client_info",
    title: "Client",
    source: "client",
    audience: "client",
    fields: [
      { key: "displayName", label: "Name" },
      { key: "clientNumber", label: "Client No." },
      { key: "contactPhone", label: "Phone" },
    ],
  },
  {
    id: "line_items",
    title: "Line Items",
    source: "statement",
    layout: "table",
    fields: [
      { key: "itemDescriptions", label: "Description" },
      { key: "itemAmounts", label: "Amount", format: "currency", currencyCode: "HKD" },
      { key: "item_clientPremium", label: "Client Premium", format: "currency", currencyCode: "HKD" },
      { key: "item_agentPremium", label: "Agent Premium", format: "currency", currencyCode: "HKD" },
    ],
  },
  {
    id: "premium_client",
    title: "Premium Summary",
    source: "accounting",
    audience: "client",
    fields: [
      { key: "policyPremiumTotal", label: "Policy Premium", format: "currency", currencyCode: "HKD" },
      { key: "endorsementPremiumTotal", label: "Endorsement Premium", format: "currency", currencyCode: "HKD" },
      { key: "creditTotal", label: "Credit Total", format: "currency", currencyCode: "HKD" },
    ],
  },
  {
    id: "premium_agent",
    title: "Premium Summary",
    source: "accounting",
    audience: "agent",
    fields: [
      { key: "policyPremiumTotal", label: "Policy Premium", format: "currency", currencyCode: "HKD" },
      { key: "endorsementPremiumTotal", label: "Endorsement Premium", format: "currency", currencyCode: "HKD" },
      { key: "creditTotal", label: "Credit Total", format: "currency", currencyCode: "HKD" },
    ],
  },
  {
    id: "totals",
    title: "Statement Total",
    source: "statement",
    fields: [
      { key: "activeTotal", label: "Total Due", format: "currency", currencyCode: "HKD" },
      { key: "paidIndividuallyTotal", label: "Paid Individually", format: "currency", currencyCode: "HKD" },
      { key: "commissionTotal", label: "commission", format: "currency", currencyCode: "HKD" },
      { key: "outstandingTotal", label: "Outstanding", format: "currency", currencyCode: "HKD" },
    ],
  },
];

export async function POST() {
  const groupKey = "document_templates";
  const results: { action: string; id: number; value: string }[] = [];

  const existingRows = await db
    .select({ id: formOptions.id, value: formOptions.value, meta: formOptions.meta })
    .from(formOptions)
    .where(eq(formOptions.groupKey, groupKey));

  const statementRows = existingRows.filter((r) => {
    const meta = r.meta as Record<string, unknown> | null;
    return meta?.type === "statement";
  });

  if (statementRows.length > 0) {
    for (const row of statementRows) {
      const existingMeta = row.meta as Record<string, unknown>;
      const updatedMeta = {
        ...existingMeta,
        requiresStatement: true,
        sections: STATEMENT_SECTIONS,
        footer: {
          text: "Payment is due upon receipt. Please reference the statement number when making payment.",
          showSignature: false,
          ...((existingMeta.footer as Record<string, unknown>) ?? {}),
        },
      };

      await db
        .update(formOptions)
        .set({ meta: updatedMeta })
        .where(eq(formOptions.id, row.id));

      results.push({ action: "updated", id: row.id, value: row.value });
    }
  } else {
    const [created] = await db
      .insert(formOptions)
      .values({
        groupKey,
        label: "Motor Insurance Statement",
        value: "motor_ins_statement",
        sortOrder: 10,
        isActive: true,
        valueType: "string",
        meta: {
          type: "statement",
          documentPrefix: "HIDIST",
          flows: [],
          showWhenStatus: [],
          insurerPolicyIds: [],
          isAgentTemplate: true,
          requiresConfirmation: false,
          requiresStatement: true,
          header: {
            title: "Motor Insurance Statement",
            subtitle: "Billing Statement",
            showDate: true,
            showPolicyNumber: false,
          },
          sections: STATEMENT_SECTIONS,
          footer: {
            text: "Payment is due upon receipt. Please reference the statement number when making payment.",
            showSignature: false,
          },
        },
      })
      .returning({ id: formOptions.id });

    results.push({ action: "created", id: created.id, value: "motor_ins_statement" });
  }

  return NextResponse.json({ ok: true, results });
}
