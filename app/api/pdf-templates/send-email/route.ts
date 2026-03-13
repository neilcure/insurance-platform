import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { policies, cars } from "@/db/schema/insurance";
import { users, clients, organisations } from "@/db/schema/core";
import { and, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta } from "@/lib/types/pdf-template";
import { generateFilledPdf } from "@/lib/pdf/generate";
import type { MergeContext } from "@/lib/pdf/resolve-data";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();

  const body = await request.json();
  const policyId = Number(body.policyId);
  const templateIds: number[] = body.templateIds;
  const email = String(body.email ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const message = String(body.message ?? "").trim();

  if (!policyId) {
    return NextResponse.json({ error: "policyId is required" }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email address is required" }, { status: 400 });
  }
  if (!templateIds?.length) {
    return NextResponse.json({ error: "At least one templateId is required" }, { status: 400 });
  }

  const tplRows = await db
    .select()
    .from(formOptions)
    .where(
      and(
        inArray(formOptions.id, templateIds),
        eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
      ),
    );

  if (tplRows.length === 0) {
    return NextResponse.json({ error: "No templates found" }, { status: 404 });
  }

  const [policy] = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      organisationId: policies.organisationId,
      clientId: policies.clientId,
      agentId: policies.agentId,
      isActive: policies.isActive,
      createdAt: policies.createdAt,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!policy) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }

  let carRow: { plateNumber: string | null; make: string | null; model: string | null; year: string | number | null; extraAttributes: unknown } | undefined;
  try {
    const rows = await db
      .select({
        plateNumber: cars.plateNumber,
        make: cars.make,
        model: cars.model,
        year: cars.year,
        extraAttributes: cars.extraAttributes,
      })
      .from(cars)
      .where(eq(cars.policyId, policyId))
      .limit(1);
    carRow = rows[0];
  } catch { /* cars table may not exist */ }

  const extra = (carRow?.extraAttributes ?? {}) as Record<string, unknown>;
  const snapshot = {
    ...extra,
    plateNumber: carRow?.plateNumber,
    make: carRow?.make,
    model: carRow?.model,
    year: carRow?.year,
  };

  let agentData: Record<string, unknown> | null = null;
  if (policy.agentId) {
    try {
      const [agent] = await db
        .select({ id: users.id, name: users.name, email: users.email, userNumber: users.userNumber })
        .from(users)
        .where(eq(users.id, policy.agentId))
        .limit(1);
      if (agent) agentData = agent as unknown as Record<string, unknown>;
    } catch { /* ignore */ }
  }

  let clientData: Record<string, unknown> | null = null;
  const resolvedClientId = policy.clientId ?? (extra.clientId as number | undefined);
  if (resolvedClientId) {
    try {
      const [client] = await db
        .select({
          id: clients.id,
          clientNumber: clients.clientNumber,
          category: clients.category,
          displayName: clients.displayName,
          primaryId: clients.primaryId,
          contactPhone: clients.contactPhone,
          extraAttributes: clients.extraAttributes,
        })
        .from(clients)
        .where(eq(clients.id, Number(resolvedClientId)))
        .limit(1);
      if (client) {
        clientData = {
          ...client,
          ...(client.extraAttributes as Record<string, unknown> ?? {}),
        } as unknown as Record<string, unknown>;
      }
    } catch { /* ignore */ }
  }

  let orgData: Record<string, unknown> | null = null;
  if (policy.organisationId) {
    try {
      const [org] = await db
        .select()
        .from(organisations)
        .where(eq(organisations.id, policy.organisationId))
        .limit(1);
      if (org) orgData = org as unknown as Record<string, unknown>;
    } catch { /* ignore */ }
  }

  const mergeCtx: MergeContext = {
    policyNumber: policy.policyNumber,
    createdAt: policy.createdAt,
    snapshot: snapshot as Record<string, unknown> & {
      insuredSnapshot?: Record<string, unknown> | null;
      packagesSnapshot?: Record<string, unknown> | null;
    },
    agent: agentData,
    client: clientData,
    organisation: orgData,
  };

  const attachments: { content: string; name: string }[] = [];

  for (const tplRow of tplRows) {
    const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
    if (!meta?.filePath || !meta.fields?.length) continue;

    try {
      const templateBytes = await readPdfTemplate(meta.filePath);
      const filledPdf = await generateFilledPdf(templateBytes, meta.fields, mergeCtx);
      const base64 = Buffer.from(filledPdf).toString("base64");
      attachments.push({
        content: base64,
        name: `${tplRow.label} - ${policy.policyNumber}.pdf`,
      });
    } catch (err) {
      console.error(`PDF generation error for template ${tplRow.id}:`, err);
    }
  }

  if (attachments.length === 0) {
    return NextResponse.json({ error: "Failed to generate any PDFs" }, { status: 500 });
  }

  const emailSubject = subject || `Policy ${policy.policyNumber} - Documents`;
  const customMessage = message
    ? `<p style="margin-bottom:16px;white-space:pre-wrap;">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`
    : "";

  const result = await sendEmail({
    to: email,
    subject: emailSubject,
    attachments,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Policy Documents</h2>
        ${customMessage}
        <p>Please find attached ${attachments.length} document${attachments.length !== 1 ? "s" : ""} for Policy <strong>${policy.policyNumber}</strong>.</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-weight: 600;">Policy #</td>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-family: monospace;">${policy.policyNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-weight: 600;">Attachments</td>
            <td style="padding: 8px; border: 1px solid #e5e5e5;">${attachments.map((a) => a.name).join("<br>")}</td>
          </tr>
        </table>
        <p>Sent by ${user.name || user.email}.</p>
        <p style="color: #888; font-size: 12px; margin-top: 24px;">
          This email was sent from the insurance platform.
        </p>
      </div>
    `,
    text: `Policy ${policy.policyNumber} documents attached. Sent by ${user.name || user.email}.`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sent: attachments.length });
}
