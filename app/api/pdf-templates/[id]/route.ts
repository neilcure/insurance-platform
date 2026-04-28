import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { deletePdfTemplate } from "@/lib/storage-pdf-templates";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta } from "@/lib/types/pdf-template";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const [row] = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.id, Number(id)),
        eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json();

  const [existing] = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.id, Number(id)),
        eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
      ),
    )
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const currentMeta = (existing.meta ?? {}) as unknown as PdfTemplateMeta;

  const updates: Record<string, unknown> = {};

  if (typeof body.label === "string") {
    updates.label = body.label.trim();
  }
  if (typeof body.isActive === "boolean") {
    updates.isActive = body.isActive;
  }
  if (typeof body.sortOrder === "number") {
    updates.sortOrder = body.sortOrder;
  }

  const newMeta: PdfTemplateMeta = { ...currentMeta };

  if (Array.isArray(body.fields)) {
    newMeta.fields = body.fields;
  }
  if (Array.isArray(body.sections)) {
    newMeta.sections = body.sections;
  }
  if (Array.isArray(body.images)) {
    newMeta.images = body.images;
  }
  if (Array.isArray(body.drawings)) {
    newMeta.drawings = body.drawings;
  }
  if (Array.isArray(body.checkboxes)) {
    newMeta.checkboxes = body.checkboxes;
  }
  if (Array.isArray(body.radioGroups)) {
    newMeta.radioGroups = body.radioGroups;
  }
  if (Array.isArray(body.pages)) {
    newMeta.pages = body.pages;
  }
  if (Array.isArray(body.flows)) {
    newMeta.flows = body.flows;
  }
  if (Array.isArray(body.showWhenStatus)) {
    newMeta.showWhenStatus = body.showWhenStatus;
  }
  if (Array.isArray(body.insurerPolicyIds)) {
    newMeta.insurerPolicyIds = body.insurerPolicyIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0);
  }
  if (typeof body.description === "string") {
    newMeta.description = body.description;
  }
  if ("accountingLineKey" in body) {
    newMeta.accountingLineKey = typeof body.accountingLineKey === "string" ? body.accountingLineKey : undefined;
  }
  if ("repeatableSlots" in body) {
    const raw = Number(body.repeatableSlots);
    if (Number.isFinite(raw) && raw > 0) {
      // Cap to a sensible upper bound so a typo can't spawn thousands
      // of synthetic field-picker entries and freeze the editor.
      newMeta.repeatableSlots = Math.min(Math.floor(raw), 20);
    } else {
      newMeta.repeatableSlots = undefined;
    }
  }

  updates.meta = newMeta as unknown as Record<string, unknown>;

  const [updated] = await db
    .update(formOptions)
    .set(updates)
    .where(eq(formOptions.id, Number(id)))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const [row] = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.id, Number(id)),
        eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = row.meta as unknown as PdfTemplateMeta | null;
  if (meta?.filePath) {
    await deletePdfTemplate(meta.filePath);
  }

  await db.delete(formOptions).where(eq(formOptions.id, Number(id)));

  return NextResponse.json({ ok: true });
}
