import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { autoCreateAccountingInvoices } from "@/lib/auto-create-invoices";
import { generateDocumentNumber, generateDocumentNumberWithCode, extractSetCodeFromDocNumber } from "@/lib/document-number";
import type { DocumentStatusMap, DocumentStatusEntry, DocLifecycleStatus, DocumentTrackingData } from "@/lib/types/accounting";

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
    let documentPrefix: string | undefined;
    let documentSuffix: string | undefined;
    let documentSetGroup: string | undefined;
    let groupSiblingKeys: string[] | undefined;
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
      documentPrefix = (formData.get("documentPrefix") as string) || undefined;
      documentSuffix = (formData.get("documentSuffix") as string) || undefined;
      documentSetGroup = (formData.get("documentSetGroup") as string) || undefined;
      const siblingKeysRaw = formData.get("groupSiblingKeys") as string;
      if (siblingKeysRaw) try { groupSiblingKeys = JSON.parse(siblingKeysRaw); } catch { /* ignore */ }
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
      documentPrefix = body.documentPrefix;
      documentSuffix = body.documentSuffix;
      documentSetGroup = body.documentSetGroup;
      groupSiblingKeys = body.groupSiblingKeys;
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

    const existing: DocumentTrackingData = (policy.documentTracking as DocumentTrackingData | null) ?? {};
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
      case "prepare": {
        if (entry.documentNumber) {
          return NextResponse.json({ documentTracking: existing });
        }
        if (!documentPrefix) {
          return NextResponse.json({ error: "documentPrefix required for prepare" }, { status: 400 });
        }
        let prepDocNumber: string | undefined;
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
          console.error("Document number generation error:", err);
          return NextResponse.json({ error: "Failed to generate document number" }, { status: 500 });
        }
        const prepEntry: DocumentStatusEntry = {
          ...entry,
          documentNumber: prepDocNumber,
        };
        const prepMap = { ...existing, [docType]: prepEntry };
        await db.update(policies).set({ documentTracking: prepMap }).where(eq(policies.id, policyId));
        return NextResponse.json({ documentTracking: prepMap });
      }
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

    // Fallback: generate document number on send if not already assigned during prepare
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
        console.error("Document number generation error (non-fatal):", err);
      }
    }

    const updatedEntry: DocumentStatusEntry = {
      ...entry,
      status: newStatus,
      ...(docNumber && { documentNumber: docNumber }),
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
        const confirmedDocNumber = updatedEntry.documentNumber ?? docNumber ?? undefined;
        await autoCreateAccountingInvoices(policyId, docType, Number(user.id), confirmedDocNumber);
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

/**
 * Resolves the shared set code for a given group from the tracking data.
 * Priority: _setCodes[group] → legacy _setCode/_setYear → scan existing entries.
 * The scan fallback handles existing policies created before groups were introduced.
 */
function resolveSetCode(
  tracking: DocumentTrackingData,
  group: string,
  siblingKeys?: string[],
): { code: string; year: number } | null {
  const stored = tracking._setCodes?.[group];
  if (stored) return stored;
  // Legacy migration: old tracking data may have `_setCode` / `_setYear`
  const legacy = tracking as Record<string, unknown>;
  if (typeof legacy._setCode === "string" && typeof legacy._setYear === "number") {
    return { code: legacy._setCode, year: legacy._setYear };
  }
  // Scan sibling tracking entries (same group) for an existing document number
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

// autoCreateAccountingInvoices is imported from @/lib/auto-create-invoices
