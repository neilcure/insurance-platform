import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accountingInvoices, accountingPaymentSchedules } from "@/db/schema/accounting";
import { policies } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { generateDocumentNumber, generateDocumentNumberWithCode, extractSetCodeFromDocNumber } from "@/lib/document-number";
import type { DocumentStatusEntry, DocumentTrackingData, DocLifecycleStatus } from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

type InvoiceTrackingRow = {
  id: number;
  entityType: string;
  entityPolicyId: number | null;
  scheduleAgentId: number | null;
  policyAgentId: number | null;
  documentStatus: unknown;
};

async function getAccessibleInvoice(
  invoiceId: number,
  viewer: { id: number; userType: string },
): Promise<InvoiceTrackingRow | null> {
  const rows = await db
    .select({
      id: accountingInvoices.id,
      entityType: accountingInvoices.entityType,
      entityPolicyId: accountingInvoices.entityPolicyId,
      scheduleAgentId: accountingPaymentSchedules.agentId,
      policyAgentId: policies.agentId,
      documentStatus: accountingInvoices.documentStatus,
    })
    .from(accountingInvoices)
    .leftJoin(accountingPaymentSchedules, eq(accountingPaymentSchedules.id, accountingInvoices.scheduleId))
    .leftJoin(policies, eq(policies.id, accountingInvoices.entityPolicyId))
    .where(eq(accountingInvoices.id, invoiceId))
    .limit(1);

  const invoice = rows[0];
  if (!invoice) return null;

  if (viewer.userType === "admin" || viewer.userType === "internal_staff") {
    return invoice;
  }
  if (viewer.userType !== "agent") return null;
  if (String(invoice.entityType || "").toLowerCase() !== "agent") return null;

  const viewerId = Number(viewer.id);
  if (invoice.scheduleAgentId === viewerId || invoice.policyAgentId === viewerId) {
    return invoice;
  }
  return null;
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    const invoice = await getAccessibleInvoice(invoiceId, { id: Number(me.id), userType: String(me.userType) });

    if (!invoice) {
      return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
    }

    return NextResponse.json((invoice.documentStatus as DocumentTrackingData | null) ?? {});
  } catch (err) {
    console.error("GET invoice document-tracking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
    }

    let docType: string;
    let action: string;
    let sentTo: string | undefined;
    let rejectionNote: string | undefined;
    let confirmMethod: "admin" | "upload" | undefined;
    let confirmNote: string | undefined;
    let documentPrefix: string | undefined;
    let documentSuffix: string | undefined;
    let documentSetGroup: string | undefined;
    let groupSiblingKeys: string[] | undefined;
    let proofFile: File | null = null;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      docType = String(formData.get("docType") ?? "");
      action = String(formData.get("action") ?? "");
      sentTo = (formData.get("sentTo") as string) || undefined;
      rejectionNote = (formData.get("rejectionNote") as string) || undefined;
      confirmMethod = (formData.get("confirmMethod") as "admin" | "upload") || undefined;
      confirmNote = (formData.get("confirmNote") as string) || undefined;
      documentPrefix = (formData.get("documentPrefix") as string) || undefined;
      documentSuffix = (formData.get("documentSuffix") as string) || undefined;
      documentSetGroup = (formData.get("documentSetGroup") as string) || undefined;
      const siblingKeysRaw = formData.get("groupSiblingKeys") as string;
      if (siblingKeysRaw) {
        try { groupSiblingKeys = JSON.parse(siblingKeysRaw) as string[]; } catch { /* ignore */ }
      }
      const file = formData.get("proofFile");
      if (file instanceof File && file.size > 0) proofFile = file;
    } else {
      const body = await request.json();
      docType = String(body.docType ?? "");
      action = String(body.action ?? "");
      sentTo = body.sentTo;
      rejectionNote = body.rejectionNote;
      confirmMethod = body.confirmMethod;
      confirmNote = body.confirmNote;
      documentPrefix = body.documentPrefix;
      documentSuffix = body.documentSuffix;
      documentSetGroup = body.documentSetGroup;
      groupSiblingKeys = body.groupSiblingKeys;
    }

    if (!docType) {
      return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
    }

    const invoice = await getAccessibleInvoice(invoiceId, { id: Number(me.id), userType: String(me.userType) });

    if (!invoice) {
      return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
    }

    const existing: DocumentTrackingData = (invoice.documentStatus as DocumentTrackingData | null) ?? {};
    const entry: DocumentStatusEntry = existing[docType] ?? ({} as DocumentStatusEntry);
    const now = new Date().toISOString();
    const userName = (me as unknown as { name?: string; email?: string }).name
      || (me as unknown as { email?: string }).email
      || `User #${me.id}`;

    if (action === "prepare") {
      if (entry.documentNumber) {
        return NextResponse.json({ documentTracking: existing });
      }
      if (!documentPrefix) {
        return NextResponse.json({ error: "documentPrefix required for prepare" }, { status: 400 });
      }

      let prepDocNumber: string;
      try {
        if (documentSetGroup) {
          const setInfo = resolveSetCode(existing, documentSetGroup, groupSiblingKeys);
          if (setInfo) {
            prepDocNumber = await generateDocumentNumberWithCode(documentPrefix, setInfo.code, setInfo.year, documentSuffix);
            if (!existing._setCodes) existing._setCodes = {};
            existing._setCodes[documentSetGroup] = setInfo;
          } else {
            prepDocNumber = await generateDocumentNumber(documentPrefix, documentSuffix);
            const extracted = extractSetCodeFromDocNumber(prepDocNumber);
            if (extracted) {
              if (!existing._setCodes) existing._setCodes = {};
              existing._setCodes[documentSetGroup] = extracted;
            }
          }
        } else {
          prepDocNumber = await generateDocumentNumber(documentPrefix, documentSuffix);
        }
      } catch (err) {
        console.error("Invoice tracking prepare number generation error:", err);
        return NextResponse.json({ error: "Failed to generate document number" }, { status: 500 });
      }

      const prepEntry: DocumentStatusEntry = {
        ...entry,
        status: "prepared",
        generatedAt: now,
        documentNumber: prepDocNumber,
      };
      const prepMap: DocumentTrackingData = { ...existing, [docType]: prepEntry };
      await db
        .update(accountingInvoices)
        .set({ documentStatus: prepMap, updatedAt: now })
        .where(eq(accountingInvoices.id, invoiceId));
      return NextResponse.json({ documentTracking: prepMap });
    }

    if (action === "reset") {
      const updated = { ...existing };
      delete updated[docType];
      await db
        .update(accountingInvoices)
        .set({ documentStatus: updated, updatedAt: now })
        .where(eq(accountingInvoices.id, invoiceId));
      return NextResponse.json({ documentTracking: updated });
    }

    let newStatus: DocLifecycleStatus;
    switch (action) {
      case "send":
        newStatus = "sent";
        break;
      case "confirm":
        newStatus = "confirmed";
        if (!confirmMethod) confirmMethod = "admin";
        break;
      case "reject":
        newStatus = "rejected";
        break;
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    let proofPath: string | undefined;
    let proofName: string | undefined;
    if (action === "confirm" && confirmMethod === "upload" && proofFile) {
      const policyId = Number(invoice.entityPolicyId ?? 0);
      if (!Number.isFinite(policyId) || policyId <= 0) {
        return NextResponse.json({ error: "Cannot upload proof: invoice is not linked to a policy" }, { status: 400 });
      }
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

    let docNumber = entry.documentNumber;
    if (action === "send" && !docNumber && documentPrefix) {
      try {
        if (documentSetGroup) {
          const setInfo = resolveSetCode(existing, documentSetGroup, groupSiblingKeys);
          if (setInfo) {
            docNumber = await generateDocumentNumberWithCode(documentPrefix, setInfo.code, setInfo.year, documentSuffix);
            if (!existing._setCodes) existing._setCodes = {};
            existing._setCodes[documentSetGroup] = setInfo;
          } else {
            docNumber = await generateDocumentNumber(documentPrefix, documentSuffix);
            const extracted = extractSetCodeFromDocNumber(docNumber);
            if (extracted) {
              if (!existing._setCodes) existing._setCodes = {};
              existing._setCodes[documentSetGroup] = extracted;
            }
          }
        } else {
          docNumber = await generateDocumentNumber(documentPrefix, documentSuffix);
        }
      } catch (err) {
        console.error("Invoice tracking send fallback number generation error:", err);
      }
    }

    const updatedEntry: DocumentStatusEntry = {
      ...entry,
      status: newStatus,
      ...(docNumber ? { documentNumber: docNumber } : {}),
      ...(action === "send" ? { sentAt: now, sentTo: sentTo || entry.sentTo } : {}),
      ...(action === "confirm" ? {
        confirmedAt: now,
        confirmedBy: userName,
        confirmMethod,
        confirmNote: confirmNote || undefined,
        confirmProofPath: proofPath || undefined,
        confirmProofName: proofName || undefined,
      } : {}),
      ...(action === "reject" ? { rejectedAt: now, rejectionNote: rejectionNote || undefined } : {}),
    };

    const updatedMap: DocumentTrackingData = {
      ...existing,
      [docType]: updatedEntry,
    };

    await db
      .update(accountingInvoices)
      .set({ documentStatus: updatedMap, updatedAt: now })
      .where(eq(accountingInvoices.id, invoiceId));

    return NextResponse.json({ documentTracking: updatedMap });
  } catch (err) {
    console.error("POST invoice document-tracking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

function resolveSetCode(
  tracking: DocumentTrackingData,
  group: string,
  siblingKeys?: string[],
): { code: string; year: number } | null {
  const stored = tracking._setCodes?.[group];
  if (stored) return stored;
  const legacy = tracking as Record<string, unknown>;
  if (typeof legacy._setCode === "string" && typeof legacy._setYear === "number") {
    return { code: legacy._setCode, year: legacy._setYear };
  }
  if (siblingKeys?.length) {
    for (const key of siblingKeys) {
      const e = tracking[key];
      if (e?.documentNumber) {
        const extracted = extractSetCodeFromDocNumber(e.documentNumber);
        if (extracted) return extracted;
      }
    }
  }
  return null;
}
