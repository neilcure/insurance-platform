import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions, formOptionGroups } from "@/db/schema/form_options";
import { and, eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { PDFDocument } from "pdf-lib";
import { savePdfTemplate } from "@/lib/storage-pdf-templates";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta, PdfPageInfo } from "@/lib/types/pdf-template";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(formOptions)
    .where(eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY))
    .orderBy(formOptions.sortOrder, desc(formOptions.id));

  return NextResponse.json(rows, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    return handleCreateBlank(request);
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const label = String(formData.get("label") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const flowsRaw = String(formData.get("flows") ?? "").trim();

  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "A PDF file is required" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "File exceeds 20MB limit" }, { status: 400 });
  }

  let pages: PdfPageInfo[];
  try {
    const pdfDoc = await PDFDocument.load(buffer);
    pages = pdfDoc.getPages().map((p) => ({
      width: p.getWidth(),
      height: p.getHeight(),
    }));
  } catch {
    return NextResponse.json({ error: "Invalid PDF file" }, { status: 400 });
  }

  const storedName = await savePdfTemplate(file.name, buffer);

  const value = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);

  const existing = await db
    .select({ id: formOptions.id })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY), eq(formOptions.value, value)))
    .limit(1);

  const finalValue = existing.length > 0 ? `${value}_${Date.now()}` : value;

  await db
    .insert(formOptionGroups)
    .values({ key: PDF_TEMPLATE_GROUP_KEY, label: "PDF Mail Merge Templates" })
    .onConflictDoNothing();

  const flows = flowsRaw ? flowsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const meta: PdfTemplateMeta = {
    filePath: storedName,
    pages,
    fields: [],
    flows,
    description: description || undefined,
  };

  const [row] = await db
    .insert(formOptions)
    .values({
      groupKey: PDF_TEMPLATE_GROUP_KEY,
      label,
      value: finalValue,
      valueType: "json",
      sortOrder: 0,
      isActive: true,
      meta: meta as unknown as Record<string, unknown>,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}

async function handleCreateBlank(request: Request) {
  const body = await request.json();
  const label = String(body.label ?? "").trim();
  const description = String(body.description ?? "").trim();

  if (!label) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 });
  }

  const blankPdf = await PDFDocument.create();
  blankPdf.addPage([595, 842]);
  const pdfBytes = await blankPdf.save();
  const buffer = Buffer.from(pdfBytes);
  const storedName = await savePdfTemplate("blank.pdf", buffer);

  const value = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);

  const existing = await db
    .select({ id: formOptions.id })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY), eq(formOptions.value, value)))
    .limit(1);

  const finalValue = existing.length > 0 ? `${value}_${Date.now()}` : value;

  await db
    .insert(formOptionGroups)
    .values({ key: PDF_TEMPLATE_GROUP_KEY, label: "PDF Mail Merge Templates" })
    .onConflictDoNothing();

  const meta: PdfTemplateMeta = {
    filePath: storedName,
    pages: [{ width: 595, height: 842, type: "blank" }],
    fields: [],
    description: description || undefined,
  };

  const [row] = await db
    .insert(formOptions)
    .values({
      groupKey: PDF_TEMPLATE_GROUP_KEY,
      label,
      value: finalValue,
      valueType: "json",
      sortOrder: 0,
      isActive: true,
      meta: meta as unknown as Record<string, unknown>,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
