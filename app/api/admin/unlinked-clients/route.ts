import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { clients } from "@/db/schema/core";
import { cars } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { isNull, asc, sql } from "drizzle-orm";
import { getInsuredDisplayName, getInsuredType, getInsuredPrimaryId } from "@/lib/field-resolver";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const me = await requireUser();
    if (!["admin", "internal_staff"].includes(me.userType)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 1. Clients table rows that aren't linked yet
    const tableClients = await db
      .select({
        id: clients.id,
        clientNumber: clients.clientNumber,
        displayName: clients.displayName,
        category: clients.category,
        primaryId: clients.primaryId,
      })
      .from(clients)
      .where(isNull(clients.userId))
      .orderBy(asc(clients.displayName));

    // 2. clientSet flow records (stored in cars table) — the main source of client data
    const flowClients = await db
      .select({
        carId: cars.id,
        extraAttributes: cars.extraAttributes,
      })
      .from(cars)
      .where(sql`${cars.extraAttributes}->>'flowKey' = 'clientSet'`);

    type ResultRow = {
      id: number | string;
      clientNumber: string;
      displayName: string;
      category: string;
      primaryId: string;
      source: "table" | "flow";
    };

    const results: ResultRow[] = tableClients.map((c) => ({
      ...c,
      source: "table" as const,
    }));

    for (const fc of flowClients) {
      const ea = fc.extraAttributes as Record<string, unknown> | null;
      if (!ea) continue;
      const snap = ea.insuredSnapshot as Record<string, unknown> | null;
      if (!snap) continue;

      const category = getInsuredType(snap) || "personal";
      const displayName = getInsuredDisplayName(snap) || "Unknown Client";
      const primaryId = getInsuredPrimaryId(snap);

      results.push({
        id: `flow_${fc.carId}`,
        clientNumber: `—`,
        displayName,
        category,
        primaryId,
        source: "flow",
      });
    }

    results.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
