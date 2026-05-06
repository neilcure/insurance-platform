/**
 * GET  /api/admin/idle-timeout-policy
 * POST /api/admin/idle-timeout-policy   (admin only)
 *
 * Read endpoint is callable by every signed-in user because the
 * client needs to know its own idle/warn thresholds. We do NOT
 * return secrets here — only the duration matrix.
 *
 * Stored under `app_settings.key = "idle_timeout_policy"`. Falls
 * back to `DEFAULT_IDLE_TIMEOUT_POLICY` when the row is missing.
 */

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import {
  DEFAULT_IDLE_TIMEOUT_POLICY,
  type IdleTimeoutPolicy,
  clampRoleConfig,
} from "@/lib/idle-timeout/policy";

const SETTINGS_KEY = "idle_timeout_policy";

const RoleConfigSchema = z.object({
  idleSeconds: z.number().int().min(60).max(12 * 60 * 60),
  warnSeconds: z.number().int().min(10).max(5 * 60),
});

const PolicySchema = z.object({
  enabled: z.boolean(),
  perRole: z
    .object({
      admin: RoleConfigSchema.optional(),
      agent: RoleConfigSchema.optional(),
      internal_staff: RoleConfigSchema.optional(),
      accounting: RoleConfigSchema.optional(),
      direct_client: RoleConfigSchema.optional(),
      service_provider: RoleConfigSchema.optional(),
    })
    .strict(),
});

export async function GET() {
  try {
    // Auth required — this is per-user behaviour, not a public API.
    await requireUser();
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SETTINGS_KEY))
      .limit(1);
    const stored = (row?.value as IdleTimeoutPolicy | undefined) ?? null;
    if (!stored) {
      return NextResponse.json(DEFAULT_IDLE_TIMEOUT_POLICY);
    }
    // Defensively re-clamp every role in case the stored row was
    // hand-edited in SQL with out-of-range values.
    const safe: IdleTimeoutPolicy = {
      enabled: !!stored.enabled,
      perRole: Object.fromEntries(
        Object.entries(stored.perRole ?? {}).map(([k, v]) => [
          k,
          clampRoleConfig(v as { idleSeconds: number; warnSeconds: number }),
        ]),
      ),
    };
    return NextResponse.json(safe);
  } catch (err) {
    console.error("[idle-timeout-policy] GET failed", err);
    return NextResponse.json(DEFAULT_IDLE_TIMEOUT_POLICY);
  }
}

export async function POST(request: NextRequest) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const json = await request.json();
    const parsed = PolicySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid policy" },
        { status: 400 },
      );
    }
    const policy: IdleTimeoutPolicy = {
      enabled: parsed.data.enabled,
      perRole: Object.fromEntries(
        Object.entries(parsed.data.perRole).map(([k, v]) => [k, clampRoleConfig(v!)]),
      ),
    };
    await db
      .insert(appSettings)
      .values({ key: SETTINGS_KEY, value: policy })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: policy } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[idle-timeout-policy] POST failed", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
