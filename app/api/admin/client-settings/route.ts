import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";

type UserTypePrefixes = {
  admin?: string;
  agent?: string;
  accounting?: string;
  internal_staff?: string;
};

type FlowButtonConfig = { label: string; flow: string };

type Settings = {
  companyPrefix?: string;
  personalPrefix?: string;
  userTypePrefixes?: UserTypePrefixes;
  flowButtons?: Record<string, FlowButtonConfig>;
  flowPrefixes?: Record<string, string>;
};

const SETTINGS_KEY = "client_number_prefixes";
const FLOW_BUTTONS_KEY = "flow_buttons";
const FLOW_PREFIXES_KEY = "flow_prefixes";
const DEFAULTS = {
  companyPrefix: "C",
  personalPrefix: "P",
  userTypePrefixes: {
    admin: "AD",
    agent: "AG",
    accounting: "AC",
    internal_staff: "IN",
  },
  flowButtons: {} as Record<string, FlowButtonConfig>,
};

const USER_TYPE_PREFIXES_KEY = "user_type_prefixes";

export async function GET() {
  try {
    const me = await requireUser();
    if (!(me.userType === "admin" || me.userType === "agent" || me.userType === "internal_staff")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Per-organisation key (first membership)
    const orgIdRes = await db.execute(
      `select organisation_id as "organisationId" from memberships where user_id = ${Number(me.id)} limit 1`
    );
    const organisationId =
      Array.isArray(orgIdRes)
        ? (orgIdRes as Array<Record<string, unknown>>)[0]?.organisationId
        : ((orgIdRes as { rows?: Array<Record<string, unknown>> } | null | undefined)?.rows?.[0]?.organisationId);
    const suffix = organisationId ? `:${organisationId}` : "";

    const [clientRow] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY + suffix)).limit(1);
    const [userTypeRow] = await db.select().from(appSettings).where(eq(appSettings.key, USER_TYPE_PREFIXES_KEY + suffix)).limit(1);
    const [flowButtonsRow] = await db.select().from(appSettings).where(eq(appSettings.key, FLOW_BUTTONS_KEY + suffix)).limit(1);
    const [flowPrefixesRow] = await db.select().from(appSettings).where(eq(appSettings.key, FLOW_PREFIXES_KEY + suffix)).limit(1);
    const [legacyPageRow] = await db.select().from(appSettings).where(eq(appSettings.key, "client_page_config" + suffix)).limit(1);
    const clientValue = (clientRow?.value as Settings | undefined) ?? {};
    const userTypeValue = (userTypeRow?.value as UserTypePrefixes | undefined) ?? {};
    const flowButtons = (flowButtonsRow?.value as Record<string, FlowButtonConfig> | undefined) ?? {};
    const flowPrefixes = (flowPrefixesRow?.value as Record<string, string> | undefined) ?? {};
    if (!flowButtons["__clients__"] && legacyPageRow?.value) {
      const legacy = legacyPageRow.value as { createButtonLabel?: string; createButtonFlow?: string };
      if (legacy.createButtonLabel || legacy.createButtonFlow) {
        flowButtons["__clients__"] = {
          label: legacy.createButtonLabel ?? "",
          flow: legacy.createButtonFlow ?? "",
        };
      }
    }
    return NextResponse.json(
      {
        companyPrefix: clientValue.companyPrefix ?? DEFAULTS.companyPrefix,
        personalPrefix: clientValue.personalPrefix ?? DEFAULTS.personalPrefix,
        userTypePrefixes: {
          admin: userTypeValue.admin ?? DEFAULTS.userTypePrefixes.admin,
          agent: userTypeValue.agent ?? DEFAULTS.userTypePrefixes.agent,
          accounting: userTypeValue.accounting ?? DEFAULTS.userTypePrefixes.accounting,
          internal_staff: userTypeValue.internal_staff ?? DEFAULTS.userTypePrefixes.internal_staff,
        },
        flowButtons,
        flowPrefixes,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireUser();
    if (!(me.userType === "admin" || me.userType === "agent" || me.userType === "internal_staff")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const json = (await request.json()) as Settings;
    const companyPrefix = (json.companyPrefix ?? "").trim();
    const personalPrefix = (json.personalPrefix ?? "").trim();
    const userTypePrefixes = json.userTypePrefixes ?? {};
    const admin = (userTypePrefixes.admin ?? "").trim();
    const agent = (userTypePrefixes.agent ?? "").trim();
    const accounting = typeof userTypePrefixes.accounting === "string" ? userTypePrefixes.accounting.trim() : "";
    const internal_staff = typeof userTypePrefixes.internal_staff === "string" ? userTypePrefixes.internal_staff.trim() : "";
    if (!companyPrefix || !personalPrefix) {
      return NextResponse.json({ error: "Both prefixes are required" }, { status: 400 });
    }
    // Per-organisation key
    const orgIdRes = await db.execute(
      `select organisation_id as "organisationId" from memberships where user_id = ${Number(me.id)} limit 1`
    );
    const organisationId =
      Array.isArray(orgIdRes)
        ? (orgIdRes as Array<Record<string, unknown>>)[0]?.organisationId
        : ((orgIdRes as { rows?: Array<Record<string, unknown>> } | null | undefined)?.rows?.[0]?.organisationId);
    const suffix = organisationId ? `:${organisationId}` : "";

    await db
      .insert(appSettings)
      .values({ key: SETTINGS_KEY + suffix, value: { companyPrefix, personalPrefix } })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { companyPrefix, personalPrefix } } });

    if (admin && agent && accounting && internal_staff) {
      await db
        .insert(appSettings)
        .values({ key: USER_TYPE_PREFIXES_KEY + suffix, value: { admin, agent, accounting, internal_staff } })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: { admin, agent, accounting, internal_staff } },
        });
    }

    const rawButtons = json.flowButtons ?? {};
    const cleanButtons: Record<string, FlowButtonConfig> = {};
    for (const [key, val] of Object.entries(rawButtons)) {
      if (val && typeof val === "object") {
        cleanButtons[key] = {
          label: typeof val.label === "string" ? val.label.trim() : "",
          flow: typeof val.flow === "string" ? val.flow.trim() : key,
        };
      }
    }
    await db
      .insert(appSettings)
      .values({ key: FLOW_BUTTONS_KEY + suffix, value: cleanButtons })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: cleanButtons } });

    const rawPrefixes = (json as any).flowPrefixes ?? {};
    const cleanPrefixes: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawPrefixes)) {
      if (typeof val === "string" && val.trim()) {
        cleanPrefixes[key] = val.trim().toUpperCase();
      }
    }
    await db
      .insert(appSettings)
      .values({ key: FLOW_PREFIXES_KEY + suffix, value: cleanPrefixes })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: cleanPrefixes } });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

