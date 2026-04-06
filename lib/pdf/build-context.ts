import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { users, clients, organisations } from "@/db/schema/core";
import { accountingPaymentSchedules, accountingInvoices } from "@/db/schema/accounting";
import { eq, sql, inArray, and, or } from "drizzle-orm";
import type { MergeContext, AccountingLineContext, StatementContext } from "./resolve-data";
import { loadAccountingFields, buildColumnFieldMap, getColumnType } from "@/lib/accounting-fields";
import { getDisplayNameFromSnapshot } from "@/lib/field-resolver";

const DB_COLUMN_OPTIONS = [
  { value: "grossPremiumCents", label: "Gross Premium", type: "cents" },
  { value: "netPremiumCents", label: "Net Premium", type: "cents" },
  { value: "clientPremiumCents", label: "Client Premium", type: "cents" },
  { value: "agentPremiumCents", label: "Agent Premium", type: "cents" },
  { value: "agentCommissionCents", label: "Agent Commission", type: "cents" },
  { value: "creditPremiumCents", label: "Credit Premium", type: "cents" },
  { value: "levyCents", label: "Levy", type: "cents" },
  { value: "stampDutyCents", label: "Stamp Duty", type: "cents" },
  { value: "discountCents", label: "Discount", type: "cents" },
  { value: "commissionRate", label: "Commission Rate", type: "rate" },
  { value: "currency", label: "Currency", type: "string" },
] as const;

