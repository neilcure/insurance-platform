import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyDocuments } from "@/db/schema/documents";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { deleteFile } from "@/lib/storage";
import { appendPolicyAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Only admins can verify/reject documents" }, { status: 403 });
    }

    const { docId: docIdParam } = await ctx.params;
    const docId = Number(docIdParam);
    if (!Number.isFinite(docId) || docId <= 0) {
      return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
    }

    const body = (await request.json()) as {
      status?: "verified" | "rejected";
      rejectionNote?: string;
    };

    if (!body.status || !["verified", "rejected"].includes(body.status)) {
      return NextResponse.json({ error: "status must be 'verified' or 'rejected'" }, { status: 400 });
    }

    const [existing] = await db
      .select({
        id: policyDocuments.id,
        policyId: policyDocuments.policyId,
        fileName: policyDocuments.fileName,
        documentTypeKey: policyDocuments.documentTypeKey,
        status: policyDocuments.status,
      })
      .from(policyDocuments)
      .where(eq(policyDocuments.id, docId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {
      status: body.status,
    };

    if (body.status === "verified") {
      updateData.verifiedBy = Number(user.id);
      updateData.verifiedAt = new Date().toISOString();
      updateData.rejectionNote = null;
    } else {
      updateData.rejectionNote = body.rejectionNote || "Rejected by admin";
      updateData.verifiedBy = null;
      updateData.verifiedAt = null;
    }

    const [updated] = await db
      .update(policyDocuments)
      .set(updateData)
      .where(eq(policyDocuments.id, docId))
      .returning();

    const userEmail = (user as { email?: string }).email ?? "";
    const auditChanges: { key: string; from: string | null; to: string | null }[] = [
      { key: "document_status", from: existing.status, to: body.status },
    ];
    if (body.status === "rejected" && body.rejectionNote) {
      auditChanges.push({ key: "document_rejection_note", from: null, to: body.rejectionNote });
    }
    await appendPolicyAudit(existing.policyId, { id: Number(user.id), email: userEmail }, [
      { key: `document_${body.status}`, from: existing.fileName, to: `${existing.fileName} (${existing.documentTypeKey})` },
      ...auditChanges,
    ]);

    if (body.status === "verified") {
      const { checkAndAutoComplete } = await import("@/lib/reminder-sender");
      await checkAndAutoComplete(existing.policyId, existing.documentTypeKey);
    }

    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Only admins can delete documents" }, { status: 403 });
    }

    const { docId: docIdParam } = await ctx.params;
    const docId = Number(docIdParam);
    if (!Number.isFinite(docId) || docId <= 0) {
      return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
    }

    const [doc] = await db
      .select({
        id: policyDocuments.id,
        policyId: policyDocuments.policyId,
        storedPath: policyDocuments.storedPath,
        fileName: policyDocuments.fileName,
        documentTypeKey: policyDocuments.documentTypeKey,
      })
      .from(policyDocuments)
      .where(eq(policyDocuments.id, docId))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await deleteFile(doc.storedPath);
    await db.delete(policyDocuments).where(eq(policyDocuments.id, docId));

    const userEmail = (user as { email?: string }).email ?? "";
    await appendPolicyAudit(doc.policyId, { id: Number(user.id), email: userEmail }, [
      { key: "document_delete", from: `${doc.fileName} (${doc.documentTypeKey})`, to: null },
    ]);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
