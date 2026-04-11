import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { accountingInvoices } from "@/db/schema/accounting";
import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { autoCreateAccountingInvoices } from "@/lib/auto-create-invoices";
import { generateDocumentNumber, generateDocumentNumberWithCode, extractSetCodeFromDocNumber } from "@/lib/document-number";
import type { DocumentStatusMap, DocumentStatusEntry, DocLifecycleStatus, DocumentTrackingData } from "@/lib/types/accounting";
import { canAccessPolicy } from "@/lib/policy-access";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const policyId = Number(id);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const hasAccess = await canAccessPolicy({ id: Number(user.id), userType: user.userType }, policyId);
    if (!hasAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [policy] = await db
      .select({ documentTracking: policies.documentTracking })
      .from(policies)
      .where(eq(policies.id, policyId))
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
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const hasAccess = await canAccessPolicy({ id: Number(user.id), userType: user.userType }, policyId);
    if (!hasAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    let templateType: string | undefined;
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
      templateType = (formData.get("templateType") as string) || undefined;
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
      templateType = body.templateType;
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
    const userEmail = (user as unknown as { name?: string; email?: string }).email || `user:${user.id}`;
    const isAgentDoc = isAgentTrackingDocType(docType);

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
          status: "prepared",
          generatedAt: now,
          documentNumber: prepDocNumber,
        };
        const prepMap = { ...existing, [docType]: prepEntry };
        await db.update(policies).set({ documentTracking: prepMap }).where(eq(policies.id, policyId));
        let statusAdvanced: string | null = null;
        if (isAgentDoc) {
          statusAdvanced = await syncAgentStatus(policyId, prepMap, userEmail, `${docType.replace(/_/g, " ")} prepared`);
        } else {
          statusAdvanced = await autoAdvancePolicyStatus(policyId, docType, action, userEmail, templateType, "client");
        }
        return NextResponse.json({
          documentTracking: prepMap,
          ...(statusAdvanced ? { statusAdvanced } : {}),
        });
      }
      case "reset": {
        const updated = { ...existing };
        delete updated[docType];
        await db.update(policies).set({ documentTracking: updated }).where(eq(policies.id, policyId));
        let statusRolledBack: string | null = null;
        try {
          if (isAgentDoc) {
            statusRolledBack = await syncAgentStatus(policyId, updated, userEmail, `${docType.replace(/_/g, " ")} tracking reset`);
          } else {
            const { recalculatePolicyStatus } = await import("@/lib/auto-advance-status");
            statusRolledBack = await recalculatePolicyStatus(policyId, userEmail, `${docType.replace(/_/g, " ")} tracking reset`);
          }
        } catch (err) {
          console.error("Status recalculate on reset failed (non-fatal):", err);
        }
        return NextResponse.json({
          documentTracking: updated,
          ...(statusRolledBack ? { statusRolledBack } : {}),
        });
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

    // On reject: recalculate status (may roll back if the rejected doc caused an advance)
    let autoStatusAdvanced: string | null = null;
    let statusRolledBack: string | null = null;

    if (action === "reject") {
      try {
        if (isAgentDoc) {
          statusRolledBack = await syncAgentStatus(policyId, updatedMap, userEmail, `${docType.replace(/_/g, " ")} rejected`);
        } else {
          const { recalculatePolicyStatus } = await import("@/lib/auto-advance-status");
          statusRolledBack = await recalculatePolicyStatus(policyId, userEmail, `${docType.replace(/_/g, " ")} rejected`);
        }
      } catch (err) {
        console.error("Status recalculate on reject failed (non-fatal):", err);
      }
    } else {
      // Auto-advance policy status based on document tracking action
      try {
        if (isAgentDoc) {
          autoStatusAdvanced = await syncAgentStatus(policyId, updatedMap, userEmail, `${docType.replace(/_/g, " ")} ${action}`);
        } else {
          autoStatusAdvanced = await autoAdvancePolicyStatus(policyId, docType, action, userEmail, templateType, "client");
        }
      } catch (err) {
        console.error("Auto-advance status error (non-fatal):", err);
      }
    }

    // Auto-create accounting invoice ONLY when an actual invoice/debit_note document is
    // confirmed or sent. Receipts confirm payment (don't create new invoices), quotations
    // are pre-invoicing. Using a receipt's document number for the accounting invoice would
    // prevent the actual invoice template from using its own prefix.
    const invoiceTriggerTypes = ["invoice", "debit_note"];
    const isInvoiceType = templateType
      ? invoiceTriggerTypes.includes(templateType)
      : ["invoice", "debit_note"].some((k) => docType.includes(k) && !docType.includes("receipt"));

    if ((action === "confirm" || action === "send") && isInvoiceType) {
      try {
        const confirmedDocNumber = updatedEntry.documentNumber ?? docNumber ?? undefined;
        await autoCreateAccountingInvoices(policyId, docType, Number(user.id), confirmedDocNumber, templateType);
      } catch (err) {
        console.error("Auto-create accounting invoice error (non-fatal):", err);
      }
    }

    return NextResponse.json({
      documentTracking: updatedMap,
      ...(autoStatusAdvanced ? { statusAdvanced: autoStatusAdvanced } : {}),
      ...(statusRolledBack ? { statusRolledBack } : {}),
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

const DOC_ACTION_TO_STATUS: Record<string, Record<string, string>> = {
  quotation: { prepare: "quotation_prepared", send: "quotation_sent", confirm: "quotation_confirmed" },
  invoice:   { prepare: "invoice_prepared", send: "invoice_sent" },
  receipt:   { send: "payment_received" },
};

const ACTION_NOTE_LABELS: Record<string, string> = {
  prepare: "prepared",
  send: "sent",
  confirm: "confirmed",
};

async function autoAdvancePolicyStatus(
  policyId: number,
  docType: string,
  action: string,
  changedBy: string,
  templateType?: string,
  track: "client" | "agent" = "client",
): Promise<string | null> {
  if (action !== "send" && action !== "confirm" && action !== "prepare") return null;

  let targetStatus: string | null = null;

  if (templateType && DOC_ACTION_TO_STATUS[templateType]?.[action]) {
    targetStatus = DOC_ACTION_TO_STATUS[templateType][action];
  } else {
    const docLower = docType.toLowerCase();
    for (const [keyword, mapping] of Object.entries(DOC_ACTION_TO_STATUS)) {
      if (docLower.includes(keyword) && mapping[action]) {
        targetStatus = mapping[action];
        break;
      }
    }
  }

  if (!targetStatus) return null;

  const { advancePolicyStatus } = await import("@/lib/auto-advance-status");
  const noteLabel = ACTION_NOTE_LABELS[action] ?? action;
  return advancePolicyStatus(
    policyId,
    targetStatus,
    changedBy,
    `Auto: ${docType.replace(/_/g, " ")} ${noteLabel}`,
    track,
  );
}

// autoCreateAccountingInvoices is imported from @/lib/auto-create-invoices

function isAgentTrackingDocType(docType: string): boolean {
  return docType.toLowerCase().endsWith("_agent");
}

async function syncAgentStatus(
  policyId: number,
  tracking: DocumentTrackingData,
  changedBy: string,
  note: string,
): Promise<string | null> {
  const [[policyRow], commissionRows] = await Promise.all([
    db
      .select({
        agentId: policies.agentId,
      })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1),
    db
      .select({
        status: accountingInvoices.status,
      })
      .from(accountingInvoices)
      .where(
        and(
          eq(accountingInvoices.entityPolicyId, policyId),
          eq(accountingInvoices.entityType, "agent"),
          eq(accountingInvoices.direction, "payable"),
          eq(accountingInvoices.premiumType, "agent_premium"),
          sql`${accountingInvoices.status} <> 'cancelled'`,
        ),
      ),
  ]);

  if (!policyRow?.agentId) return null;

  const entries = Object.entries(tracking).filter(([k]) => !k.startsWith("_") && k.endsWith("_agent"));
  const hasStatus = (keywords: string[], statuses: Array<"prepared" | "sent" | "confirmed">) =>
    entries.some(([k, v]) =>
      keywords.some((kw) => k.toLowerCase().includes(kw))
      && !!v?.status
      && statuses.includes(v.status as "prepared" | "sent" | "confirmed"),
    );
  const hasPreparedDocNumber = (keywords: string[]) =>
    entries.some(([k, v]) =>
      keywords.some((kw) => k.toLowerCase().includes(kw))
      && !!v?.documentNumber
      && (!v?.status || v.status === "prepared"),
    );

  const hasStatementCreated = commissionRows.some((r) => String(r.status).toLowerCase() === "statement_created");
  const hasSettled = commissionRows.some((r) => ["paid", "verified", "settled"].includes(String(r.status).toLowerCase()));
  const hasAnyCommission = commissionRows.length > 0;

  const statementKeywords = ["statement"];
  const creditKeywords = ["credit", "commission_credit", "credit_advice", "advice"];

  let targetStatus: string | null = null;
  if (hasSettled) {
    targetStatus = "commission_settled";
  } else if (hasStatus(creditKeywords, ["confirmed"])) {
    targetStatus = "credit_advice_confirmed";
  } else if (hasStatus(creditKeywords, ["sent"])) {
    targetStatus = "credit_advice_sent";
  } else if (hasPreparedDocNumber(creditKeywords)) {
    targetStatus = "credit_advice_prepared";
  } else if (hasStatus(statementKeywords, ["confirmed"])) {
    targetStatus = "statement_confirmed";
  } else if (hasStatus(statementKeywords, ["sent"])) {
    targetStatus = "statement_sent";
  } else if (hasPreparedDocNumber(statementKeywords) || hasStatementCreated) {
    targetStatus = "statement_created";
  } else if (hasAnyCommission) {
    targetStatus = "commission_pending";
  }

  if (!targetStatus) return null;
  const { advancePolicyStatus } = await import("@/lib/auto-advance-status");
  return advancePolicyStatus(policyId, targetStatus, changedBy, `Auto agent sync: ${note}`, "agent");
}
