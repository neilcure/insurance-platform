import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyDocuments } from "@/db/schema/documents";
import { policies } from "@/db/schema/insurance";
import { memberships } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import { readFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const user = await requireUser();
    const { id: idParam, docId: docIdParam } = await ctx.params;
    const policyId = Number(idParam);
    const docId = Number(docIdParam);

    if (!Number.isFinite(policyId) || policyId <= 0 || !Number.isFinite(docId) || docId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Verify policy access
    const isAdminLike = user.userType === "admin" || user.userType === "internal_staff";
    if (!isAdminLike) {
      const polCols = await getPolicyColumns();
      if (user.userType === "agent") {
        if (!polCols.hasAgentId) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const result = await db.execute(sql`
          SELECT 1 FROM "policies" WHERE id = ${policyId} AND agent_id = ${Number(user.id)} LIMIT 1
        `);
        const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
        if (rows.length === 0) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else {
        const rows = await db
          .select({ id: policies.id })
          .from(policies)
          .innerJoin(memberships, and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id))))
          .where(eq(policies.id, policyId))
          .limit(1);
        if (rows.length === 0) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
    }

    const [doc] = await db
      .select()
      .from(policyDocuments)
      .where(and(eq(policyDocuments.id, docId), eq(policyDocuments.policyId, policyId)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const buffer = await readFile(doc.storedPath);
    const contentType = doc.mimeType || "application/octet-stream";

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.fileName)}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
