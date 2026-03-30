import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems, accountingPaymentSchedules } from "@/db/schema/accounting";
import { memberships, organisations, clients, users } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields } from "@/lib/accounting-fields";
import type { DocumentStatusMap, DocumentStatusEntry, DocLifecycleStatus } from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;

    const [policy] = await db
      .select({ documentTracking: policies.documentTracking })
      .from(policies)
      .where(eq(policies.id, Number(id)))
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    return NextResponse.json(policy.documentTracking ?? {});
  } catch (err) {
    console.error("GET document-tracking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const policyId = Number(id);

    // Parse body — supports JSON or multipart (for file upload proof)
    let docType: string;
    let action: string;
    let sentTo: string | undefined;
    let rejectionNote: string | undefined;
    let confirmMethod: "admin" | "upload" | undefined;
    let confirmNote: string | undefined;
    let proofFile: File | null = null;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      docType = formData.get("docType") as string;
      action = formData.get("action") as string;
      sentTo = (formData.get("sentTo") as string) || undefined;
      rejectionNote = (formData.get("rejectionNote") as string) || undefined;
      confirmMethod = (formData.get("confirmMethod") as "admin" | "upload") || undefined;
      confirmNote = (formData.get("confirmNote") as string) || undefined;
      const file = formData.get("proofFile");
      if (file instanceof File && file.size > 0) proofFile = file;
    } else {
      const body = await request.json();
      docType = body.docType;
      action = body.action;
      sentTo = body.sentTo;
      rejectionNote = body.rejectionNote;
      confirmMethod = body.confirmMethod;
      confirmNote = body.confirmNote;
    }

    if (!docType || typeof docType !== "string") {
      return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
    }

    const [policy] = await db
      .select({ documentTracking: policies.documentTracking })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const existing: DocumentStatusMap = (policy.documentTracking as DocumentStatusMap | null) ?? {};
    const entry: DocumentStatusEntry = existing[docType] ?? ({} as DocumentStatusEntry);
    const now = new Date().toISOString();
    const userName = (user as unknown as { name?: string; email?: string }).name || (user as unknown as { email?: string }).email || `User #${user.id}`;

    let newStatus: DocLifecycleStatus;

    switch (action) {
      case "send":
        newStatus = "sent";
        break;
      case "confirm": {
        if (!confirmMethod) {
          confirmMethod = "admin";
        }
        if (confirmMethod === "upload" && !proofFile) {
          return NextResponse.json({ error: "Proof file required for upload confirmation" }, { status: 400 });
        }
        newStatus = "confirmed";
        break;
      }
      case "reject":
        newStatus = "rejected";
        break;
      case "reset": {
        const updated = { ...existing };
        delete updated[docType];
        await db.update(policies).set({ documentTracking: updated }).where(eq(policies.id, policyId));
        return NextResponse.json({ documentTracking: updated });
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Handle proof file upload
    let proofPath: string | undefined;
    let proofName: string | undefined;
    if (action === "confirm" && confirmMethod === "upload" && proofFile) {
      const { validateFile, saveFile } = await import("@/lib/storage");
      const validation = validateFile(proofFile.name, proofFile.type, proofFile.size);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
      const buffer = Buffer.from(await proofFile.arrayBuffer());
      const saved = await saveFile(policyId, proofFile.name, buffer);
      proofPath = saved.storedPath;
      proofName = proofFile.name;
    }

    const updatedEntry: DocumentStatusEntry = {
      ...entry,
      status: newStatus,
      ...(action === "send" && { sentAt: now, sentTo: sentTo || entry.sentTo }),
      ...(action === "confirm" && {
        confirmedAt: now,
        confirmedBy: userName,
        confirmMethod,
        confirmNote: confirmNote || undefined,
        confirmProofPath: proofPath || undefined,
        confirmProofName: proofName || undefined,
      }),
      ...(action === "reject" && { rejectedAt: now, rejectionNote: rejectionNote || undefined }),
    };

    const updatedMap: DocumentStatusMap = {
      ...existing,
      [docType]: updatedEntry,
    };

    await db
      .update(policies)
      .set({ documentTracking: updatedMap })
      .where(eq(policies.id, policyId));

    // Auto-advance policy status based on document tracking action
    let autoStatusAdvanced: string | null = null;
    try {
      autoStatusAdvanced = await autoAdvancePolicyStatus(
        policyId,
        docType,
        action,
        (user as unknown as { name?: string; email?: string }).email || `user:${user.id}`,
      );
    } catch (err) {
      console.error("Auto-advance status error (non-fatal):", err);
    }

    // Auto-create accounting invoice when an invoice-type document is confirmed
    const invoiceKeys = ["invoice", "quotation", "receipt", "statement_invoice"];
    const isInvoiceType = invoiceKeys.some((k) => docType.includes(k));

    if (action === "confirm" && isInvoiceType) {
      try {
        await autoCreateAccountingInvoices(policyId, docType, Number(user.id));
      } catch (err) {
        console.error("Auto-create accounting invoice error (non-fatal):", err);
      }
    }

    return NextResponse.json({
      documentTracking: updatedMap,
      ...(autoStatusAdvanced ? { statusAdvanced: autoStatusAdvanced } : {}),
    });
  } catch (err) {
    console.error("POST document-tracking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

const STATUS_ORDER = [
  "quotation_prepared",
  "quotation_sent",
  "quotation_confirmed",
  "invoice_prepared",
  "invoice_sent",
  "payment_confirmed",
  "completed",
] as const;

const DOC_ACTION_TO_STATUS: Record<string, Record<string, string>> = {
  quotation: { send: "quotation_sent", confirm: "quotation_confirmed" },
  invoice:   { send: "invoice_sent" },
};

async function autoAdvancePolicyStatus(
  policyId: number,
  docType: string,
  action: string,
  changedBy: string,
): Promise<string | null> {
  if (action !== "send" && action !== "confirm") return null;

  const docLower = docType.toLowerCase();
  let targetStatus: string | null = null;

  for (const [keyword, mapping] of Object.entries(DOC_ACTION_TO_STATUS)) {
    if (docLower.includes(keyword) && mapping[action]) {
      targetStatus = mapping[action];
      break;
    }
  }

  if (!targetStatus) return null;

  const [carRow] = await db
    .select({ id: cars.id, extraAttributes: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.policyId, policyId))
    .limit(1);
  if (!carRow) return null;

  const existing = (carRow.extraAttributes ?? {}) as Record<string, unknown>;
  const currentStatus = (existing.status as string) ?? "active";

  const currentIdx = STATUS_ORDER.indexOf(currentStatus as typeof STATUS_ORDER[number]);
  const targetIdx = STATUS_ORDER.indexOf(targetStatus as typeof STATUS_ORDER[number]);

  if (targetIdx >= 0 && currentIdx >= targetIdx) return null;

  const historyArr = Array.isArray(existing.statusHistory)
    ? [...(existing.statusHistory as unknown[])]
    : [];
  historyArr.push({
    status: targetStatus,
    changedAt: new Date().toISOString(),
    changedBy,
    note: `Auto: ${docType.replace(/_/g, " ")} ${action === "send" ? "sent" : "confirmed"}`,
  });

  const updated: Record<string, unknown> = {
    ...existing,
    status: targetStatus,
    statusHistory: historyArr,
    _lastEditedAt: new Date().toISOString(),
  };

  await db.update(cars).set({ extraAttributes: updated }).where(eq(cars.id, carRow.id));
  return targetStatus;
}

async function autoCreateAccountingInvoices(policyId: number, docType: string, userId: number) {
  const premiums = await db
    .select()
    .from(policyPremiums)
    .where(eq(policyPremiums.policyId, policyId));

  if (premiums.length === 0) return;

  const [policy] = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      organisationId: policies.organisationId,
      clientId: policies.clientId,
      agentId: policies.agentId,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!policy) return;

  let organisationId = policy.organisationId;
  if (!organisationId) {
    const [mem] = await db
      .select({ orgId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1);
    organisationId = mem?.orgId ?? null;
    if (!organisationId) {
      const [org] = await db.select({ id: organisations.id }).from(organisations).limit(1);
      organisationId = org?.id ?? null;
    }
  }
  if (!organisationId) return;

  const isReceipt = docType.includes("receipt");
  const accountingFields = await loadAccountingFields();

  function resolvePremiumAmount(
    p: typeof premiums[number],
    role: "client" | "agent",
  ): number {
    const row = p as Record<string, unknown>;
    let matched = 0;
    for (const f of accountingFields) {
      if (!f.premiumColumn) continue;
      const label = f.label.toLowerCase();
      if (label.includes(role)) {
        matched = (row[f.premiumColumn] as number) ?? 0;
        break;
      }
    }
    if (role === "client") {
      return matched || (p.grossPremiumCents ?? 0);
    }
    return matched;
  }

  function computeGain(p: typeof premiums[number]): number {
    const row = p as Record<string, unknown>;
    let client = 0, net = 0, agent = 0;
    for (const f of accountingFields) {
      if (!f.premiumColumn) continue;
      const val = (row[f.premiumColumn] as number) ?? 0;
      const lbl = f.label.toLowerCase();
      if (lbl.includes("client")) client = val;
      else if (lbl.includes("net")) net = val;
      else if (lbl.includes("agent")) agent = val;
    }
    return agent > 0 ? agent - net : client - net;
  }

  const isTpoWithOd =
    premiums.length >= 2 &&
    premiums.some((p) => p.lineKey.toLowerCase() === "tpo") &&
    premiums.some((p) => {
      const k = p.lineKey.toLowerCase();
      return k.includes("own_vehicle") || k.includes("owndamage");
    });

  const prefix = "AR";
  const year = new Date().getFullYear();

  async function nextInvoiceNumber(): Promise<string> {
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accountingInvoices)
      .where(
        and(
          eq(accountingInvoices.organisationId, organisationId!),
          sql`extract(year from ${accountingInvoices.createdAt}) = ${year}`,
        ),
      );
    const count = (countResult[0]?.count ?? 0) + 1;
    return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
  }

  async function hasExistingInvoice(entityType: "client" | "agent", premiumType: "client_premium" | "agent_premium") {
    const existing = await db
      .select({ id: accountingInvoices.id })
      .from(accountingInvoices)
      .innerJoin(accountingInvoiceItems, eq(accountingInvoiceItems.invoiceId, accountingInvoices.id))
      .where(
        and(
          eq(accountingInvoiceItems.policyId, policyId),
          eq(accountingInvoices.entityType, entityType),
          eq(accountingInvoices.premiumType, premiumType),
          sql`${accountingInvoices.status} <> 'cancelled'`,
        ),
      )
      .limit(1);

    return existing.length > 0;
  }

  async function hasActiveSchedule(entityType: "client" | "agent") {
    if (entityType === "client" && policy.clientId) {
      const rows = await db
        .select({ id: accountingPaymentSchedules.id })
        .from(accountingPaymentSchedules)
        .where(
          and(
            eq(accountingPaymentSchedules.organisationId, organisationId),
            eq(accountingPaymentSchedules.entityType, "client"),
            eq(accountingPaymentSchedules.clientId, policy.clientId),
            eq(accountingPaymentSchedules.isActive, true),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }

    if (entityType === "agent" && policy.agentId) {
      const rows = await db
        .select({ id: accountingPaymentSchedules.id })
        .from(accountingPaymentSchedules)
        .where(
          and(
            eq(accountingPaymentSchedules.organisationId, organisationId),
            eq(accountingPaymentSchedules.entityType, "agent"),
            eq(accountingPaymentSchedules.agentId, policy.agentId),
            eq(accountingPaymentSchedules.isActive, true),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }

    return false;
  }

  async function resolveEntityName(entityType: "client" | "agent") {
    if (entityType === "client" && policy.clientId) {
      const [client] = await db
        .select({ displayName: clients.displayName })
        .from(clients)
        .where(eq(clients.id, policy.clientId))
        .limit(1);
      return client?.displayName ?? null;
    }

    if (entityType === "agent" && policy.agentId) {
      const [agent] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, policy.agentId))
        .limit(1);
      return agent?.name || agent?.email || null;
    }

    return null;
  }

  async function createEntityInvoice(
    entityType: "client" | "agent",
    premiumType: "client_premium" | "agent_premium",
  ) {
    if (await hasExistingInvoice(entityType, premiumType)) return;
    if (await hasActiveSchedule(entityType)) return;

    const pricedPremiums = premiums.filter((premium) => resolvePremiumAmount(premium, entityType) > 0);
    if (pricedPremiums.length === 0) return;

    const entityName = await resolveEntityName(entityType);

    if (isTpoWithOd) {
      for (let i = 0; i < pricedPremiums.length; i++) {
        const premium = pricedPremiums[i];
        const suffix = String.fromCharCode(97 + i);
        const suffixedPolicyNo = `${policy.policyNumber}(${suffix})`;
        const amountCents = resolvePremiumAmount(premium, entityType);
        const invoiceNumber = await nextInvoiceNumber();

        await db.transaction(async (tx) => {
          const [invoice] = await tx
            .insert(accountingInvoices)
            .values({
              organisationId,
              invoiceNumber,
              invoiceType: "individual",
              direction: "receivable",
              premiumType,
              entityPolicyId: policyId,
              entityType,
              entityName,
              totalAmountCents: amountCents,
              paidAmountCents: 0,
              currency: premium.currency ?? "HKD",
              invoiceDate: new Date().toISOString().split("T")[0],
              status: isReceipt ? "paid" : "pending",
              notes: `Policy ${suffixedPolicyNo} – ${premium.lineLabel || premium.lineKey}`,
              createdBy: userId,
            })
            .returning();

          await tx.insert(accountingInvoiceItems).values({
            invoiceId: invoice.id,
            policyId,
            policyPremiumId: premium.id,
            lineKey: premium.lineKey,
            amountCents,
            gainCents: computeGain(premium),
            description: `${premium.lineLabel || premium.lineKey} [${suffixedPolicyNo}]`,
          });
        });
      }

      return;
    }

    let totalAmountCents = 0;
    const items: Array<{
      policyId: number;
      policyPremiumId: number;
      lineKey: string;
      amountCents: number;
      gainCents: number;
      description: string;
    }> = [];

    for (const premium of pricedPremiums) {
      const amountCents = resolvePremiumAmount(premium, entityType);
      totalAmountCents += amountCents;
      items.push({
        policyId,
        policyPremiumId: premium.id,
        lineKey: premium.lineKey,
        amountCents,
        gainCents: computeGain(premium),
        description: premium.lineLabel || premium.lineKey,
      });
    }

    const invoiceNumber = await nextInvoiceNumber();

    await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(accountingInvoices)
        .values({
          organisationId,
          invoiceNumber,
          invoiceType: "individual",
          direction: "receivable",
          premiumType,
          entityPolicyId: policyId,
          entityType,
          entityName,
          totalAmountCents,
          paidAmountCents: 0,
          currency: premiums[0]?.currency ?? "HKD",
          invoiceDate: new Date().toISOString().split("T")[0],
          status: isReceipt ? "paid" : "pending",
          notes: `Auto-created from document tracking (${docType} confirmed)`,
          createdBy: userId,
        })
        .returning();

      await tx.insert(accountingInvoiceItems).values(
        items.map((item) => ({
          invoiceId: invoice.id,
          policyId: item.policyId,
          policyPremiumId: item.policyPremiumId,
          lineKey: item.lineKey,
          amountCents: item.amountCents,
          gainCents: item.gainCents,
          description: item.description,
        })),
      );
    });
  }

  await createEntityInvoice("client", "client_premium");
  if (policy.agentId) {
    await createEntityInvoice("agent", "agent_premium");
  }
}
