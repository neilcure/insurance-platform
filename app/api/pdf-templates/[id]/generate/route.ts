import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { policies, cars } from "@/db/schema/insurance";
import { users, clients, organisations } from "@/db/schema/core";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta } from "@/lib/types/pdf-template";
import { generateFilledPdf } from "@/lib/pdf/generate";
import type { MergeContext } from "@/lib/pdf/resolve-data";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireUser();

  const { id } = await ctx.params;
  const body = await request.json();
  const policyId = Number(body.policyId);

  if (!policyId) {
    return NextResponse.json({ error: "policyId is required" }, { status: 400 });
  }

  const [tplRow] = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.id, Number(id)),
        eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
      ),
    )
    .limit(1);

  if (!tplRow) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
  if (!meta?.filePath || !meta.fields?.length) {
    return NextResponse.json(
      { error: "Template has no PDF or field mappings" },
      { status: 400 },
    );
  }

  const [policy] = await db
    .select()
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
    const [agent] = await db
      .select({ id: users.id, name: users.name, email: users.email, userNumber: users.userNumber })
      .from(users)
      .where(eq(users.id, policy.agentId))
      .limit(1);
    if (agent) agentData = agent as unknown as Record<string, unknown>;
  }

  let clientData: Record<string, unknown> | null = null;
  const clientId = policy.clientId ?? (extra.clientId as number | undefined);
  if (clientId) {
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, Number(clientId)))
      .limit(1);
    if (client) {
      clientData = {
        ...client,
        ...(client.extraAttributes as Record<string, unknown> ?? {}),
      } as unknown as Record<string, unknown>;
    }
  }

  let orgData: Record<string, unknown> | null = null;
  if (policy.organisationId) {
    const [org] = await db
      .select()
      .from(organisations)
      .where(eq(organisations.id, policy.organisationId))
      .limit(1);
    if (org) orgData = org as unknown as Record<string, unknown>;
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

  const templateBytes = await readPdfTemplate(meta.filePath);
  const filledPdf = await generateFilledPdf(templateBytes, meta.fields, mergeCtx);

  return new NextResponse(filledPdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${tplRow.label} - ${policy.policyNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
