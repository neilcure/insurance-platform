import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { memberships, organisations } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const toOptionalTrimmedString = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? undefined : t;
  }
  return v;
};

const Body = z
  .object({
    name: z.preprocess(toOptionalTrimmedString, z.string().min(1, "Organisation name is required").max(255).optional()),
    contactName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    contactEmail: z.preprocess(toOptionalTrimmedString, z.string().email().optional()),
    contactPhone: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    flatNumber: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    floorNumber: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    blockNumber: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    blockName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    streetNumber: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    streetName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    propertyName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    districtName: z.preprocess(toOptionalTrimmedString, z.string().optional()),
    area: z.preprocess(toOptionalTrimmedString, z.string().optional()),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "No changes provided",
  });

export async function PATCH(request: NextRequest) {
  try {
    const me = await requireUser();
    const json = await request.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // Resolve the organisation via membership for the current user
    let [m] = await db
      .select({ organisationId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, Number(me.id)))
      .limit(1);

    const values = parsed.data;
    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 });
    }

    // If user has no organisation membership yet, create one on-the-fly
    if (!m) {
      const fallbackName =
        values.name ??
        (typeof me.name === "string" && me.name.trim().length > 0
          ? `${me.name.trim()} Organisation`
          : "My Organisation");
      const [org] = await db.insert(organisations).values({ name: fallbackName }).returning({
        id: organisations.id,
      });
      await db.insert(memberships).values({
        userId: Number(me.id),
        organisationId: org.id,
        role: "member",
      });
      m = { organisationId: org.id };
    }

    const [updated] = await db
      .update(organisations)
      .set({
        name: values.name,
        contactName: values.contactName,
        contactEmail: values.contactEmail,
        contactPhone: values.contactPhone,
        flatNumber: values.flatNumber,
        floorNumber: values.floorNumber,
        blockNumber: values.blockNumber,
        blockName: values.blockName,
        streetNumber: values.streetNumber,
        streetName: values.streetName,
        propertyName: values.propertyName,
        districtName: values.districtName,
        area: values.area,
        updatedAt: new Date().toISOString() as unknown as any,
      })
      .where(eq(organisations.id, m.organisationId))
      .returning({
        id: organisations.id,
        name: organisations.name,
      });

    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

