import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { users, clients, organisations } from "@/db/schema/core";
import { accountingPaymentSchedules, accountingInvoices } from "@/db/schema/accounting";
import { formOptions } from "@/db/schema/form_options";
import { eq, sql, inArray, and, or } from "drizzle-orm";
import type { MergeContext, AccountingLineContext, StatementContext } from "./resolve-data";
import { loadAccountingFields, buildColumnFieldMap, getColumnType } from "@/lib/accounting-fields";
import { getDisplayNameFromSnapshot, type PackageFieldVariant } from "@/lib/field-resolver";

/**
 * Load admin-configured field variants for the given packages from
 * `form_options`. Used to power the resolver's by-label fallback so a
 * single PDF placement (e.g. one "Make" field) auto-resolves across
 * category-scoped variants. Best-effort — failures fall back to no
 * variants (which preserves existing direct-key resolution behavior).
 */
async function loadPackageFieldVariants(
  packageNames: string[],
): Promise<Record<string, PackageFieldVariant[]>> {
  const out: Record<string, PackageFieldVariant[]> = {};
  if (packageNames.length === 0) return out;
  try {
    const groupKeys = packageNames.map((p) => `${p}_fields`);
    const rows = await db
      .select({
        groupKey: formOptions.groupKey,
        value: formOptions.value,
        label: formOptions.label,
        meta: formOptions.meta,
      })
      .from(formOptions)
      .where(
        and(
          inArray(formOptions.groupKey, groupKeys),
          eq(formOptions.isActive, true),
        ),
      );

    for (const r of rows) {
      const pkg = r.groupKey.replace(/_fields$/, "");
      const meta = (r.meta ?? null) as {
        categories?: unknown;
        options?: unknown;
        booleanChildren?: unknown;
      } | null;
      const rawCats = Array.isArray(meta?.categories) ? meta!.categories : [];
      const categories = rawCats
        .map((c) => (typeof c === "string" ? c : ""))
        .filter((c): c is string => c.length > 0);
      if (!out[pkg]) out[pkg] = [];
      const parentKey = String(r.value ?? "");

      // Capture the parent field's `meta.options` (label/value pairs)
      // so the resolver can translate stored option slugs (e.g.
      // "hkonly") into their human-readable labels (e.g. "Hong Kong
      // Only") at PDF render time. Only collected for top-level
      // option arrays — cascading children's option lists are still
      // looked up via the by-label / `__opt_<value>__cN` paths.
      const optionsRaw = Array.isArray(meta?.options) ? meta!.options : [];
      const parentOptionPairs: { value: string; label: string }[] = [];
      for (const optRaw of optionsRaw) {
        const opt = (optRaw ?? {}) as { value?: unknown; label?: unknown };
        const ov = String(opt.value ?? "").trim();
        if (!ov) continue;
        const ol = String(opt.label ?? "").trim() || ov;
        parentOptionPairs.push({ value: ov, label: ol });
      }

      out[pkg].push({
        key: parentKey,
        label: String(r.label ?? r.value ?? ""),
        categories,
        options: parentOptionPairs.length > 0 ? parentOptionPairs : undefined,
      });

      // Cascading second-level fields: when an option of this parent
      // (e.g. each Make option) declares `children`, the wizard saves
      // values under the deterministic name
      // `${parentKey}__opt_${optionValue}__c${childIndex}` — see
      // `app/(dashboard)/policies/new/page.tsx` line ~121 for the
      // canonical form-name template. Emit one variant per
      // (option, child) pair so the by-label resolver can pick
      // whichever key has a value for this policy.
      for (const optRaw of optionsRaw) {
        const opt = (optRaw ?? {}) as {
          value?: unknown;
          children?: unknown;
        };
        const optValue = String(opt.value ?? "").trim();
        if (!optValue) continue;
        const children = Array.isArray(opt.children) ? opt.children : [];
        children.forEach((childRaw, childIdx) => {
          const child = (childRaw ?? {}) as {
            label?: unknown;
            options?: unknown;
          };
          const childLabel = String(child.label ?? "").trim();
          if (!childLabel) return;
          // Cascading children may also be selects — capture their
          // own option list so their resolved values get translated
          // to labels too.
          const childOptionsRaw = Array.isArray(child.options) ? child.options : [];
          const childOptionPairs: { value: string; label: string }[] = [];
          for (const cOptRaw of childOptionsRaw) {
            const cOpt = (cOptRaw ?? {}) as { value?: unknown; label?: unknown };
            const cv = String(cOpt.value ?? "").trim();
            if (!cv) continue;
            const cl = String(cOpt.label ?? "").trim() || cv;
            childOptionPairs.push({ value: cv, label: cl });
          }
          out[pkg].push({
            key: `${parentKey}__opt_${optValue}__c${childIdx}`,
            label: childLabel,
            // Children inherit the parent's category restriction —
            // they're only reachable when the parent (and therefore
            // its category) is in scope.
            categories,
            options: childOptionPairs.length > 0 ? childOptionPairs : undefined,
          });
        });
      }

      // Boolean-branch children: when this admin field is a boolean
      // (`inputType: "boolean"`) with `meta.booleanChildren.{true,false}`,
      // the wizard names each branch child `${parent}__${branch}__c${idx}`
      // and stores its value at that exact key in the snapshot. Emit
      // one variant per nested child so the resolver can:
      //   1. Translate select-typed branch children's stored values to
      //      labels (e.g. "fleet" → "Fleet" for No Claims Bonus).
      //   2. Smart-route a placement of the parent boolean to the
      //      chosen child's label via the `__r0` / `__c0` lookup
      //      already wired into `resolvePackage`.
      const booleanChildren = (meta?.booleanChildren ?? null) as {
        true?: unknown;
        false?: unknown;
      } | null;
      if (booleanChildren) {
        for (const branch of ["true", "false"] as const) {
          const branchArr = Array.isArray(booleanChildren[branch])
            ? (booleanChildren[branch] as unknown[])
            : [];
          branchArr.forEach((childRaw, childIdx) => {
            const child = (childRaw ?? {}) as {
              label?: unknown;
              options?: unknown;
            };
            const branchOptionsRaw = Array.isArray(child.options) ? child.options : [];
            const branchOptionPairs: { value: string; label: string }[] = [];
            for (const cOptRaw of branchOptionsRaw) {
              const cOpt = (cOptRaw ?? {}) as { value?: unknown; label?: unknown };
              const cv = String(cOpt.value ?? "").trim();
              if (!cv) continue;
              const cl = String(cOpt.label ?? "").trim() || cv;
              branchOptionPairs.push({ value: cv, label: cl });
            }
            const childLabel = String(child.label ?? "").trim();
            // Use parent's label as a meaningful fallback so the
            // by-label fallback can still find these via the parent's
            // slug if needed.
            const variantLabel = childLabel || String(r.label ?? r.value ?? "");
            out[pkg].push({
              key: `${parentKey}__${branch}__c${childIdx}`,
              label: variantLabel,
              categories,
              options: branchOptionPairs.length > 0 ? branchOptionPairs : undefined,
            });
          });
        }
      }
    }
  } catch {
    // best-effort: leave `out` empty
  }
  return out;
}

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

  // Step 1: load the car row first so we can resolve clientId from snapshot extras.
  // The car query is small and we can't fan out client lookup until we know the resolved id.
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

  const resolvedClientId = policy.clientId ?? (extra.clientId as number | undefined);

  // Collect package names referenced by the snapshot so we can preload
  // admin-configured field variants for the resolver's by-label fallback.
  const snapshotPackages = (() => {
    const ps = (extra.packagesSnapshot ?? null) as Record<string, unknown> | null;
    if (!ps || typeof ps !== "object") return [] as string[];
    return Object.keys(ps).filter((k) => Boolean(k));
  })();

  // Step 2: agent / client / org lookups are independent — fan out in parallel.
  const agentPromise = policy.agentId
    ? db
        .select({ id: users.id, name: users.name, email: users.email, userNumber: users.userNumber })
        .from(users)
        .where(eq(users.id, policy.agentId))
        .limit(1)
        .then((rows) => rows[0] ?? null)
        .catch(() => null)
    : Promise.resolve(null);

  const clientPromise = resolvedClientId
    ? db
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
        .limit(1)
        .then((rows) => rows[0] ?? null)
        .catch(() => null)
    : Promise.resolve(null);

  const orgPromise = policy.organisationId
    ? db
        .select()
        .from(organisations)
        .where(eq(organisations.id, policy.organisationId))
        .limit(1)
        .then((rows) => rows[0] ?? null)
        .catch(() => null)
    : Promise.resolve(null);

  const variantsPromise = loadPackageFieldVariants(snapshotPackages);

  const [agentRow, clientRow, orgRow, packageFieldVariants] = await Promise.all([
    agentPromise,
    clientPromise,
    orgPromise,
    variantsPromise,
  ]);

  const agentData: Record<string, unknown> | null = agentRow
    ? (agentRow as unknown as Record<string, unknown>)
    : null;
  const clientData: Record<string, unknown> | null = clientRow
    ? ({
        ...clientRow,
        ...((clientRow.extraAttributes as Record<string, unknown>) ?? {}),
      } as unknown as Record<string, unknown>)
    : null;
  const orgData: Record<string, unknown> | null = orgRow
    ? (orgRow as unknown as Record<string, unknown>)
    : null;

  let accountingLines: AccountingLineContext[] = [];
  try {
    const allPremiumRows = await db
      .select()
      .from(policyPremiums)
      .where(eq(policyPremiums.policyId, policyId))
      .orderBy(policyPremiums.createdAt);

    // Filter out phantom "main" rows when line-specific rows exist
    const nonMain = allPremiumRows.filter((r) => r.lineKey !== "main");
    const premiumRows = nonMain.length >= 2 ? nonMain : allPremiumRows;

    if (premiumRows.length > 0) {
      const lineOrgIds = [...new Set(premiumRows.map((r) => r.organisationId).filter(Boolean))] as number[];
      const lineCollabIds = [...new Set(premiumRows.map((r) => r.collaboratorId).filter(Boolean))] as number[];
      const orgMap = new Map<number, Record<string, unknown>>();
      const collabMap = new Map<number, Record<string, unknown>>();

      // Run org lookup, collaborator lookup, and accounting-fields load in parallel — none depend on each other.
      const [orgRowsRes, collabRowsRes, acctFields] = await Promise.all([
        lineOrgIds.length
          ? db.select().from(organisations).where(inArray(organisations.id, lineOrgIds))
          : Promise.resolve([] as { id: number }[]),
        lineCollabIds.length
          ? db
              .select({ policyId: policies.id, carExtra: cars.extraAttributes })
              .from(policies)
              .leftJoin(cars, eq(cars.policyId, policies.id))
              .where(inArray(policies.id, lineCollabIds))
          : Promise.resolve([] as { policyId: number; carExtra: unknown }[]),
        loadAccountingFields(),
      ]);

      for (const o of orgRowsRes as { id: number }[]) {
        orgMap.set(o.id, o as unknown as Record<string, unknown>);
      }
      for (const c of collabRowsRes as { policyId: number; carExtra: unknown }[]) {
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

      const centsToDisplay = (v: number | null | undefined) => (v != null ? v / 100 : null);
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
          if (!val) continue;
          const role = f.premiumRole;
          const lbl = role ? "" : f.label.toLowerCase();
          if (role === "client" || (!role && lbl.includes("client"))) marginClient += val;
          else if (role === "net" || (!role && lbl.includes("net"))) marginNet += val;
          else if (role === "agent" || (!role && lbl.includes("agent") && !lbl.includes("commission"))) marginAgent += val;
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
    new Set(accountingLines.map((l) => l.lineKey)).size >= 2;

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

      // Fan out the per-schedule statement lookup; we still pick the first one
      // with a result via the loop below, but the round trips overlap.
      const stmtResults = await Promise.all(
        schedules.map((sched) =>
          db
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
                inArray(accountingInvoices.status, ["draft", "pending", "partial", "settled", "active", "statement_created"]),
              ),
            )
            .orderBy(sql`${accountingInvoices.id} DESC`)
            .limit(1)
            .then((rows) => rows[0] ?? null),
        ),
      );

      for (let i = 0; i < schedules.length; i++) {
        const stmt = stmtResults[i];

        if (stmt) {
          const rawItems = await db.execute(sql`
            SELECT "id", "policy_id", "policy_premium_id", "amount_cents", "description",
                   coalesce("status", 'active') AS "status"
            FROM "accounting_invoice_items"
            WHERE "invoice_id" = ${stmt.id}
            ORDER BY "id"
          `);
          const rawRows = Array.isArray(rawItems)
            ? rawItems
            : (rawItems as { rows?: unknown[] }).rows ?? [];
          const allRawItems = (rawRows as {
            id: number;
            policy_id: number;
            policy_premium_id: number | null;
            amount_cents: number;
            description: string | null;
            status: string;
          }[]).map((r) => ({
            description: r.description,
            amountCents: r.amount_cents,
            status: r.status,
            policyId: r.policy_id,
            policyPremiumId: r.policy_premium_id,
          }));

          const seenPremIds = new Set<number>();
          const items = allRawItems.filter((it) => {
            if (!it.policyPremiumId) return true;
            const d = String(it.description ?? "").toLowerCase();
            if (d.includes("commission:") || d.includes("credit:")) return true;
            if (seenPremIds.has(it.policyPremiumId)) return false;
            seenPremIds.add(it.policyPremiumId);
            return true;
          });

          let agentPaidTotal = 0;
          let clientPaidTotal = 0;
          let commissionTotalCents = 0;
          const itemPolicyIds = [...new Set(items.map((it) => it.policyId).filter((id) => id > 0))];
          let clientPaidPolicyIds = new Set<number>();
          let agentPaidPolicyIds = new Set<number>();

          if (stmt.entityType === "agent" && itemPolicyIds.length > 0) {
            const policyIdsSql = sql.join(itemPolicyIds.map((id) => sql`${id}`), sql`,`);

            const [clientPaidResult, agentPaidResult, commissionResult, agentPaidAmtResult, ctaPaidResult] = await Promise.all([
              db.execute(sql`
                SELECT DISTINCT ii.policy_id
                FROM accounting_payments ap
                INNER JOIN accounting_invoices ai ON ai.id = ap.invoice_id
                INNER JOIN accounting_invoice_items ii ON ii.invoice_id = ai.id
                WHERE ai.direction = 'receivable'
                  AND ai.invoice_type = 'individual'
                  AND ai.status <> 'cancelled'
                  AND ap.status IN ('verified', 'confirmed', 'recorded')
                  AND coalesce(ap.payer, 'client') = 'client'
                  AND ap.payer <> 'client_to_agent'
                  AND ii.policy_id IN (${policyIdsSql})
              `),
              db.execute(sql`
                SELECT DISTINCT ii.policy_id
                FROM accounting_payments ap
                INNER JOIN accounting_invoices ai ON ai.id = ap.invoice_id
                INNER JOIN accounting_invoice_items ii ON ii.invoice_id = ai.id
                WHERE ai.direction = 'receivable'
                  AND ai.invoice_type = 'individual'
                  AND ai.entity_type = 'agent'
                  AND ai.status <> 'cancelled'
                  AND ap.status IN ('verified', 'confirmed', 'recorded')
                  AND ap.payer = 'agent'
                  AND ii.policy_id IN (${policyIdsSql})
              `),
              db.execute(sql`
                SELECT coalesce(sum(ii.amount_cents), 0)::int AS total
                FROM accounting_invoice_items ii
                INNER JOIN accounting_invoices ai ON ai.id = ii.invoice_id
                WHERE ii.policy_id IN (${policyIdsSql})
                  AND ai.direction = 'payable'
                  AND ai.entity_type = 'agent'
                  AND ai.invoice_type = 'individual'
                  AND ai.status <> 'cancelled'
                  AND (
                    lower(coalesce(ii.description, '')) LIKE '%commission:%'
                    OR lower(coalesce(ai.notes, '')) LIKE 'agent commission%'
                  )
              `),
              db.execute(sql`
                SELECT coalesce(sum(ap.amount_cents), 0)::int AS total
                FROM accounting_payments ap
                WHERE ap.invoice_id IN (
                  SELECT DISTINCT ai.id
                  FROM accounting_invoices ai
                  INNER JOIN accounting_invoice_items aii ON aii.invoice_id = ai.id
                  WHERE aii.policy_id IN (${policyIdsSql})
                    AND ai.direction = 'receivable'
                    AND ai.invoice_type = 'individual'
                    AND ai.entity_type = 'agent'
                    AND ai.status <> 'cancelled'
                )
                AND ap.payer = 'agent'
                AND ap.status IN ('recorded', 'verified', 'confirmed')
              `),
              db.execute(sql`
                SELECT DISTINCT ii.policy_id
                FROM accounting_payments ap
                INNER JOIN accounting_invoices ai ON ai.id = ap.invoice_id
                INNER JOIN accounting_invoice_items ii ON ii.invoice_id = ai.id
                WHERE ai.direction = 'receivable'
                  AND ai.status <> 'cancelled'
                  AND ap.status IN ('verified', 'confirmed', 'recorded')
                  AND ap.payer = 'client_to_agent'
                  AND ii.policy_id IN (${policyIdsSql})
              `),
            ]);

            const toRows = (r: unknown) => Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
            const ctaPolicyIds = new Set(
              (toRows(ctaPaidResult) as { policy_id: number }[])
                .map((r) => Number(r.policy_id)).filter((id) => id > 0),
            );
            clientPaidPolicyIds = new Set(
              (toRows(clientPaidResult) as { policy_id: number }[])
                .map((r) => Number(r.policy_id)).filter((id) => id > 0 && !ctaPolicyIds.has(id)),
            );
            agentPaidPolicyIds = new Set(
              (toRows(agentPaidResult) as { policy_id: number }[])
                .map((r) => Number(r.policy_id)).filter((id) => id > 0),
            );

            const commRows = toRows(commissionResult);
            commissionTotalCents = (commRows[0] as { total?: number })?.total ?? 0;
            const agentAmtRows = toRows(agentPaidAmtResult);
            agentPaidTotal = (agentAmtRows[0] as { total?: number })?.total ?? 0;

            for (const it of items) {
              if (clientPaidPolicyIds.has(it.policyId)) {
                (it as { paymentBadge?: string }).paymentBadge = "Premium settled \u00b7 Client paid directly";
              } else if (agentPaidPolicyIds.has(it.policyId)) {
                (it as { paymentBadge?: string }).paymentBadge = "Agent paid";
              }
            }

            clientPaidTotal = items
              .filter((it) => clientPaidPolicyIds.has(it.policyId)
                && !(it.description ?? "").toLowerCase().includes("commission:")
                && !(it.description ?? "").toLowerCase().includes("credit:"))
              .reduce((sum, it) => sum + it.amountCents, 0);
          }

          const paidPolicyIds = new Set([...clientPaidPolicyIds, ...agentPaidPolicyIds]);
          const isComm = (it: typeof items[0]) => {
            const d = (it.description ?? "").toLowerCase();
            return d.includes("commission:") || d.includes("credit:");
          };
          for (const it of items) {
            if (!isComm(it)) {
              it.status = paidPolicyIds.has(it.policyId) ? "paid_individually" : "active";
            }
          }

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
            agentPaidTotal,
            clientPaidTotal,
            summaryTotals: commissionTotalCents > 0
              ? { commissionTotal: commissionTotalCents }
              : undefined,
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
    packageFieldVariants: Object.keys(packageFieldVariants).length > 0 ? packageFieldVariants : undefined,
  };

  return { ctx, policyNumber: policy.policyNumber };
}
