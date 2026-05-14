import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { requireUser, type SessionUser } from "@/lib/auth/require-user";
import { resolveActiveOrgId, ActiveOrgError } from "@/lib/auth/active-org";
import { orgViewPresetsStorageKey } from "@/lib/view-presets/storage-keys";
import type { ViewPreset } from "@/lib/view-presets/types";

function isAdminLike(user: SessionUser): boolean {
  return user.userType === "admin" || user.userType === "internal_staff";
}

async function fetchOrgPresets(orgId: number, scope: string): Promise<ViewPreset[]> {
  const key = orgViewPresetsStorageKey(orgId, scope);
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return Array.isArray(row?.value) ? (row!.value as ViewPreset[]) : [];
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!isAdminLike(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "default";
    const orgId = await resolveActiveOrgId(
      user,
      url.searchParams.get("organisationId"),
      { context: "GET /api/admin/org-view-presets" },
    );
    const presets = await fetchOrgPresets(orgId, scope);
    return NextResponse.json({ presets, organisationId: orgId });
  } catch (err) {
    if ((err as Error)?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ActiveOrgError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    if (!isAdminLike(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "default";
    const orgId = await resolveActiveOrgId(
      user,
      url.searchParams.get("organisationId"),
      { context: "PUT /api/admin/org-view-presets" },
    );
    const body = (await request.json()) as ViewPreset[];

    if (!Array.isArray(body) || body.length > 5) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const key = orgViewPresetsStorageKey(orgId, scope);
    await db
      .insert(appSettings)
      .values({ key, value: body as any, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: body as any, updatedAt: new Date().toISOString() },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error)?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ActiveOrgError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
