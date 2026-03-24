import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { readFile } from "@/lib/storage";
import path from "node:path";
import type { DocumentStatusMap } from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const isAdminLike = user.userType === "admin" || user.userType === "internal_staff";
    if (!isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const policyId = Number(id);
    const url = new URL(request.url);
    const docType = url.searchParams.get("docType");

    if (!docType) {
      return NextResponse.json({ error: "Missing docType" }, { status: 400 });
    }

    const [policy] = await db
      .select({ documentTracking: policies.documentTracking })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const tracking = (policy.documentTracking as DocumentStatusMap | null) ?? {};
    const entry = tracking[docType];

    if (!entry?.confirmProofPath) {
      return NextResponse.json({ error: "No proof file found" }, { status: 404 });
    }

    const buffer = await readFile(entry.confirmProofPath);
    const ext = path.extname(entry.confirmProofPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";
    const fileName = entry.confirmProofName || `proof${ext}`;

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    console.error("GET proof file error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
