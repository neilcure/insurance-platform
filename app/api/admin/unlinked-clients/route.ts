import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { clients } from "@/db/schema/core";
import { cars } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { isNull, asc, sql } from "drizzle-orm";

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

      const category = String(snap.insuredType ?? snap.insured_category ?? snap.insured__category ?? "personal").toLowerCase();
      const isCompany = category === "company";

      let displayName = "";
      let primaryId = "";

      if (isCompany) {
        displayName = String(snap["insured__companyName"] ?? snap["insured__companyname"] ?? snap["insured_companyname"] ?? "");
        primaryId = String(snap["insured__brNumber"] ?? snap["insured__brnumber"] ?? snap["insured_brnumber"] ?? "");
      } else {
        const last = String(snap["insured__lastname"] ?? snap["insured_lastname"] ?? "");
        const first = String(snap["insured__firstname"] ?? snap["insured_firstname"] ?? "");
        displayName = [last, first].filter(Boolean).join(" ");
        primaryId = String(snap["insured__idNumber"] ?? snap["insured__idnumber"] ?? snap["insured_idnumber"] ?? "");
      }

      if (!displayName) displayName = "Unknown Client";

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
