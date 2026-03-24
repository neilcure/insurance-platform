import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingDocuments } from "@/db/schema/accounting";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { validateFile } from "@/lib/storage";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ACCOUNTING_UPLOADS_ROOT = path.join(process.cwd(), ".uploads", "accounting");

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const docType = (formData.get("docType") as string) || "invoice";
    const paymentId = formData.get("paymentId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const validation = validateFile(file.name, file.type, file.size);
    if (!validation.valid) {
      return NextResponse.json({ error: (validation as any).error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const dir = path.join(ACCOUNTING_UPLOADS_ROOT, String(invoiceId));
    await fs.mkdir(dir, { recursive: true });

    const uuid = crypto.randomUUID();
    const ext = path.extname(file.name).toLowerCase();
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
    const storedName = `${uuid}-${sanitized}`;
    const fullPath = path.join(dir, storedName);

    await fs.writeFile(fullPath, buffer);
    const storedPath = `accounting/${invoiceId}/${storedName}`;

    const [doc] = await db
      .insert(accountingDocuments)
      .values({
        invoiceId,
        paymentId: paymentId ? Number(paymentId) : null,
        docType,
        fileName: file.name,
        storedPath,
        fileSize: file.size,
        mimeType: file.type,
        uploadedBy: Number(user.id),
      })
      .returning();

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/invoices/[id]/documents error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);

    const docs = await db
      .select()
      .from(accountingDocuments)
      .where(eq(accountingDocuments.invoiceId, invoiceId));

    return NextResponse.json(docs);
  } catch (err) {
    console.error("GET /api/accounting/invoices/[id]/documents error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
