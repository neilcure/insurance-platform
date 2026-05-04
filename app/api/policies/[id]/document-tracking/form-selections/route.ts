/**
 * PUT /api/policies/[id]/document-tracking/form-selections
 *
 * Persists the user's interactive form picks (checkboxes / radio
 * groups) for a single PDF template against a single policy. The
 * picks live inside the existing `policies.documentTracking[docType]`
 * jsonb entry under a `formSelections` field, so the same record
 * already holds the doc's lifecycle (sent / confirmed / rejected /
 * documentNumber / proof / etc.) — both sides of "this PDF on this
 * policy" stay together.
 *
 * Deliberately separate from the action-based POST route in
 * ./route.ts: saving a checkbox tick must NOT auto-advance the
 * policy status, generate document numbers, or create accounting
 * invoices. This is a pure value-store call.
 *
 * Body shape:
 *   {
 *     "docType": "<trackingKey>",                  // required
 *     "checkboxes": { "<cbId>": true | false, ... }, // optional
 *     "radioGroups": { "<rgId>": "<value>", ... },  // optional
 *     "textInputs": { "<inputId>": "<value>", ... }  // optional
 *   }
 *
 * Pass empty maps (or `null`) to clear.
 * Returns the full updated documentTracking map so callers can
 * cache-invalidate exactly like the action route.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canAccessPolicy } from "@/lib/policy-access";
import { updateDocumentTracking } from "@/lib/document-tracking/atomic-update";
import type {
  DocumentStatusEntry,
  DocumentTrackingData,
} from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

type Body = {
  docType?: string;
  checkboxes?: Record<string, boolean> | null;
  radioGroups?: Record<string, string> | null;
  textInputs?: Record<string, string> | null;
};

function sanitizeCheckboxes(input: unknown): Record<string, boolean> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeRadios(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    // Allow empty string — represents an explicit "no choice".
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeTextInputs(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function PUT(
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
    const hasAccess = await canAccessPolicy(
      { id: Number(user.id), userType: user.userType },
      policyId,
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as Body;
    const docType = typeof body.docType === "string" ? body.docType.trim() : "";
    if (!docType) {
      return NextResponse.json({ error: "docType is required" }, { status: 400 });
    }
    // Reject the synthetic key the action route uses to track set
    // codes — that bucket is not a real document.
    if (docType.startsWith("_")) {
      return NextResponse.json({ error: "Invalid docType" }, { status: 400 });
    }

    const checkboxes = sanitizeCheckboxes(body.checkboxes);
    const radioGroups = sanitizeRadios(body.radioGroups);
    const textInputs = sanitizeTextInputs(body.textInputs);

    // Both null/empty → drop the key so the entry stays slim and
    // future reads fall back to the template's defaultChecked /
    // defaultValue without any ambiguity.
    const formSelections =
      checkboxes || radioGroups || textInputs
        ? {
            ...(checkboxes ? { checkboxes } : {}),
            ...(radioGroups ? { radioGroups } : {}),
            ...(textInputs ? { textInputs } : {}),
          }
        : undefined;

    const updated = await updateDocumentTracking(policyId, (current) => {
      const prevEntry: DocumentStatusEntry =
        (current[docType] as DocumentStatusEntry | undefined) ?? ({} as DocumentStatusEntry);

      // Preserve every other field on the entry — we ONLY touch
      // formSelections here. This is the whole reason we go through
      // the atomic helper: a concurrent /document-tracking POST
      // (send / confirm / reject) might be racing us, and we MUST
      // re-read its latest fields under the lock instead of using
      // a stale snapshot.
      const nextEntry: DocumentStatusEntry = {
        ...prevEntry,
        ...(formSelections ? { formSelections } : {}),
      };
      if (!formSelections && prevEntry.formSelections) {
        delete (nextEntry as DocumentStatusEntry).formSelections;
      }

      // If the entry has nothing on it at all (no status, no number,
      // no formSelections) we still keep it absent rather than write
      // a stub — keeps the jsonb tidy for new policies.
      const isEntryEmpty =
        !nextEntry.status &&
        !nextEntry.documentNumber &&
        !nextEntry.formSelections &&
        !nextEntry.sentAt &&
        !nextEntry.confirmedAt &&
        !nextEntry.rejectedAt;

      const next: DocumentTrackingData = { ...current };
      if (isEntryEmpty) {
        delete next[docType];
      } else {
        next[docType] = nextEntry;
      }
      return next;
    });

    if (updated === null) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    return NextResponse.json({ documentTracking: updated });
  } catch (err) {
    console.error("PUT document-tracking/form-selections error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
