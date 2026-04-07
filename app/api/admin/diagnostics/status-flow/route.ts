import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";
import { STATUS_ORDER } from "@/lib/auto-advance-status";

export const dynamic = "force-dynamic";

const DOC_ACTION_TO_STATUS: Record<string, Record<string, string>> = {
  quotation: { prepare: "quotation_prepared", send: "quotation_sent", confirm: "quotation_confirmed" },
  invoice:   { prepare: "invoice_prepared", send: "invoice_sent" },
  receipt:   { send: "payment_received" },
};

const AUTO_CHAIN: Record<string, { next: string; note: string }> = {
  quotation_confirmed: { next: "invoice_prepared", note: "Auto: invoice template ready" },
};

export async function GET(request: Request) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const policyNumber = url.searchParams.get("policyNumber")?.trim();

  let policyDiag: {
    policyId: number;
    policyNumber: string;
    currentStatus: string;
    statusHistory: Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>;
    flowKey: string | null;
    currentStepIndex: number;
    nextExpectedAction: string | null;
  } | null = null;

  if (policyNumber) {
    const [row] = await db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        flowKey: policies.flowKey,
        extraAttributes: cars.extraAttributes,
      })
      .from(policies)
      .innerJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.policyNumber, policyNumber))
      .limit(1);

    if (row) {
      const extra = (row.extraAttributes ?? {}) as Record<string, unknown>;
      const currentStatus = (extra.status as string) || "quotation_prepared";
      const history = Array.isArray(extra.statusHistory)
        ? (extra.statusHistory as Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>)
        : [];

      const currentIdx = STATUS_ORDER.indexOf(currentStatus as (typeof STATUS_ORDER)[number]);
      let nextAction: string | null = null;
      if (currentStatus === "quotation_prepared") nextAction = "Send quotation document";
      else if (currentStatus === "quotation_sent") nextAction = "Confirm quotation (agent/client sends back or admin confirms)";
      else if (currentStatus === "quotation_confirmed" || currentStatus === "invoice_prepared") nextAction = "Send invoice document";
      else if (currentStatus === "invoice_sent") nextAction = "Upload & verify payment proof, or send receipt";
      else if (currentStatus === "payment_received") nextAction = "Admin override to 'completed' or workflow is done";
      else if (currentStatus === "completed") nextAction = null;

      policyDiag = {
        policyId: row.policyId,
        policyNumber: row.policyNumber,
        currentStatus,
        statusHistory: history,
        flowKey: row.flowKey,
        currentStepIndex: currentIdx,
        nextExpectedAction: nextAction,
      };
    }
  }

  const flowSteps = STATUS_ORDER.map((s, i) => ({
    index: i,
    status: s,
    label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  }));

  const docTriggers = Object.entries(DOC_ACTION_TO_STATUS).flatMap(([docType, actions]) =>
    Object.entries(actions).map(([action, targetStatus]) => ({
      docType,
      action,
      targetStatus,
      targetLabel: targetStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    })),
  );

  const chains = Object.entries(AUTO_CHAIN).map(([from, to]) => ({
    from,
    fromLabel: from.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    to: to.next,
    toLabel: to.next.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    note: to.note,
  }));

  const paymentTriggers = [
    { trigger: "Payment proof uploaded by admin", targetStatus: "payment_received" },
    { trigger: "Payment proof verified (agent/client upload)", targetStatus: "payment_received" },
    { trigger: "Receipt document sent", targetStatus: "payment_received" },
  ];

  const rollbackTriggers = [
    { trigger: "Document tracking rejected (quotation/invoice)", effect: "Recalculates status from current tracking state" },
    { trigger: "Document tracking reset", effect: "Recalculates status from current tracking state" },
    { trigger: "Upload document rejected (was verified)", effect: "Recalculates status — if payment proof rejected, rolls back from payment_received" },
    { trigger: "Payment document deleted", effect: "Recalculates status — removes payment evidence, may roll back" },
  ];

  return NextResponse.json({
    flowSteps,
    docTriggers,
    chains,
    paymentTriggers,
    rollbackTriggers,
    policyDiag,
  });
}
