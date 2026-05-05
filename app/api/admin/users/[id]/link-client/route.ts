import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { clients, users } from "@/db/schema/core";
import { cars } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq, isNull } from "drizzle-orm";
import { getInsuredDisplayName, getInsuredType, getInsuredPrimaryId, getContactField } from "@/lib/field-resolver";

async function createClientFromFlow(carId: number, createdBy: number): Promise<{ id: number; displayName: string } | null> {
  const [carRow] = await db
    .select({ extraAttributes: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.id, carId))
    .limit(1);

  if (!carRow) return null;
  const ea = carRow.extraAttributes as Record<string, unknown> | null;
  if (!ea || ea.flowKey !== "clientSet") return null;

  const snap = (ea.insuredSnapshot ?? {}) as Record<string, unknown>;
  const category = getInsuredType(snap) || "personal";
  const displayName = getInsuredDisplayName(snap) || "Client";
  const primaryId = getInsuredPrimaryId(snap);

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (k.startsWith("_")) continue;
    extra[k] = v;
  }

  const phone = getContactField(snap, "mobile") || getContactField(snap, "tel");

  const [newClient] = await db
    .insert(clients)
    .values({
      clientNumber: `C-FLOW-${carId}`,
      category,
      displayName,
      primaryId,
      contactPhone: phone || null,
      extraAttributes: extra,
      createdBy,
    })
    .returning({ id: clients.id });

  if (newClient) {
    const paddedId = String(newClient.id).padStart(6, "0");
    await db.update(clients).set({ clientNumber: `C${paddedId}` }).where(eq(clients.id, newClient.id));
  }

  return newClient ? { id: newClient.id, displayName } : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const targetUserId = Number(id);
    if (!Number.isFinite(targetUserId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const body = await request.json();
    const rawId = body?.clientId;

    // Verify user exists
    const [targetUser] = await db
      .select({ id: users.id, userType: users.userType })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let resolvedClientId: number;
    let clientDisplayName: string;

    // Check if this is a flow record (string like "flow_123") or a table ID (number)
    if (typeof rawId === "string" && rawId.startsWith("flow_")) {
      const carId = Number(rawId.replace("flow_", ""));
      const result = await createClientFromFlow(carId, Number(me.id));
      if (!result) {
        return NextResponse.json({ error: "Failed to resolve client from flow record" }, { status: 400 });
      }
      resolvedClientId = result.id;
      clientDisplayName = result.displayName;
    } else {
      resolvedClientId = Number(rawId);
      const [clientRow] = await db
        .select({ id: clients.id, userId: clients.userId, displayName: clients.displayName })
        .from(clients)
        .where(eq(clients.id, resolvedClientId))
        .limit(1);

      if (!clientRow) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }
      if (clientRow.userId) {
        return NextResponse.json({ error: "Client already linked to another user" }, { status: 409 });
      }
      clientDisplayName = clientRow.displayName;
    }

    // Guard against one user being linked to multiple client rows.
    // direct_client should be a 1:1 mapping with a single client record.
    const [existingLinkedClient] = await db
      .select({ id: clients.id, clientNumber: clients.clientNumber })
      .from(clients)
      .where(eq(clients.userId, targetUserId))
      .limit(1);
    if (existingLinkedClient && existingLinkedClient.id !== resolvedClientId) {
      return NextResponse.json(
        { error: `User already linked to client ${existingLinkedClient.clientNumber}.` },
        { status: 409 }
      );
    }

    // Update user type to direct_client if not already
    if (targetUser.userType !== "direct_client") {
      await db.update(users).set({ userType: "direct_client" }).where(eq(users.id, targetUserId));
    }

    // Link client to user
    await db
      .update(clients)
      .set({ userId: targetUserId })
      .where(and(eq(clients.id, resolvedClientId), isNull(clients.userId)));

    return NextResponse.json({ success: true, clientName: clientDisplayName });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
