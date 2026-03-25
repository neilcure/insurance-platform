import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
  accountingPayments,
  accountingDocuments,
} from "@/db/schema/accounting";
import { policies, cars } from "@/db/schema/insurance";
import { users, clients } from "@/db/schema/core";
import { policyPremiums } from "@/db/schema/premiums";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields, resolvePremiumTypeColumn, getColumnType } from "@/lib/accounting-fields";

const CENTS_COLUMNS = [
  "grossPremiumCents", "netPremiumCents", "clientPremiumCents",
  "agentCommissionCents", "creditPremiumCents", "levyCents",
  "stampDutyCents", "discountCents",
];

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);

    const [invoice] = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const rawItems = await db
      .select({
        id: accountingInvoiceItems.id,
        invoiceId: accountingInvoiceItems.invoiceId,
        policyId: accountingInvoiceItems.policyId,
        policyPremiumId: accountingInvoiceItems.policyPremiumId,
        lineKey: accountingInvoiceItems.lineKey,
        amountCents: accountingInvoiceItems.amountCents,
        gainCents: accountingInvoiceItems.gainCents,
        description: accountingInvoiceItems.description,
        createdAt: accountingInvoiceItems.createdAt,
        policyNumber: policies.policyNumber,
      })
      .from(accountingInvoiceItems)
      .leftJoin(policies, eq(policies.id, accountingInvoiceItems.policyId))
      .where(eq(accountingInvoiceItems.invoiceId, invoiceId));

    // Enrich items with live premium data from policy_premiums
    const premiumIds = rawItems.map((i) => i.policyPremiumId).filter(Boolean) as number[];

    type PremiumRow = typeof policyPremiums.$inferSelect;
    let premiumMap = new Map<number, PremiumRow>();

    if (premiumIds.length > 0) {
      const premiums = await db
        .select()
        .from(policyPremiums)
        .where(inArray(policyPremiums.id, premiumIds));

      for (const p of premiums) {
        premiumMap.set(p.id, p);
      }
    }

    const accountingFields = await loadAccountingFields();
    const resolvedCol = resolvePremiumTypeColumn(invoice.premiumType, accountingFields);

    const centsColumns = CENTS_COLUMNS;

    const items = rawItems.map((item) => {
      const pm = item.policyPremiumId ? premiumMap.get(item.policyPremiumId) : undefined;

      const currentPremiumCents = pm
        ? Math.abs(Number((pm as Record<string, unknown>)[resolvedCol.column]) || 0)
        : null;

      let allPremiumCents: Record<string, number> | null = null;
      if (pm) {
        allPremiumCents = {};
        for (const col of centsColumns) {
          allPremiumCents[col] = ((pm as Record<string, unknown>)[col] as number) ?? 0;
        }
      }

      return {
        ...item,
        currentPremiumCents,
        allPremiumCents,
      };
    });

    // Resolve entity names: client, agent, collaborator/insurer per line
    const policyIds = [...new Set(rawItems.map((i) => i.policyId))];
    type LineEntityInfo = { collaboratorName: string | null; insurerName: string | null };
    let entityNames: {
      clientName: string | null;
      agentName: string | null;
      collaboratorNames: string[];
      insurerNames: string[];
      perLine: Record<string, LineEntityInfo>;
    } = {
      clientName: null, agentName: null, collaboratorNames: [], insurerNames: [], perLine: {},
    };

    if (policyIds.length > 0) {
      const policyRow = await db
        .select({ clientId: policies.clientId, agentId: policies.agentId })
        .from(policies)
        .where(eq(policies.id, policyIds[0]))
        .limit(1);

      if (policyRow.length > 0) {
        const pol = policyRow[0];
        if (pol.clientId) {
          const [c] = await db.select({ displayName: clients.displayName }).from(clients).where(eq(clients.id, pol.clientId)).limit(1);
          entityNames.clientName = c?.displayName ?? null;
        }
        if (pol.agentId) {
          const [a] = await db.select({ name: users.name }).from(users).where(eq(users.id, pol.agentId)).limit(1);
          entityNames.agentName = a?.name ?? null;
        }
      }

      // Collect all collaboratorId and insurerPolicyId from premiums
      const allEntityPolicyIds = new Set<number>();
      for (const pm of premiumMap.values()) {
        if (pm.collaboratorId) allEntityPolicyIds.add(pm.collaboratorId);
        if (pm.insurerPolicyId) allEntityPolicyIds.add(pm.insurerPolicyId);
      }

      // Load names from cars.extraAttributes for these entity policies
      const entityNameMap = new Map<number, string>();
      if (allEntityPolicyIds.size > 0) {
        const entityRows = await db
          .select({ policyId: policies.id, carExtra: cars.extraAttributes })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .where(inArray(policies.id, [...allEntityPolicyIds]));

        for (const r of entityRows) {
          const name = extractEntityName(r.carExtra as Record<string, unknown> | null);
          if (name) entityNameMap.set(r.policyId, name);
        }
      }

      // Build per-line info and aggregate lists
      const collabSet = new Set<string>();
      const insurerSet = new Set<string>();

      for (const item of rawItems) {
        if (!item.policyPremiumId) continue;
        const pm = premiumMap.get(item.policyPremiumId);
        if (!pm) continue;

        const collabName = pm.collaboratorId ? (entityNameMap.get(pm.collaboratorId) ?? null) : null;
        const insurerName = pm.insurerPolicyId ? (entityNameMap.get(pm.insurerPolicyId) ?? null) : null;

        if (collabName) collabSet.add(collabName);
        if (insurerName) insurerSet.add(insurerName);

        entityNames.perLine[item.lineKey ?? item.id.toString()] = { collaboratorName: collabName, insurerName: insurerName };
      }

      entityNames.collaboratorNames = [...collabSet];
      entityNames.insurerNames = [...insurerSet];
    }

    const payments = await db
      .select({
        id: accountingPayments.id,
        invoiceId: accountingPayments.invoiceId,
        amountCents: accountingPayments.amountCents,
        currency: accountingPayments.currency,
        paymentDate: accountingPayments.paymentDate,
        paymentMethod: accountingPayments.paymentMethod,
        referenceNumber: accountingPayments.referenceNumber,
        status: accountingPayments.status,
        notes: accountingPayments.notes,
        submittedBy: accountingPayments.submittedBy,
        verifiedBy: accountingPayments.verifiedBy,
        verifiedAt: accountingPayments.verifiedAt,
        rejectionNote: accountingPayments.rejectionNote,
        createdAt: accountingPayments.createdAt,
        updatedAt: accountingPayments.updatedAt,
      })
      .from(accountingPayments)
      .where(eq(accountingPayments.invoiceId, invoiceId))
      .orderBy(desc(accountingPayments.createdAt));

    const paymentIds = payments.map((p) => p.id);
    let paymentDocs: any[] = [];
    if (paymentIds.length > 0) {
      paymentDocs = await db
        .select()
        .from(accountingDocuments)
        .where(eq(accountingDocuments.invoiceId, invoiceId));
    }

    const documents = await db
      .select()
      .from(accountingDocuments)
      .where(eq(accountingDocuments.invoiceId, invoiceId));

    const childInvoices = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.parentInvoiceId, invoiceId))
      .orderBy(desc(accountingInvoices.createdAt));

    const paymentsWithDocs = payments.map((p) => ({
      ...p,
      documents: paymentDocs.filter((d: any) => d.paymentId === p.id),
    }));

    const premiumFields = accountingFields
      .filter((f) => f.premiumColumn)
      .map((f) => ({ key: f.key, label: f.label, column: f.premiumColumn!, inputType: f.inputType }));

    return NextResponse.json({
      ...invoice,
      items,
      payments: paymentsWithDocs,
      documents,
      childInvoices,
      entityNames,
      premiumFields,
    });
  } catch (err) {
    console.error("GET /api/accounting/invoices/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);
    const body = await request.json();

    const allowedFields: Record<string, boolean> = {
      status: true,
      invoiceDate: true,
      dueDate: true,
      notes: true,
      entityName: true,
      periodStart: true,
      periodEnd: true,
      documentStatus: true,
    };

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields[key]) {
        updates[key] = value;
      }
    }

    const [updated] = await db
      .update(accountingInvoices)
      .set(updates as any)
      .where(eq(accountingInvoices.id, invoiceId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/accounting/invoices/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

function extractEntityName(carExtra: Record<string, unknown> | null | undefined): string {
  if (!carExtra) return "";
  const norm = (k: string) => k.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");
  const scanForName = (obj: Record<string, unknown>): string => {
    for (const [k, v] of Object.entries(obj)) {
      const n = norm(k);
      const s = String(v ?? "").trim();
      if (!s) continue;
      if (/companyname|organisationname|orgname|fullname|displayname|coname|collconame|^name$/.test(n)) return s;
    }
    let first = "", last = "";
    for (const [k, v] of Object.entries(obj)) {
      const n = norm(k);
      const s = String(v ?? "").trim();
      if (!s) continue;
      if (!last && /lastname|surname/.test(n)) last = s;
      if (!first && /firstname|fname/.test(n)) first = s;
    }
    return (first || last) ? [last, first].filter(Boolean).join(" ") : "";
  };

  const insured = (carExtra.insuredSnapshot ?? null) as Record<string, unknown> | null;
  if (insured && typeof insured === "object") {
    const name = scanForName(insured);
    if (name) return name;
  }

  const pkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const data of Object.values(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const vals = ("values" in (data as Record<string, unknown>)
      ? (data as { values?: Record<string, unknown> }).values
      : data) as Record<string, unknown> | undefined;
    if (!vals) continue;
    const name = scanForName(vals);
    if (name) return name;
  }
  return "";
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const invoiceId = Number(id);

    await db.delete(accountingInvoices).where(eq(accountingInvoices.id, invoiceId));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/accounting/invoices/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
