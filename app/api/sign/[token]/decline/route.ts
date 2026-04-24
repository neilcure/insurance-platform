import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import {
  getSigningSession,
  isSessionOpenable,
  markSigningSessionDeclined,
} from "@/lib/signing-sessions";
import type { DocumentStatusEntry, DocumentTrackingData } from "@/lib/types/accounting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated endpoint hit when a recipient on the
 * `/sign/<token>` page chooses to decline / request changes
 * instead of signing. The unguessable token in the URL is the
 * credential — same model as the sign-submit endpoint.
 *
 * On success we:
 *   1. Mark the signing session as declined (stores reason +
 *      timestamp so the sender can see WHY).
 *   2. Flip the matching documentTracking entry to "rejected"
 *      with the reason copied to `rejectionNote`. This mirrors
 *      what an in-app admin would see if they hit the existing
 *      "reject" path.
 *
 * We deliberately do NOT touch the policy status — declines
 * shouldn't auto-rewind workflow status. The agent decides what
 * to do next (resend a corrected version, escalate, etc.).
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    const session = await getSigningSession(token);
    if (!session) {
      return NextResponse.json({ error: "Signing link not found" }, { status: 404 });
    }
    if (session.signedAt) {
      return NextResponse.json(
        { error: "This document has already been signed and can't be declined." },
        { status: 409 },
      );
    }
    if (session.declinedAt) {
      return NextResponse.json(
        { error: "This document has already been declined." },
        { status: 409 },
      );
    }
    if (!isSessionOpenable(session)) {
      return NextResponse.json(
        { error: "This signing link has expired." },
        { status: 410 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const reason = String(body?.reason ?? "").trim();
    // We require a reason — declining without context isn't useful
    // to the sender (they can't fix what they don't know is wrong).
    // Cap min length at 3 chars to allow short answers like "N/A"
    // while still gating the empty-submit case.
    if (reason.length < 3) {
      return NextResponse.json(
        { error: "Please provide a short reason so the sender can follow up." },
        { status: 400 },
      );
    }

    const declinedAtIso = new Date().toISOString();
    const updated = await markSigningSessionDeclined({
      token,
      reason,
      declinedAt: declinedAtIso,
    });
    if (!updated) {
      return NextResponse.json(
        { error: "Failed to record decline" },
        { status: 500 },
      );
    }

    // Mirror onto policies.documentTracking so the sender's UI
    // surfaces the decline immediately. Best-effort — if the
    // policy was deleted between sending and declining, the
    // session is still marked declined and the sender can see it
    // when they re-open the (gone) link.
    try {
      const [policyRow] = await db
        .select({ documentTracking: policies.documentTracking })
        .from(policies)
        .where(eq(policies.id, session.policyId))
        .limit(1);
      if (policyRow) {
        const existing: DocumentTrackingData =
          (policyRow.documentTracking as DocumentTrackingData | null) ?? {};
        const prevEntry: DocumentStatusEntry =
          existing[session.trackingKey] ?? ({ status: "sent" } as DocumentStatusEntry);
        const declinerLabel =
          session.recipientName || session.recipientEmail || "Recipient";
        const nextEntry: DocumentStatusEntry = {
          ...prevEntry,
          status: "rejected",
          rejectedAt: declinedAtIso,
          rejectedBy: declinerLabel,
          rejectionNote: reason,
        };
        const nextMap: DocumentTrackingData = {
          ...existing,
          [session.trackingKey]: nextEntry,
        };
        await db
          .update(policies)
          .set({ documentTracking: nextMap })
          .where(eq(policies.id, session.policyId));
      }
    } catch (err) {
      console.error("[/api/sign/decline] tracking update failed (non-fatal):", err);
    }

    return NextResponse.json({ ok: true, declinedAt: declinedAtIso });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    console.error("[/api/sign/decline] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
