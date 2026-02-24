import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { memberships, organisations, users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq } from "drizzle-orm";

export async function GET() {
  try {
    const me = await requireUser();
    const userId = Number(me.id);
    // Load current user basic info
    const [u] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        userType: users.userType,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Find one organisation via membership (first one by createdAt)
    const [orgRow] = await db
      .select({
        organisationId: organisations.id,
        organisationName: organisations.name,
        contactName: organisations.contactName,
        contactEmail: organisations.contactEmail,
        contactPhone: organisations.contactPhone,
        flatNumber: organisations.flatNumber,
        floorNumber: organisations.floorNumber,
        blockNumber: organisations.blockNumber,
        blockName: organisations.blockName,
        streetNumber: organisations.streetNumber,
        streetName: organisations.streetName,
        propertyName: organisations.propertyName,
        districtName: organisations.districtName,
        area: organisations.area,
      })
      .from(memberships)
      .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
      .where(eq(memberships.userId, userId))
      .limit(1);

    return NextResponse.json(
      {
        user: u ?? null,
        organisation: orgRow
          ? {
              id: orgRow.organisationId,
              name: orgRow.organisationName,
              contactName: orgRow.contactName,
              contactEmail: orgRow.contactEmail,
              contactPhone: orgRow.contactPhone,
              flatNumber: orgRow.flatNumber,
              floorNumber: orgRow.floorNumber,
              blockNumber: orgRow.blockNumber,
              blockName: orgRow.blockName,
              streetNumber: orgRow.streetNumber,
              streetName: orgRow.streetName,
              propertyName: orgRow.propertyName,
              districtName: orgRow.districtName,
              area: orgRow.area,
            }
          : null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

