import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { clients, users, auditLog } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const me = await requireUser();
    const userId = Number(me.id);

    const [clientRow] = await db
      .select()
      .from(clients)
      .where(eq(clients.userId, userId))
      .limit(1);

    if (!clientRow) {
      return NextResponse.json({ client: null }, { status: 200 });
    }

    return NextResponse.json({
      client: {
        id: clientRow.id,
        clientNumber: clientRow.clientNumber,
        category: clientRow.category,
        displayName: clientRow.displayName,
        primaryId: clientRow.primaryId,
        contactPhone: clientRow.contactPhone,
        extraAttributes: clientRow.extraAttributes ?? {},
        isActive: clientRow.isActive,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const me = await requireUser();
    const userId = Number(me.id);

    const [clientRow] = await db
      .select({
        id: clients.id,
        category: clients.category,
        displayName: clients.displayName,
        primaryId: clients.primaryId,
        contactPhone: clients.contactPhone,
        extraAttributes: clients.extraAttributes,
      })
      .from(clients)
      .where(eq(clients.userId, userId))
      .limit(1);

    if (!clientRow) {
      return NextResponse.json({ error: "No linked client record" }, { status: 404 });
    }

    const body = await request.json();
    const { category, displayName, primaryId, contactPhone, fields } = body as {
      category?: string;
      displayName?: string;
      primaryId?: string;
      contactPhone?: string;
      fields?: Record<string, unknown>;
    };

    const updates: Record<string, unknown> = {};
    if (typeof category === "string" && category.trim()) updates.category = category.trim();
    if (typeof displayName === "string" && displayName.trim()) updates.displayName = displayName.trim();
    if (typeof primaryId === "string") updates.primaryId = primaryId.trim();
    if (typeof contactPhone === "string") updates.contactPhone = contactPhone.trim() || null;

    if (fields && typeof fields === "object") {
      const existing = (clientRow.extraAttributes ?? {}) as Record<string, unknown>;
      const merged = { ...existing };
      for (const [k, v] of Object.entries(fields)) {
        if (k.startsWith("___")) continue;
        if (v === undefined) continue;
        merged[k] = v === "" ? null : v;
      }
      updates.extraAttributes = merged;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true, message: "No changes" });
    }

    // Build diff of what changed
    const changedFields: Record<string, { from: unknown; to: unknown }> = {};
    if (updates.displayName && updates.displayName !== clientRow.displayName) {
      changedFields.displayName = { from: clientRow.displayName, to: updates.displayName };
    }
    if (updates.primaryId !== undefined && updates.primaryId !== clientRow.primaryId) {
      changedFields.primaryId = { from: clientRow.primaryId, to: updates.primaryId };
    }
    if (updates.contactPhone !== undefined && updates.contactPhone !== clientRow.contactPhone) {
      changedFields.contactPhone = { from: clientRow.contactPhone, to: updates.contactPhone };
    }
    if (updates.extraAttributes) {
      const oldExtra = (clientRow.extraAttributes ?? {}) as Record<string, unknown>;
      const newExtra = updates.extraAttributes as Record<string, unknown>;
      for (const [k, v] of Object.entries(newExtra)) {
        if (k.startsWith("_")) continue;
        const oldVal = oldExtra[k];
        if (String(v ?? "") !== String(oldVal ?? "")) {
          changedFields[k] = { from: oldVal ?? null, to: v };
        }
      }
    }

    await db.update(clients).set(updates).where(eq(clients.id, clientRow.id));

    // Also sync name to user record if displayName changed
    if (updates.displayName) {
      await db
        .update(users)
        .set({ name: updates.displayName as string, updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
    }

    // Write audit log if anything changed
    if (Object.keys(changedFields).length > 0) {
      try {
        await db.insert(auditLog).values({
          userId,
          userType: me.userType,
          action: "profile_update",
          entityType: "client",
          entityId: clientRow.id,
          changes: changedFields,
        });
      } catch (err) {
        console.error("Audit log write failed:", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
