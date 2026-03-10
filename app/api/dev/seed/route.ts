import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { organisations, memberships, users } from "@/db/schema/core";
import { formOptionGroups, formOptions } from "@/db/schema/form_options";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({} as any));
  const force = Boolean((body as any)?.force);

  const email = "agent@example.com";
  const password = "demo1234";
  const role = "agent" as const;
  const adminEmail = "admin@example.com";
  const adminPassword = "demo1234";

  try {
    // Ensure organisation
    let orgId: number;
    const existingOrgs = await db.select().from(organisations).where(eq(organisations.name, "Demo Org")).limit(1);
    if (existingOrgs.length > 0) {
      orgId = existingOrgs[0].id;
    } else {
      const [org] = await db.insert(organisations).values({ name: "Demo Org" }).returning();
      orgId = org.id;
    }

    // Ensure agent user
    let userId: number;
    const existingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUsers.length > 0) {
      userId = existingUsers[0].id;
    } else {
      const passwordHash = await hash(password, 10);
      const [user] = await db
        .insert(users)
        .values({ email, passwordHash, userType: role, name: "Demo Agent" })
        .returning();
      userId = user.id;
    }

    // Ensure membership
    const existingMembership = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1);
    if (existingMembership.length === 0) {
      await db.insert(memberships).values({ userId, organisationId: orgId, role: "member" });
    }

    // Ensure admin user
    const existingAdmins = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    if (existingAdmins.length === 0) {
      const adminHash = await hash(adminPassword, 10);
      await db.insert(users).values({ email: adminEmail, passwordHash: adminHash, userType: "admin" as const, name: "Demo Admin" });
    }

    async function groupHasAnyOption(groupKey: string): Promise<boolean> {
      const rows = await db.select({ id: formOptions.id }).from(formOptions).where(eq(formOptions.groupKey, groupKey)).limit(1);
      return rows.length > 0;
    }

    async function maybeClearGroup(groupKey: string) {
      if (!force) return;
      await db.delete(formOptions).where(eq(formOptions.groupKey, groupKey));
    }

    // Seed vehicle_category group/options if missing
    await db
      .insert(formOptionGroups)
      .values({ key: "vehicle_category", label: "Vehicle Category" })
      .onConflictDoNothing();
    if (force || !(await groupHasAnyOption("vehicle_category"))) {
      await maybeClearGroup("vehicle_category");
      const vehicleOptions = [
        { label: "Commercial", value: "commercial", sortOrder: 10 },
        { label: "Private", value: "private", sortOrder: 20 },
        { label: "Solo", value: "solo", sortOrder: 30 },
      ];
      for (const opt of vehicleOptions) {
        await db
          .insert(formOptions)
          .values({
            groupKey: "vehicle_category",
            label: opt.label,
            value: opt.value,
            valueType: "string",
            sortOrder: opt.sortOrder,
            isActive: true,
            meta: null,
          })
          .onConflictDoNothing();
      }
    }

    // Seed vehicle_fields common fields if missing
    await db
      .insert(formOptionGroups)
      .values({ key: "vehicle_fields", label: "Vehicle Fields" })
      .onConflictDoNothing();
    type VehicleFieldMeta = { inputType: "string" | "number"; required?: boolean };
    if (force || !(await groupHasAnyOption("vehicle_fields"))) {
      await maybeClearGroup("vehicle_fields");
      const commonFields: Array<{ label: string; value: string; sortOrder: number; meta: VehicleFieldMeta }> = [
        { label: "Plate No", value: "plateNo", sortOrder: 10, meta: { inputType: "string", required: true } },
        { label: "Make", value: "make", sortOrder: 20, meta: { inputType: "string" } },
        { label: "Model", value: "model", sortOrder: 30, meta: { inputType: "string" } },
        { label: "Year", value: "year", sortOrder: 40, meta: { inputType: "number" } },
        { label: "Body Type", value: "bodyType", sortOrder: 50, meta: { inputType: "string" } },
        { label: "Engine No", value: "engineNo", sortOrder: 60, meta: { inputType: "string" } },
        { label: "Chassis No", value: "chassisNo", sortOrder: 70, meta: { inputType: "string" } },
        { label: "Sum Insured", value: "sumInsured", sortOrder: 80, meta: { inputType: "number" } },
      ];
      for (const f of commonFields) {
        await db
          .insert(formOptions)
          .values({
            groupKey: "vehicle_fields",
            label: f.label,
            value: f.value,
            valueType: f.meta.inputType === "number" ? "number" : "string",
            sortOrder: f.sortOrder,
            isActive: true,
            meta: f.meta as Record<string, unknown>,
          })
          .onConflictDoNothing();
      }
    }

    // Seed insured_category categories (Company/Personal)
    await db.insert(formOptionGroups).values({ key: "insured_category", label: "Insured Category" }).onConflictDoNothing();
    if (force || !(await groupHasAnyOption("insured_category"))) {
      await maybeClearGroup("insured_category");
      const insuredCategories = [
        { label: "Company", value: "company", sortOrder: 10 },
        { label: "Personal", value: "personal", sortOrder: 20 },
      ];
      for (const cat of insuredCategories) {
        await db
          .insert(formOptions)
          .values({
            groupKey: "insured_category",
            label: cat.label,
            value: cat.value,
            valueType: "string",
            sortOrder: cat.sortOrder,
            isActive: true,
            meta: null,
          })
          .onConflictDoNothing();
      }
    }

    // Seed insured_fields (dynamic fields for Step 1) with insured_* prefixed keys
    await db.insert(formOptionGroups).values({ key: "insured_fields", label: "Insured Fields" }).onConflictDoNothing();
    type InsuredFieldMeta = { inputType: "string" | "number"; required?: boolean; categories: Array<"company" | "personal"> };
    // Important: if you delete/customize insured fields, re-running seed should NOT "restore" them unless force=true.
    if (force || !(await groupHasAnyOption("insured_fields"))) {
      await maybeClearGroup("insured_fields");
      const insuredFields: Array<{ label: string; value: string; sortOrder: number; meta: InsuredFieldMeta }> = [
        // Company
        { label: "Company Name", value: "insured_companyName", sortOrder: 10, meta: { inputType: "string", required: true, categories: ["company"] } },
        { label: "BR Number", value: "insured_brNumber", sortOrder: 20, meta: { inputType: "string", required: true, categories: ["company"] } },
        // Personal
        { label: "Full Name", value: "insured_fullName", sortOrder: 10, meta: { inputType: "string", required: true, categories: ["personal"] } },
        { label: "ID Number", value: "insured_idNumber", sortOrder: 20, meta: { inputType: "string", required: true, categories: ["personal"] } },
      ];
      for (const f of insuredFields) {
        await db
          .insert(formOptions)
          .values({
            groupKey: "insured_fields",
            label: f.label,
            value: f.value,
            valueType: f.meta.inputType === "number" ? "number" : "string",
            sortOrder: f.sortOrder,
            isActive: true,
            meta: f.meta as Record<string, unknown>,
          })
          .onConflictDoNothing();
      }
    }

    return NextResponse.json({ email, password, role, seeded: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Seed failed" }, { status: 500 });
  }
}