export async function buildMergeContext(policyId: number): Promise<{
  ctx: MergeContext;
  policyNumber: string;
} | null> {
  const [policy] = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      organisationId: policies.organisationId,
      clientId: policies.clientId,
      agentId: policies.agentId,
      isActive: policies.isActive,
      createdAt: policies.createdAt,
      documentTracking: policies.documentTracking,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!policy) return null;

  let carRow: {
    plateNumber: string | null;
    make: string | null;
    model: string | null;
    year: string | number | null;
    extraAttributes: unknown;
  } | undefined;
  try {
    const rows = await db
      .select({
        plateNumber: cars.plateNumber,
        make: cars.make,
        model: cars.model,
        year: cars.year,
        extraAttributes: cars.extraAttributes,
      })
      .from(cars)
      .where(eq(cars.policyId, policyId))
      .limit(1);
    carRow = rows[0];
  } catch { /* cars table may not exist */ }

  const extra = (carRow?.extraAttributes ?? {}) as Record<string, unknown>;
  const snapshot = {
    ...extra,
    plateNumber: carRow?.plateNumber,
    make: carRow?.make,
    model: carRow?.model,
    year: carRow?.year,
  };

  let agentData: Record<string, unknown> | null = null;
  if (policy.agentId) {
    try {
      const [agent] = await db
        .select({ id: users.id, name: users.name, email: users.email, userNumber: users.userNumber })
        .from(users)
        .where(eq(users.id, policy.agentId))
        .limit(1);
      if (agent) agentData = agent as unknown as Record<string, unknown>;
    } catch { /* ignore */ }
  }

  let clientData: Record<string, unknown> | null = null;
  const resolvedClientId = policy.clientId ?? (extra.clientId as number | undefined);
  if (resolvedClientId) {
    try {
      const [client] = await db
        .select({
          id: clients.id,
          clientNumber: clients.clientNumber,
          category: clients.category,
          displayName: clients.displayName,
          primaryId: clients.primaryId,
          contactPhone: clients.contactPhone,
          extraAttributes: clients.extraAttributes,
        })
        .from(clients)
        .where(eq(clients.id, Number(resolvedClientId)))
        .limit(1);
      if (client) {
        clientData = {
          ...client,
          ...(client.extraAttributes as Record<string, unknown> ?? {}),
        } as unknown as Record<string, unknown>;
      }
    } catch { /* ignore */ }
  }

  let orgData: Record<string, unknown> | null = null;
  if (policy.organisationId) {
    try {
      const [org] = await db
        .select()
        .from(organisations)
        .where(eq(organisations.id, policy.organisationId))
        .limit(1);
      if (org) orgData = org as unknown as Record<string, unknown>;
    } catch { /* ignore */ }
  }

  let accountingLines: AccountingLineContext[] = [];
  try {
    const premiumRows = await db
      .select()
      .from(policyPremiums)
      .where(eq(policyPremiums.policyId, policyId))
      .orderBy(policyPremiums.createdAt);

    if (premiumRows.length > 0) {
      const lineOrgIds = [...new Set(premiumRows.map((r) => r.organisationId).filter(Boolean))] as number[];
      const lineCollabIds = [...new Set(premiumRows.map((r) => r.collaboratorId).filter(Boolean))] as number[];
      const orgMap = new Map<number, Record<string, unknown>>();
      const collabMap = new Map<number, Record<string, unknown>>();

      if (lineOrgIds.length) {
        const orgRows = await db.select().from(organisations).where(inArray(organisations.id, lineOrgIds));
        for (const o of orgRows) orgMap.set(o.id, o as unknown as Record<string, unknown>);
      }
      if (lineCollabIds.length) {
        const collabRows = await db
          .select({ policyId: policies.id, carExtra: cars.extraAttributes })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .where(inArray(policies.id, lineCollabIds));
        for (const c of collabRows) {
          const carSnap = (c.carExtra as Record<string, unknown>) ?? {};
          const name = getDisplayNameFromSnapshot({
            insuredSnapshot: carSnap.insuredSnapshot as Record<string, unknown> | null | undefined,
            packagesSnapshot: (carSnap.packagesSnapshot ?? {}) as Record<string, unknown>,
          });
          collabMap.set(c.policyId, {
            name: name || `Collaborator #${c.policyId}`,
            ...((c.carExtra as Record<string, unknown>) ?? {}),
          });
        }
      }

      const centsToDisplay = (v: number | null | undefined) => (v != null ? v / 100 : null);
      const acctFields = await loadAccountingFields();
      const colFieldMap = buildColumnFieldMap(acctFields);

      const CANONICAL_KEYS: Record<string, string> = {};
      for (const opt of DB_COLUMN_OPTIONS) {
        if (opt.type !== "cents") continue;
        const short = opt.value.replace(/Cents$/, "").replace(/^([a-z])/, (_, c: string) => c.toLowerCase());
        CANONICAL_KEYS[opt.value] = short;
      }

      accountingLines = premiumRows.map((row) => {
        const rowExtra = (row.extraValues ?? {}) as Record<string, unknown>;
        const vals: Record<string, unknown> = { ...rowExtra };

        for (const opt of DB_COLUMN_OPTIONS) {
          const rawVal = (row as Record<string, unknown>)[opt.value];
          const colType = getColumnType(opt.value);
          let displayVal: unknown;
          if (colType === "cents") {
            displayVal = centsToDisplay(rawVal as number | null);
          } else if (colType === "rate") {
            displayVal = rawVal !== null && rawVal !== undefined ? Number(rawVal) : null;
          } else {
            displayVal = rawVal ?? null;
          }
          const canonicalKey = CANONICAL_KEYS[opt.value];
          if (canonicalKey) vals[canonicalKey] = displayVal;
          const adminField = colFieldMap[opt.value];
          if (adminField && adminField.key !== canonicalKey) {
            vals[adminField.key] = displayVal;
          }
        }

        let marginClient = 0, marginNet = 0, marginAgent = 0;
        for (const f of acctFields) {
          if (!f.premiumColumn) continue;
          const val = ((row as Record<string, unknown>)[f.premiumColumn] as number) ?? 0;
          const role = f.premiumRole;
          const lbl = role ? "" : f.label.toLowerCase();
          if (role === "client" || (!role && lbl.includes("client"))) marginClient = val;
          else if (role === "net" || (!role && lbl.includes("net"))) marginNet = val;
          else if (role === "agent" || (!role && lbl.includes("agent"))) marginAgent = val;
        }
        const gainVal = marginAgent > 0 ? marginAgent - marginNet : marginClient - marginNet;
        const hasAny = marginClient !== 0 || marginNet !== 0 || marginAgent !== 0;
        const margin = hasAny ? gainVal : null;
        return {
          lineKey: row.lineKey,
          lineLabel: row.lineLabel ?? row.lineKey,
          values: vals,
          margin,
          insurer: row.organisationId ? (orgMap.get(row.organisationId) ?? null) : null,
          collaborator: row.collaboratorId ? (collabMap.get(row.collaboratorId) ?? null) : null,
        };
      });
    }
  } catch { /* premium table may not exist */ }

  const isTpoWithOd =
    accountingLines.length >= 2 &&
    accountingLines.some((l) => l.lineKey.toLowerCase() === "tpo") &&
    accountingLines.some((l) => {
      const k = l.lineKey.toLowerCase();
      return k.includes("own_vehicle") || k.includes("owndamage");
    });

  let statementData: StatementContext | null = null;
  try {
    const entityConditions = [];
    if (policy.clientId) {
      entityConditions.push(
        and(
          eq(accountingPaymentSchedules.entityType, "client"),
          eq(accountingPaymentSchedules.clientId, policy.clientId),
        ),
      );
    }
    if (policy.agentId) {
      entityConditions.push(
        and(
          eq(accountingPaymentSchedules.entityType, "agent"),
          eq(accountingPaymentSchedules.agentId, policy.agentId),
        ),
      );
    }

    if (entityConditions.length > 0 && policy.organisationId) {
      const schedules = await db
        .select({ id: accountingPaymentSchedules.id })
        .from(accountingPaymentSchedules)
        .where(
          and(
            eq(accountingPaymentSchedules.organisationId, policy.organisationId),
            eq(accountingPaymentSchedules.isActive, true),
            entityConditions.length === 1
              ? entityConditions[0]
              : or(...entityConditions),
          ),
        );

      for (const sched of schedules) {
        const [stmt] = await db
          .select({
            id: accountingInvoices.id,
            invoiceNumber: accountingInvoices.invoiceNumber,
            status: accountingInvoices.status,
            totalAmountCents: accountingInvoices.totalAmountCents,
            paidAmountCents: accountingInvoices.paidAmountCents,
            currency: accountingInvoices.currency,
            entityType: accountingInvoices.entityType,
            entityName: accountingInvoices.entityName,
            invoiceDate: accountingInvoices.invoiceDate,
          })
          .from(accountingInvoices)
          .where(
            and(
              eq(accountingInvoices.scheduleId, sched.id),
              eq(accountingInvoices.invoiceType, "statement"),
              inArray(accountingInvoices.status, ["draft", "pending", "partial", "settled"]),
            ),
          )
          .limit(1);

        if (stmt) {
          const rawItems = await db.execute(sql`
            SELECT "id", "policy_id", "amount_cents", "description",
                   coalesce("status", 'active') AS "status"
            FROM "accounting_invoice_items"
            WHERE "invoice_id" = ${stmt.id}
            ORDER BY "id"
          `);
          const rawRows = Array.isArray(rawItems)
            ? rawItems
            : (rawItems as { rows?: unknown[] }).rows ?? [];
          const items = (rawRows as {
            id: number;
            policy_id: number;
            amount_cents: number;
            description: string | null;
            status: string;
          }[]).map((r) => ({
            description: r.description,
            amountCents: r.amount_cents,
            status: r.status,
            policyId: r.policy_id,
          }));

          const activeTotal = items
            .filter((it) => it.status === "active")
            .reduce((sum, it) => sum + it.amountCents, 0);
          const paidIndividuallyTotal = items
            .filter((it) => it.status === "paid_individually")
            .reduce((sum, it) => sum + it.amountCents, 0);

          statementData = {
            statementNumber: stmt.invoiceNumber,
            statementDate: stmt.invoiceDate,
            statementStatus: stmt.status,
            entityName: stmt.entityName,
            entityType: stmt.entityType,
            activeTotal,
            paidIndividuallyTotal,
            totalAmountCents: stmt.totalAmountCents,
            paidAmountCents: stmt.paidAmountCents,
            currency: stmt.currency,
            items,
          };
          break;
        }
      }
    }
  } catch { /* statement data is optional */ }

  const ctx: MergeContext = {
    policyNumber: policy.policyNumber,
    createdAt: policy.createdAt,
    snapshot: snapshot as Record<string, unknown> & {
      insuredSnapshot?: Record<string, unknown> | null;
      packagesSnapshot?: Record<string, unknown> | null;
    },
    agent: agentData,
    client: clientData,
    organisation: orgData,
    accountingLines,
    statementData,
    isTpoWithOd,
    documentTracking: policy.documentTracking as Record<string, { documentNumber?: string; status?: string; [key: string]: unknown }> | null,
  };

  return { ctx, policyNumber: policy.policyNumber };
}
