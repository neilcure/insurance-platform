import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
  accountingPayments,
  accountingDocuments,
  accountingPaymentSchedules,
} from "@/db/schema/accounting";
import { policies, cars } from "@/db/schema/insurance";
import { users, clients } from "@/db/schema/core";
import { policyPremiums } from "@/db/schema/premiums";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { getDisplayNameFromSnapshot } from "@/lib/field-resolver";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields, resolvePremiumTypeColumn, getColumnType } from "@/lib/accounting-fields";
import { findOrCreateDraftStatement, addInvoiceToStatement } from "@/lib/statement-management";

const CENTS_COLUMNS = [
  "grossPremiumCents", "netPremiumCents", "clientPremiumCents",
  "agentPremiumCents", "agentCommissionCents", "creditPremiumCents",
  "levyCents", "stampDutyCents", "discountCents",
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

    // Stage A: everything that only needs `invoiceId` runs in parallel.
    // Note: we previously fetched `accountingDocuments` twice (once as `paymentDocs`
    // gated on payments existing, once as `documents`) — the queries were identical,
    // so we now fetch it once and reuse.
    const [rawItems, accountingFields, payments, documents, childInvoices] = await Promise.all([
      db
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
        .where(eq(accountingInvoiceItems.invoiceId, invoiceId)),
      loadAccountingFields(),
      db
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
        .orderBy(desc(accountingPayments.createdAt)),
      db
        .select()
        .from(accountingDocuments)
        .where(eq(accountingDocuments.invoiceId, invoiceId)),
      db
        .select()
        .from(accountingInvoices)
        .where(eq(accountingInvoices.parentInvoiceId, invoiceId))
        .orderBy(desc(accountingInvoices.createdAt)),
    ]);

    // Stage B: enrich items with live premium data + start resolving entity policy.
    // Both depend on `rawItems` only, not on each other.
    const premiumIds = rawItems.map((i) => i.policyPremiumId).filter(Boolean) as number[];
    const policyIdsForEntity = [...new Set(rawItems.map((i) => i.policyId))];

    type PremiumRow = typeof policyPremiums.$inferSelect;
    const premiumMap = new Map<number, PremiumRow>();

    const [premiums, policyRow] = await Promise.all([
      premiumIds.length > 0
        ? db.select().from(policyPremiums).where(inArray(policyPremiums.id, premiumIds))
        : Promise.resolve([] as PremiumRow[]),
      policyIdsForEntity.length > 0
        ? db
            .select({ clientId: policies.clientId, agentId: policies.agentId })
            .from(policies)
            .where(eq(policies.id, policyIdsForEntity[0]))
            .limit(1)
        : Promise.resolve([] as { clientId: number | null; agentId: number | null }[]),
    ]);

    for (const p of premiums) {
      premiumMap.set(p.id, p);
    }

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
      const pol = policyRow[0];

      // Collect collaborator / insurer policy ids that need name lookups.
      const allEntityPolicyIds = new Set<number>();
      for (const pm of premiumMap.values()) {
        if (pm.collaboratorId) allEntityPolicyIds.add(pm.collaboratorId);
        if (pm.insurerPolicyId) allEntityPolicyIds.add(pm.insurerPolicyId);
      }

      // Stage C: client name, agent name, and entity-name lookup are all independent.
      const [clientNameRow, agentNameRow, entityRows] = await Promise.all([
        pol?.clientId
          ? db
              .select({ displayName: clients.displayName })
              .from(clients)
              .where(eq(clients.id, pol.clientId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        pol?.agentId
          ? db
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, pol.agentId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        allEntityPolicyIds.size > 0
          ? db
              .select({ policyId: policies.id, carExtra: cars.extraAttributes })
              .from(policies)
              .leftJoin(cars, eq(cars.policyId, policies.id))
              .where(inArray(policies.id, [...allEntityPolicyIds]))
          : Promise.resolve([] as { policyId: number; carExtra: unknown }[]),
      ]);

      entityNames.clientName = clientNameRow?.displayName ?? null;
      entityNames.agentName = agentNameRow?.name ?? null;

      const entityNameMap = new Map<number, string>();
      for (const r of entityRows) {
        const name = extractEntityName(r.carExtra as Record<string, unknown> | null);
        if (name) entityNameMap.set(r.policyId, name);
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

    // payments / documents / childInvoices were already loaded in Stage A above.
    const paymentsWithDocs = payments.map((p) => ({
      ...p,
      documents: documents.filter((d: { paymentId?: number | null }) => d.paymentId === p.id),
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
      scheduleId: true,
    };

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields[key]) {
        updates[key] = value;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "scheduleId") && updates.scheduleId != null) {
      const scheduleId = Number(updates.scheduleId);
      const [invoice] = await db
        .select({ id: accountingInvoices.id, entityType: accountingInvoices.entityType })
        .from(accountingInvoices)
        .where(eq(accountingInvoices.id, invoiceId))
        .limit(1);
      if (!invoice) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }

      const [schedule] = await db
        .select({ id: accountingPaymentSchedules.id, entityType: accountingPaymentSchedules.entityType })
        .from(accountingPaymentSchedules)
        .where(eq(accountingPaymentSchedules.id, scheduleId))
        .limit(1);
      if (!schedule) {
        return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
      }
      if (schedule.entityType !== invoice.entityType) {
        return NextResponse.json(
          { error: `Cannot attach ${invoice.entityType} invoice to ${schedule.entityType} schedule` },
          { status: 400 },
        );
      }
      updates.scheduleId = scheduleId;

      const [updated] = await db
        .update(accountingInvoices)
        .set(updates as any)
        .where(eq(accountingInvoices.id, invoiceId))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }

      try {
        const { statementId } = await findOrCreateDraftStatement(scheduleId);
        await addInvoiceToStatement(statementId, invoiceId);

        // When adding a payable (commission) invoice to a schedule, also link
        // any un-scheduled receivable invoices for the same policies.
        const invItems = await db
          .select({ policyId: accountingInvoiceItems.policyId })
          .from(accountingInvoiceItems)
          .where(eq(accountingInvoiceItems.invoiceId, invoiceId));
        const invPolicyIds = [...new Set(invItems.map((i) => i.policyId).filter(Boolean))];

        if (invPolicyIds.length > 0) {
          const relatedInvs = await db
            .select({ id: accountingInvoices.id })
            .from(accountingInvoices)
            .innerJoin(accountingInvoiceItems, eq(accountingInvoiceItems.invoiceId, accountingInvoices.id))
            .where(
              and(
                inArray(accountingInvoiceItems.policyId, invPolicyIds as number[]),
                eq(accountingInvoices.invoiceType, "individual"),
                eq(accountingInvoices.entityType, invoice.entityType),
                sql`${accountingInvoices.scheduleId} IS NULL`,
                sql`${accountingInvoices.status} <> 'cancelled'`,
              ),
            );

          const relatedIds = [...new Set(relatedInvs.map((r) => r.id))];
          for (const relId of relatedIds) {
            if (relId === invoiceId) continue;
            await db.update(accountingInvoices)
              .set({ scheduleId, updatedAt: new Date().toISOString() } as any)
              .where(eq(accountingInvoices.id, relId));
            await addInvoiceToStatement(statementId, relId);
          }
        }
      } catch {
        // non-fatal: statement auto-add is best-effort
      }

      return NextResponse.json(updated);
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
  return getDisplayNameFromSnapshot({
    insuredSnapshot: carExtra.insuredSnapshot as Record<string, unknown> | null | undefined,
    packagesSnapshot: (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>,
  });
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
