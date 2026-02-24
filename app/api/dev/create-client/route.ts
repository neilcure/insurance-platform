import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { clients, appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const kind = (searchParams.get("type") ?? "company").toLowerCase();

    const [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.key, "client_number_prefixes")).limit(1);
    const settings = (settingsRow?.value as { companyPrefix?: string; personalPrefix?: string } | undefined) ?? {};
    const companyPrefix = (settings.companyPrefix ?? "C").trim();
    const personalPrefix = (settings.personalPrefix ?? "P").trim();

    if (kind === "personal") {
      const [created] = await db
        .insert(clients)
        .values({
          category: "personal",
          displayName: "Demo Person",
          primaryId: `PID-${Date.now()}`,
          contactPhone: null,
          extraAttributes: {
            insuredType: "personal",
            fullName: "Demo Person",
            idNumber: `PID-${Date.now()}`,
            dob: "01-01-1990",
          },
          clientNumber: "PENDING",
        })
        .returning();
      const padded = String(created.id).padStart(6, "0");
      const clientNumber = `${personalPrefix}${padded}`;
      await db.update(clients).set({ clientNumber }).where(eq(clients.id, created.id));
      return NextResponse.json({ ok: true, created: { id: created.id, clientNumber } }, { status: 201 });
    }

    // default to company
    const [created] = await db
      .insert(clients)
      .values({
        category: "company",
        displayName: "Demo Company Ltd",
        primaryId: `BR-${Date.now()}`,
        contactPhone: "91234567",
        extraAttributes: {
          insuredType: "company",
          companyName: "Demo Company Ltd",
          brNumber: `BR-${Date.now()}`,
          contactPhone: "91234567",
        },
        clientNumber: "PENDING",
      })
      .returning();
    const padded = String(created.id).padStart(6, "0");
    const clientNumber = `${companyPrefix}${padded}`;
    await db.update(clients).set({ clientNumber }).where(eq(clients.id, created.id));
    return NextResponse.json({ ok: true, created: { id: created.id, clientNumber } }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

