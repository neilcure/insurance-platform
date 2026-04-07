import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { policies, cars } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

type StatusConfig = {
  id: number;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  color: string;
  flows: string[];
  triggersInvoice: boolean;
  onEnter: unknown[];
};

type PolicyStatusRow = {
  policyId: number;
  policyNumber: string;
  flowKey: string | null;
  isActive: boolean;
  status: string;
  statusHistory: Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>;
  linkedPolicyId: number | null;
};

type Issue = {
  type: "warning" | "error";
  fixAction: "apply_default_color" | "deactivate_duplicate" | "create_missing_config";
  fixId: string;
  fixLabel: string;
  message: string;
  status?: string;
};

export async function GET() {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [statusRows, policyRows] = await Promise.all([
    db
      .select({
        id: formOptions.id,
        label: formOptions.label,
        value: formOptions.value,
        sortOrder: formOptions.sortOrder,
        isActive: formOptions.isActive,
        meta: formOptions.meta,
      })
      .from(formOptions)
      .where(eq(formOptions.groupKey, "policy_statuses")),
    db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        flowKey: policies.flowKey,
        isActive: policies.isActive,
        extraAttributes: cars.extraAttributes,
      })
      .from(policies)
      .innerJoin(cars, eq(cars.policyId, policies.id)),
  ]);

  const configs: StatusConfig[] = statusRows.map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      label: r.label,
      value: r.value,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      color: (meta.color as string) || "",
      flows: (meta.flows as string[]) || [],
      triggersInvoice: !!(meta.triggersInvoice),
      onEnter: (meta.onEnter as unknown[]) || [],
    };
  });

  const configValues = new Set(configs.filter((c) => c.isActive).map((c) => c.value));

  const allFlows = [...new Set(configs.flatMap((c) => c.flows).filter(Boolean))];

  const policyStatuses: PolicyStatusRow[] = policyRows.map((r) => {
    const extra = (r.extraAttributes ?? {}) as Record<string, unknown>;
    return {
      policyId: r.policyId,
      policyNumber: r.policyNumber,
      flowKey: r.flowKey,
      isActive: r.isActive,
      status: (extra.status as string) || "active",
      statusHistory: Array.isArray(extra.statusHistory)
        ? (extra.statusHistory as PolicyStatusRow["statusHistory"])
        : [],
      linkedPolicyId: (extra.linkedPolicyId as number) ?? null,
    };
  });

  const statusDistribution: Record<string, number> = {};
  for (const p of policyStatuses) {
    statusDistribution[p.status] = (statusDistribution[p.status] || 0) + 1;
  }

  const flowDistribution: Record<string, Record<string, number>> = {};
  for (const p of policyStatuses) {
    const fk = p.flowKey || "(none)";
    if (!flowDistribution[fk]) flowDistribution[fk] = {};
    flowDistribution[fk][p.status] = (flowDistribution[fk][p.status] || 0) + 1;
  }

  const issues: Issue[] = [];

  const noColor = configs.filter((c) => c.isActive && !c.color);
  for (const c of noColor) {
    issues.push({
      type: "warning",
      fixAction: "apply_default_color",
      fixId: String(c.id),
      fixLabel: "Apply default color",
      message: `Status "${c.label}" (${c.value}) has no color configured`,
    });
  }

  const duplicateValues = configs.filter((c, i) => configs.findIndex((x) => x.value === c.value) !== i);
  for (const d of duplicateValues) {
    issues.push({
      type: "error",
      fixAction: "deactivate_duplicate",
      fixId: String(d.id),
      fixLabel: "Deactivate duplicate",
      message: `Duplicate status value "${d.value}" (id: ${d.id})`,
    });
  }

  const orphanedStatuses = Object.keys(statusDistribution).filter((s) => !configValues.has(s));
  for (const s of orphanedStatuses) {
    issues.push({
      type: "warning",
      fixAction: "create_missing_config",
      fixId: s,
      fixLabel: "Create config entry",
      message: `${statusDistribution[s]} policies have status "${s}" which is not in active config`,
      status: s,
    });
  }

  const recentTransitions: Array<{
    policyNumber: string;
    policyId: number;
    from: string;
    to: string;
    changedAt: string;
    changedBy: string;
  }> = [];

  for (const p of policyStatuses) {
    for (let i = 0; i < p.statusHistory.length; i++) {
      const entry = p.statusHistory[i];
      const prev = i > 0 ? p.statusHistory[i - 1].status : "active";
      recentTransitions.push({
        policyNumber: p.policyNumber,
        policyId: p.policyId,
        from: prev,
        to: entry.status,
        changedAt: entry.changedAt,
        changedBy: entry.changedBy || "system",
      });
    }
  }

  recentTransitions.sort((a, b) => (b.changedAt || "").localeCompare(a.changedAt || ""));
  const recentSlice = recentTransitions.slice(0, 50);

  return NextResponse.json({
    configs,
    allFlows,
    statusDistribution,
    flowDistribution,
    issues,
    recentTransitions: recentSlice,
    totalPolicies: policyStatuses.length,
    activePolicies: policyStatuses.filter((p) => p.isActive).length,
  });
}

const DEFAULT_COLOR = "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { fixAction, fixId } = body as { fixAction: string; fixId: string };

  if (!fixAction || !fixId) {
    return NextResponse.json({ error: "Missing fixAction or fixId" }, { status: 400 });
  }

  switch (fixAction) {
    case "apply_default_color": {
      const id = parseInt(fixId, 10);
      const [row] = await db
        .select({ id: formOptions.id, meta: formOptions.meta })
        .from(formOptions)
        .where(eq(formOptions.id, id));
      if (!row) return NextResponse.json({ error: "Status not found" }, { status: 404 });

      const meta = (row.meta ?? {}) as Record<string, unknown>;
      meta.color = DEFAULT_COLOR;
      await db.update(formOptions).set({ meta }).where(eq(formOptions.id, id));
      return NextResponse.json({ ok: true, applied: "default_color" });
    }

    case "deactivate_duplicate": {
      const id = parseInt(fixId, 10);
      await db.update(formOptions).set({ isActive: false }).where(eq(formOptions.id, id));
      return NextResponse.json({ ok: true, applied: "deactivated" });
    }

    case "create_missing_config": {
      const value = fixId;
      const existing = await db
        .select({ id: formOptions.id })
        .from(formOptions)
        .where(and(eq(formOptions.groupKey, "policy_statuses"), eq(formOptions.value, value)));
      if (existing.length > 0) {
        await db.update(formOptions).set({ isActive: true }).where(eq(formOptions.id, existing[0].id));
        return NextResponse.json({ ok: true, applied: "reactivated" });
      }

      const label = value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const maxSort = await db
        .select({ max: formOptions.sortOrder })
        .from(formOptions)
        .where(eq(formOptions.groupKey, "policy_statuses"));
      const nextSort = Math.max(...maxSort.map((r) => r.max ?? 0)) + 1;

      await db.insert(formOptions).values({
        groupKey: "policy_statuses",
        label,
        value,
        valueType: "string",
        sortOrder: nextSort,
        isActive: true,
        meta: { color: DEFAULT_COLOR, flows: [] },
      });
      return NextResponse.json({ ok: true, applied: "created" });
    }

    default:
      return NextResponse.json({ error: `Unknown fixAction: ${fixAction}` }, { status: 400 });
  }
}
