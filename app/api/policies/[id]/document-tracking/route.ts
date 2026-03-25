import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { memberships, organisations } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields, type AccountingFieldDef } from "@/lib/accounting-fields";
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
        // Require either admin confirm with note OR upload proof
        if (!confirmMethod) {
          return NextResponse.json({ error: "Confirm method required (admin or upload)" }, { status: 400 });
        }
        if (confirmMethod === "upload" && !proofFile) {
          return NextResponse.json({ error: "Proof file required for upload confirmation" }, { status: 400 });
        }
        if (confirmMethod === "admin" && !confirmNote?.trim()) {
          return NextResponse.json({ error: "Admin note required for admin confirmation" }, { status: 400 });
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

    // Auto-create accounting invoice when an invoice-type document is confirmed
    const invoiceKeys = ["invoice", "quotation", "receipt", "statement_invoice"];
    const isInvoiceType = invoiceKeys.some((k) => docType.includes(k));

    if (action === "confirm" && isInvoiceType) {
      try {
        await autoCreateAccountingInvoice(policyId, docType, Number(user.id));
      } catch (err) {
        console.error("Auto-create accounting invoice error (non-fatal):", err);
      }
    }

    return NextResponse.json({ documentTracking: updatedMap });
  } catch (err) {
    console.error("POST document-tracking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function autoCreateAccountingInvoice(policyId: number, docType: string, userId: number) {
  // Skip if an invoice already exists for this policy to avoid duplicates
  const existing = await db
    .select({ id: accountingInvoiceItems.id })
    .from(accountingInvoiceItems)
    .where(eq(accountingInvoiceItems.policyId, policyId))
    .limit(1);
  if (existing.length > 0) return;

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
  const direction = "receivable";
  const premiumType = "client_premium";
  const entityType = "client";

  const accountingFields = await loadAccountingFields();

  function resolvePremiumAmount(p: typeof premiums[number]): number {
    const row = p as Record<string, unknown>;
    let clientVal = 0;
    for (const f of accountingFields) {
      if (!f.premiumColumn) continue;
      if (f.label.toLowerCase().includes("client")) {
        clientVal = (row[f.premiumColumn] as number) ?? 0;
        break;
      }
    }
    return clientVal || (p.grossPremiumCents ?? 0);
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

  if (isTpoWithOd) {
    // TPO + Own Vehicle Damage: create one invoice per line with suffixed policy number
    const pricedPremiums = premiums.filter((p) => resolvePremiumAmount(p) > 0);
    for (let i = 0; i < pricedPremiums.length; i++) {
      const p = pricedPremiums[i];
      const suffix = String.fromCharCode(97 + i); // a, b, c …
      const suffixedPolicyNo = `${policy.policyNumber}(${suffix})`;
      const amt = resolvePremiumAmount(p);
      const invoiceNumber = await nextInvoiceNumber();

      await db.transaction(async (tx) => {
        const [invoice] = await tx
          .insert(accountingInvoices)
          .values({
            organisationId,
            invoiceNumber,
            invoiceType: "individual",
            direction,
            premiumType,
            entityPolicyId: policyId,
            entityType,
            entityName: null,
            totalAmountCents: amt,
            paidAmountCents: 0,
            currency: p.currency ?? "HKD",
            invoiceDate: new Date().toISOString().split("T")[0],
            status: isReceipt ? "paid" : "pending",
            notes: `Policy ${suffixedPolicyNo} – ${p.lineLabel || p.lineKey}`,
            createdBy: userId,
          })
          .returning();

        await tx.insert(accountingInvoiceItems).values({
          invoiceId: invoice.id,
          policyId,
          policyPremiumId: p.id,
          lineKey: p.lineKey,
          amountCents: amt,
          gainCents: computeGain(p),
          description: `${p.lineLabel || p.lineKey} [${suffixedPolicyNo}]`,
        });
      });
    }
  } else {
    // Single invoice covering all premium lines
    let totalAmountCents = 0;
    const items: Array<{ policyId: number; policyPremiumId: number; lineKey: string; amountCents: number; gainCents: number; description: string }> = [];

    for (const p of premiums) {
      const amt = resolvePremiumAmount(p);
      if (amt <= 0) continue;
      totalAmountCents += amt;
      items.push({
        policyId,
        policyPremiumId: p.id,
        lineKey: p.lineKey,
        amountCents: amt,
        gainCents: computeGain(p),
        description: p.lineLabel || p.lineKey,
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
          direction,
          premiumType,
          entityPolicyId: policyId,
          entityType,
          entityName: null,
          totalAmountCents,
          paidAmountCents: 0,
          currency: premiums[0]?.currency ?? "HKD",
          invoiceDate: new Date().toISOString().split("T")[0],
          status: isReceipt ? "paid" : "pending",
          notes: `Auto-created from document tracking (${docType} confirmed)`,
          createdBy: userId,
        })
        .returning();

      if (items.length > 0) {
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
      }
    });
  }
}
