import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { clients } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const debugEnabled =
      request.headers.get("x-debug") === "1" ||
      request.headers.get("x-debug") === "true";
    const body = (await request.json()) as {
      isActive?: boolean;
      displayName?: string;
      primaryId?: string;
      contactPhone?: string | null;
      category?: "company" | "personal";
    };

    // Accept common aliases and case-insensitive keys from clients
    const anyBody = body as Record<string, unknown>;
    const pickBool = (...keys: string[]) => {
      for (const k of keys) {
        const v = anyBody[k] as unknown;
        if (typeof v === "boolean") return v;
      }
      return undefined;
    };
    const pickStr = (...keys: string[]) => {
      for (const k of keys) {
        const v = anyBody[k] as unknown;
        if (typeof v === "string") return v;
      }
      return undefined;
    };

    const update: {
      isActive?: boolean;
      displayName?: string;
      primaryId?: string;
      contactPhone?: string | null;
      category?: "company" | "personal";
    } = {};

    const isActiveIn = pickBool("isActive", "isactive", "active");
    if (typeof isActiveIn === "boolean") update.isActive = isActiveIn;

    const displayNameIn = pickStr("displayName", "displayname", "name");
    if (typeof displayNameIn === "string") update.displayName = displayNameIn.trim();

    const primaryIdIn = pickStr("primaryId", "primaryid", "primary_id");
    if (typeof primaryIdIn === "string") update.primaryId = primaryIdIn.trim();

    const contactPhoneIn = pickStr("contactPhone", "contactphone", "phone");
    if (typeof contactPhoneIn === "string" || anyBody["contactPhone"] === null || anyBody["contactphone"] === null) {
      update.contactPhone = (contactPhoneIn ?? null) as string | null;
    }

    const categoryIn = pickStr("category");
    if (categoryIn === "company" || categoryIn === "personal") update.category = categoryIn;

	// Merge insured_* keys (exact, no renaming) into extraAttributes when provided,
	// and support explicit deletions via `deletedKeys`.
	const insuredIn = anyBody["insured"];
	const deletedKeysIn = anyBody["deletedKeys"];
	const hasDeletedKeys = Array.isArray(deletedKeysIn) && (deletedKeysIn as unknown[]).length > 0;
	if ((insuredIn && typeof insuredIn === "object" && !Array.isArray(insuredIn)) || hasDeletedKeys) {
		const [current] = await db
			.select({
				extra: clients.extraAttributes,
				category: clients.category,
				displayName: clients.displayName,
				primaryId: clients.primaryId,
				contactPhone: clients.contactPhone,
			})
			.from(clients)
			.where(eq(clients.id, clientId))
			.limit(1);
		const base = ((current?.extra as unknown) ?? {}) as Record<string, unknown>;
		const currentCategory = String((current as any)?.category ?? "").trim().toLowerCase();
		const additions = (insuredIn && typeof insuredIn === "object" && !Array.isArray(insuredIn))
			? (insuredIn as Record<string, unknown>)
			: {};
		// Accept keys that start with "insured_" / "contactinfo_" (preferred)
		// and legacy double-underscore "insured__" / "contactinfo__" (still accepted).
		// Normalize on write to a canonical form:
		// - convert __ → _
		// - lowercase keys
		const normalizeKey = (k: string): string => {
			let out = k;
			if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
			if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
			return out.toLowerCase();
		};
		// Normalize by meaning so we can remove old variants:
		// companyName / company_name / companyname should be treated as the same field.
		const normalizeMeaningToken = (k: string): { group: "insured" | "contactinfo" | null; token: string } => {
			const canon = normalizeKey(k);
			const group = canon.startsWith("insured_") ? "insured" : canon.startsWith("contactinfo_") ? "contactinfo" : null;
			const token = canon
				.replace(/^(insured|contactinfo)_/i, "")
				.toLowerCase()
				.replace(/[^a-z0-9]/g, "");
			return { group, token };
		};
		const merged: Record<string, unknown> = { ...base };
		const changes: Array<{ key: string; from: unknown; to: unknown }> = [];
		let prunedAny = false;
		// If the caller explicitly requests deletion via `deletedKeys`, that intent must win.
		// We track requested deletions by "meaning token" so variant keys cannot resurrect data.
		const deletedMeaning = new Set<string>();
		try {
			if (hasDeletedKeys) {
				for (const raw of (deletedKeysIn as unknown[])) {
					const storeKey = normalizeKey(String(raw ?? ""));
					if (!storeKey) continue;
					const { group, token } = normalizeMeaningToken(storeKey);
					if (group && token) deletedMeaning.add(`${group}:${token}`);
				}
			}
		} catch {
			// ignore
		}

		// Apply explicit deletions first, so later merges can re-add if caller intends.
		try {
			if (hasDeletedKeys) {
				const normalizeInput = (k: unknown): string => normalizeKey(String(k ?? ""));
				for (const raw of (deletedKeysIn as unknown[])) {
					const storeKey = normalizeInput(raw);
					if (!storeKey) continue;
					if (!(storeKey.startsWith("insured_") || storeKey.startsWith("contactinfo_"))) continue;
					const { group, token } = normalizeMeaningToken(storeKey);
					const prev = (() => {
						if (Object.prototype.hasOwnProperty.call(base, storeKey)) return base[storeKey];
						if (group && token) {
							for (const [bk, bv] of Object.entries(base)) {
								const t = normalizeMeaningToken(bk);
								if (t.group === group && t.token === token) return bv;
							}
						}
						return undefined;
					})();
					// Prune all variants for the same meaning token (including storeKey)
					if (group && token) {
						for (const existingKey of Object.keys(merged)) {
							const ek = normalizeKey(existingKey);
							if (!(ek.startsWith(`${group}_`))) continue;
							const et = ek
								.replace(/^(insured|contactinfo)_/i, "")
								.toLowerCase()
								.replace(/[^a-z0-9]/g, "");
							if (et === token) {
								if (Object.prototype.hasOwnProperty.call(merged, existingKey)) {
									delete merged[existingKey];
									prunedAny = true;
								}
							}
						}
					} else {
						if (Object.prototype.hasOwnProperty.call(merged, storeKey)) {
							delete merged[storeKey];
							prunedAny = true;
						}
					}
					changes.push({ key: storeKey, from: prev, to: null });
				}
			}
		} catch {
			// ignore delete application failures
		}

		for (const [k, v] of Object.entries(additions)) {
			if (
				typeof k === "string" &&
				(k.startsWith("insured_") || k.startsWith("contactinfo_") || k.startsWith("insured__") || k.startsWith("contactinfo__"))
			) {
				const storeKey = normalizeKey(k);
				// IMPORTANT: delete any legacy/variant keys for the same meaning token,
				// otherwise the client JSON can contain both "old" and "new" values.
				const { group, token } = normalizeMeaningToken(storeKey);
				// If this meaning token was explicitly marked deleted, do not allow any value
				// (including a stale one) to re-introduce it within the same request.
				const forcedDelete = !!(group && token && deletedMeaning.has(`${group}:${token}`));
				const isDelete = forcedDelete || v === null || (typeof v === "string" && v.trim() === "");
				// Find previous value by meaning token (covers legacy variants)
				const prev = (() => {
					if (Object.prototype.hasOwnProperty.call(base, storeKey)) return base[storeKey];
					if (group && token) {
						for (const [bk, bv] of Object.entries(base)) {
							const t = normalizeMeaningToken(bk);
							if (t.group === group && t.token === token) return bv;
						}
					}
					return undefined;
				})();

				if (group && token) {
					for (const existingKey of Object.keys(merged)) {
						if (typeof existingKey !== "string") continue;
						const ek = normalizeKey(existingKey);
						if (!(ek.startsWith(`${group}_`))) continue;
						const et = ek
							.replace(/^(insured|contactinfo)_/i, "")
							.toLowerCase()
							.replace(/[^a-z0-9]/g, "");
						// For normal writes, prune variants except the chosen storeKey.
						// For deletes, prune ALL variants including storeKey itself.
						if (et === token && (isDelete || ek !== storeKey)) {
							if (Object.prototype.hasOwnProperty.call(merged, existingKey)) {
								delete merged[existingKey];
								prunedAny = true;
							}
						}
					}
				}

				if (isDelete) {
					// Explicit delete: remove canonical key too if present
					if (Object.prototype.hasOwnProperty.call(merged, storeKey)) {
						delete merged[storeKey];
						prunedAny = true;
					}
					// Record the delete intent even if we can't find a current value in `base`.
					// This is critical because some legacy data may exist only in `_audit`, and
					// the read-path replays `_audit` (last-wins). A delete must override that.
					changes.push({ key: storeKey, from: prev, to: null });
					continue;
				}

				const equal =
					(typeof prev === "object" || typeof v === "object")
						? JSON.stringify(prev) === JSON.stringify(v)
						: prev === v;
				if (!equal) {
					changes.push({ key: storeKey, from: prev, to: v });
				}
				merged[storeKey] = v;
			}
		}
		// Derive core client fields from insured_* dynamic keys so list views stay consistent.
		// This is important because `/api/clients` list uses `clients.displayName`, not extraAttributes.
		const pickStrFromMerged = (...keys: string[]) => {
			for (const k of keys) {
				const v = merged[k];
				if (typeof v === "string" && v.trim()) return v.trim();
			}
			return "";
		};
		const pickPrimaryIdFromMerged = (...keys: string[]) => {
			for (const k of keys) {
				const v = merged[k];
				if (typeof v === "string" && v.trim()) return v.trim();
			}
			return "";
		};
		try {
			if (!update.displayName) {
				if (currentCategory === "company") {
					const companyName = pickStrFromMerged(
						"insured_companyname",
						"insured_company_name",
						"insured_organisationname",
						"insured_orgname"
					);
					if (companyName) update.displayName = companyName;
				} else if (currentCategory === "personal") {
					const fullName = pickStrFromMerged("insured_fullname", "insured_full_name");
					const firstName = pickStrFromMerged("insured_firstname", "insured_first_name");
					const lastName = pickStrFromMerged("insured_lastname", "insured_last_name");
					const composed =
						fullName ||
						[lastName, firstName].filter(Boolean).join(" ").trim();
					if (composed) update.displayName = composed;
				}
			}
			if (!update.primaryId) {
				if (currentCategory === "company") {
					const br = pickPrimaryIdFromMerged("insured_brnumber", "insured_br_number");
					const ci = pickPrimaryIdFromMerged("insured_cinumber", "insured_ci_number");
					const next = br || ci;
					if (next) update.primaryId = next;
				} else if (currentCategory === "personal") {
					const idNo = pickPrimaryIdFromMerged("insured_idnumber", "insured_id_number", "insured_hkid");
					if (idNo) update.primaryId = idNo;
				}
			}
			if (typeof update.contactPhone === "undefined") {
				// Best-effort sync of core contactPhone for list/search convenience
				const phone = pickStrFromMerged(
					"contactinfo_mobile",
					"contactinfo_phone",
					"contactinfo_tel",
					"insured_contactphone",
					"insured_contact_phone"
				);
				if (phone) {
					update.contactPhone = phone;
				} else {
					// If caller explicitly deleted all phone-ish contact fields, clear the core column too.
					// Without this, list/detail views that fall back to `clients.contactPhone` can show stale data.
					const deletedPhoneish =
						deletedMeaning.has("contactinfo:mobile") ||
						deletedMeaning.has("contactinfo:phone") ||
						deletedMeaning.has("contactinfo:tel") ||
						deletedMeaning.has("insured:contactphone");
					if (deletedPhoneish) update.contactPhone = null;
				}
			}
		} catch {
			// ignore core derivation failure
		}
		// Global cleanup: remove any double-prefixed broken keys that can be produced by buggy clients
		// (e.g. `insured_insured_companyname`). These are never valid dynamic keys.
		for (const existingKey of Object.keys(merged)) {
			if (typeof existingKey !== "string") continue;
			const ek = normalizeKey(existingKey);
			if (ek.startsWith("insured_insured_") || ek.startsWith("insured_contactinfo_") || ek.startsWith("contactinfo_contactinfo_") || ek.startsWith("contactinfo_insured_")) {
				if (Object.prototype.hasOwnProperty.call(merged, existingKey)) {
					delete merged[existingKey];
					prunedAny = true;
				}
			}
		}
		// Persist when there are field changes OR when we pruned legacy variants.
		// Pruning is required to prevent "old vs new" duplication in JSON.
		if (changes.length > 0 || prunedAny) {
			// Append audit entry only when there are actual field changes
			try {
				if (changes.length > 0) {
					// De-dupe changes by "meaning" (group + normalized token) so the audit log
					// never records duplicates like `contactinfo_tel` + `contactinfo__tel` in the same entry.
					// Keep last-write-wins ordering for readability.
					const changesDedup = (() => {
						const m = new Map<string, { key: string; from: unknown; to: unknown }>();
						for (const c of changes) {
							const rawKey = String(c?.key ?? "");
							const { group, token } = normalizeMeaningToken(rawKey);
							const mk = group && token ? `${group}:${token}` : rawKey;
							if (m.has(mk)) m.delete(mk);
							m.set(mk, { key: rawKey, from: c?.from, to: c?.to });
						}
						return Array.from(m.values());
					})();

					const nowIso = new Date().toISOString();
					const auditKey = "_audit";
					const currentAudit = Array.isArray((merged as any)[auditKey]) ? ((merged as any)[auditKey] as unknown[]) : [];
					const by = { id: user.id, email: (user as any)?.email };
					const entry = { at: nowIso, by, changes: changesDedup };
					(merged as any)[auditKey] = [...currentAudit, entry];
					(merged as any)["_lastEditedAt"] = nowIso;
					(merged as any)["_lastEditedBy"] = by;
				}
			} catch {
				// non-fatal; ignore audit failure
			}
			update["extraAttributes" as never] = merged as never;
		}
	}

    // If we received an insured payload but it results in no changes, treat as a no-op success
    // (do not return 400, since the caller is attempting to "save" the current state).
    if (
      Object.keys(update).length === 0 &&
      anyBody["insured"] &&
      typeof anyBody["insured"] === "object" &&
      !Array.isArray(anyBody["insured"])
    ) {
      const receivedKeys =
        typeof anyBody["insured"] === "object" && anyBody["insured"]
          ? Object.keys(anyBody["insured"] as Record<string, unknown>)
              .filter((k) => typeof k === "string")
              .slice(0, 100)
          : [];
      return NextResponse.json({ ok: true, noop: true, receivedKeys }, { status: 200 });
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    // Try update; if column is_active doesn't exist yet, retry without it
    let row: { id: number } | undefined;
    try {
      [row] = await db.update(clients).set(update).where(eq(clients.id, clientId)).returning({ id: clients.id });
    } catch (_err) {
      // remove isActive and retry for pre-migration DBs
      const { isActive, ...rest } = update;
      if (typeof isActive !== "undefined") {
        // If there is nothing else to update, treat as a no-op success.
        if (Object.keys(rest).length === 0) {
          // Persist a shadow flag into extra_attributes so UI can reflect state pre-migration
          try {
            const [current] = await db
              .select({ extra: clients.extraAttributes })
              .from(clients)
              .where(eq(clients.id, clientId))
              .limit(1);
            const base = ((current?.extra as unknown) ?? {}) as Record<string, unknown>;
            const newExtra: Record<string, unknown> = { ...base, shadow_is_active: isActive };
            await db.update(clients).set({ extraAttributes: newExtra }).where(eq(clients.id, clientId));
          } catch {
            // ignore persistence failure; still return success
          }
          return NextResponse.json({ ok: true, note: "isActive stored in shadow flag (column missing)" }, { status: 200 });
        }
        [row] = await db.update(clients).set(rest).where(eq(clients.id, clientId)).returning({ id: clients.id });
      } else {
        throw _err;
      }
    }
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Best-effort return updated keys for debugging (no values).
    const updatedKeys = (() => {
      const insuredObj = anyBody["insured"];
      if (!insuredObj || typeof insuredObj !== "object" || Array.isArray(insuredObj)) return [];
      // We don't have access to the local `changes` array here (it is inside the merge block),
      // so we return a conservative list of submitted keys.
      // The UI will still be able to see "noop" vs "ok" and the server logs/audit captures the exact diff.
      return Object.keys(insuredObj as Record<string, unknown>).slice(0, 100);
    })();
    if (debugEnabled) {
      // Debug info for troubleshooting "delete not applied" cases.
      const deletedKeysIn = anyBody["deletedKeys"];
      const insuredObj =
        anyBody["insured"] && typeof anyBody["insured"] === "object" && !Array.isArray(anyBody["insured"])
          ? (anyBody["insured"] as Record<string, unknown>)
          : null;
      const [after] = await db
        .select({ extra: clients.extraAttributes })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      const extra = ((after?.extra as unknown) ?? {}) as Record<string, unknown>;
      const pickStored = (k: string) => ({
        present: Object.prototype.hasOwnProperty.call(extra, k),
        value: Object.prototype.hasOwnProperty.call(extra, k) ? (extra as any)[k] : null,
      });
      try {
        // eslint-disable-next-line no-console
        console.log("[debug] PATCH /api/clients stored", {
          clientId,
          receivedDeletedKeys: Array.isArray(deletedKeysIn) ? deletedKeysIn : null,
          stored: {
            contactinfo_tel: pickStored("contactinfo_tel"),
            contactinfo_blockname: pickStored("contactinfo_blockname"),
          },
        });
      } catch {
        // ignore
      }
      return NextResponse.json(
        {
          ok: true,
          updatedKeys,
          debug: {
            receivedDeletedKeys: Array.isArray(deletedKeysIn) ? deletedKeysIn : null,
            receivedInsuredKeys: insuredObj ? Object.keys(insuredObj).slice(0, 80) : [],
            receivedInsured: insuredObj
              ? {
                  contactinfo_tel: insuredObj["contactinfo_tel"],
                  contactinfo__tel: insuredObj["contactinfo__tel"],
                  contactinfo_blockname: insuredObj["contactinfo_blockname"],
                  contactinfo__blockname: insuredObj["contactinfo__blockname"],
                  // common nested package shapes
                  "newExistingClient__contactinfo_tel": insuredObj["newExistingClient__contactinfo_tel" as never],
                  "newExistingClient__contactinfo_blockname": insuredObj["newExistingClient__contactinfo_blockname" as never],
                  "newexistingclient__contactinfo_tel": insuredObj["newexistingclient__contactinfo_tel" as never],
                  "newexistingclient__contactinfo_blockname": insuredObj["newexistingclient__contactinfo_blockname" as never],
                }
              : null,
            stored: {
              contactinfo_tel: pickStored("contactinfo_tel"),
              contactinfo_blockname: pickStored("contactinfo_blockname"),
              contactinfo__tel: pickStored("contactinfo__tel"),
              contactinfo__blockname: pickStored("contactinfo__blockname"),
            },
          },
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: true, updatedKeys }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const [row] = await db.delete(clients).where(eq(clients.id, clientId)).returning({ id: clients.id });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const user = await requireUser();
    const { id } = await context.params;
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    // Agents may only access clients that have at least one policy authored by them
    if (user.userType === "agent") {
      const result = await db.execute(sql`
        with has_client as (
          select exists (select 1 from information_schema.columns where table_name='policies' and column_name='client_id') as present
        )
        select 1
        from "policies" p
        left join "cars" x on x.policy_id = p.id
        where p.agent_id = ${Number(user.id)}
          and (
            ((select present from has_client) and p.client_id = ${clientId})
            or ((x.extra_attributes->>'clientId')::int = ${clientId})
            or (((x.extra_attributes->'packagesSnapshot'->'policy')->>'clientId')::int = ${clientId})
            or (((x.extra_attributes->'packagesSnapshot'->'policy'->'values')->>'clientId')::int = ${clientId})
            or ((x.extra_attributes->>'client_id')::int = ${clientId})
            or ((x.extra_attributes->>'clientid')::int = ${clientId})
          )
        limit 1
      `);
      const ok =
        Array.isArray(result)
          ? Boolean(result[0])
          : Boolean((result as any)?.rows?.[0]);
      if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const [row] = await db
        .select({
          id: clients.id,
          clientNumber: clients.clientNumber,
          category: clients.category,
          displayName: clients.displayName,
          primaryId: clients.primaryId,
          contactPhone: clients.contactPhone,
          isActive: clients.isActive,
          createdAt: clients.createdAt,
          extraAttributes: clients.extraAttributes,
        })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      // Fetch related policies; for agents, only include those they authored
      let policyRows: Array<{ id: number; policyNumber: string }> = [];
      try {
        const result = await db.execute(sql`
          with has_col as (
            select exists (
              select 1 from information_schema.columns where table_name='policies' and column_name='client_id'
            ) as present
          ),
          has_agent as (
            select exists (
              select 1 from information_schema.columns where table_name='policies' and column_name='agent_id'
            ) as present
          )
          select p.id, p.policy_number as "policyNumber"
          from "policies" p
          inner join "cars" c on c.policy_id = p.id
          where
            (
              ((select present from has_col) and p.client_id = ${clientId})
              or (not (select present from has_col) and (
                (c.extra_attributes->>'clientId') = ${String(clientId)}
                or ((c.extra_attributes->'packagesSnapshot'->'policy')->>'clientId') = ${String(clientId)}
                or ((c.extra_attributes->'packagesSnapshot'->'policy'->'values')->>'clientId') = ${String(clientId)}
                or (c.extra_attributes->>'client_id') = ${String(clientId)}
                or (c.extra_attributes->>'clientid') = ${String(clientId)}
                or (c.extra_attributes::text ILIKE ${'%\"client%\":' + String(clientId) + '%'})
                or (c.extra_attributes::text ILIKE ${'%\"client%\":\"' + String(clientId) + '\"%'})
              ))
            )
            ${
              user.userType === "agent"
                ? sql`and (select present from has_agent) and p.agent_id = ${Number(user.id)}`
                : sql``
            }
          order by p.id desc
        `);
        const rows = (Array.isArray(result) ? result : (result as any)?.rows) as Array<{ id: number; policyNumber: string }>;
        if (Array.isArray(rows)) policyRows = rows.map((r) => ({ id: Number(r.id), policyNumber: String((r as any).policyNumber ?? (r as any).policy_number ?? "") }));
      } catch {
        policyRows = [];
      }
      // Resolve dynamic insured/contact keys on read so UIs never see "old vs new" variants.
      const resolvedExtra = (() => {
        const base = (row.extraAttributes ?? null) as Record<string, unknown> | null;
        if (!base || typeof base !== "object") return row.extraAttributes;
        const normalizeKey = (k: string): string => {
          let out = String(k ?? "").trim();
          if (!out) return "";
          if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
          if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
          return out.toLowerCase();
        };
        const isDyn = (k: string) => k.startsWith("insured_") || k.startsWith("contactinfo_");
        // Canonicalize into a clean map
        const canon: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(base)) {
          const ck = normalizeKey(k);
          if (!ck) continue;
          if (isDyn(ck)) canon[ck] = v;
        }
        // Apply audit in append order (last wins)
        const auditRaw = (base as any)["_audit"] as unknown;
        if (Array.isArray(auditRaw)) {
          for (const entry of auditRaw as any[]) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];
            for (const c of changes as any[]) {
              const ck = normalizeKey(String(c?.key ?? ""));
              if (!ck || !isDyn(ck)) continue;
              canon[ck] = c?.to;
            }
          }
        }
        // Keep non-dynamic keys as-is, but:
        // - overwrite dynamic keys with resolved canonical ones
        // - strip non-canonical dynamic variants (e.g. `insured_brNumber`, `insured__brnumber`)
        //   so UIs never accidentally pick stale legacy keys.
        const out: Record<string, unknown> = { ...base };
        for (const k of Object.keys(out)) {
          const ck = normalizeKey(k);
          if (!ck) continue;
          if (!isDyn(ck)) continue;
          // Remove variant keys; keep only canonical lower-case single-underscore keys.
          if (k !== ck) delete out[k];
        }
        for (const [k, v] of Object.entries(canon)) out[k] = v;
        return out;
      })();

      // Also derive the core display fields from dynamic keys so the UI never shows stale columns.
      const derive = (category: string, extra: Record<string, unknown> | null | undefined) => {
        const m = (extra ?? {}) as Record<string, unknown>;
        const pick = (...keys: string[]) => {
          for (const k of keys) {
            const v = m[k];
            if (v === null || typeof v === "undefined") continue;
            const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : "";
            if (s && s.trim()) return s.trim();
          }
          return "";
        };
        const cat = String(category ?? "").trim().toLowerCase();
        const displayName =
          cat === "company"
            ? pick("insured_companyname", "insured_company_name", "insured_organisationname", "insured_orgname")
            : cat === "personal"
              ? pick("insured_fullname", "insured_full_name") ||
                [pick("insured_lastname", "insured_last_name"), pick("insured_firstname", "insured_first_name")]
                  .filter(Boolean)
                  .join(" ")
                  .trim()
              : pick("insured_companyname", "insured_fullname");
        const primaryId =
          cat === "company"
            ? pick("insured_brnumber", "insured_br_number", "insured_cinumber", "insured_ci_number")
            : cat === "personal"
              ? pick("insured_idnumber", "insured_id_number", "insured_hkid")
              : pick("insured_brnumber", "insured_idnumber");
        const contactPhone = pick(
          "contactinfo_mobile",
          "contactinfo_phone",
          "contactinfo_tel",
          "insured_contactphone",
          "insured_contact_phone"
        );
        return { displayName, primaryId, contactPhone };
      };
      const extraResolved = (resolvedExtra as any) as Record<string, unknown>;
      const derived = derive(String(row.category ?? ""), extraResolved);
      const hasAny = (m: Record<string, unknown>, keys: string[]) =>
        keys.some((k) => Object.prototype.hasOwnProperty.call(m, k));
      const hasDeleted = (m: Record<string, unknown>, keys: string[]) =>
        keys.some((k) => Object.prototype.hasOwnProperty.call(m, k) && (m as any)[k] === null);
      const nameKeys =
        String(row.category ?? "").trim().toLowerCase() === "company"
          ? ["insured_companyname", "insured_company_name", "insured_organisationname", "insured_orgname"]
          : ["insured_fullname", "insured_full_name", "insured_firstname", "insured_first_name", "insured_lastname", "insured_last_name"];
      const primaryKeys =
        String(row.category ?? "").trim().toLowerCase() === "company"
          ? ["insured_brnumber", "insured_br_number", "insured_cinumber", "insured_ci_number"]
          : ["insured_idnumber", "insured_id_number", "insured_hkid"];
      const phoneKeys = ["contactinfo_mobile", "contactinfo_phone", "contactinfo_tel", "insured_contactphone", "insured_contact_phone"];
      const nameExplicit = hasAny(extraResolved, nameKeys) || hasDeleted(extraResolved, nameKeys);
      const primaryExplicit = hasAny(extraResolved, primaryKeys) || hasDeleted(extraResolved, primaryKeys);
      const phoneExplicit = hasAny(extraResolved, phoneKeys) || hasDeleted(extraResolved, phoneKeys);

      return NextResponse.json(
        {
          ...row,
          // If a relevant dynamic key exists (including a null tombstone), treat it as authoritative
          // and do not fall back to legacy core columns.
          displayName: nameExplicit ? derived.displayName : (derived.displayName || row.displayName),
          primaryId: primaryExplicit ? derived.primaryId : (derived.primaryId || row.primaryId),
          contactPhone: phoneExplicit ? derived.contactPhone : (derived.contactPhone || row.contactPhone),
          extraAttributes: resolvedExtra as any,
          policies: policyRows,
        },
        {
          status: 200,
          headers: {
            "cache-control": "no-store, max-age=0",
          },
        }
      );
    } catch {
      const [row] = await db
        .select({
          id: clients.id,
          clientNumber: clients.clientNumber,
          category: clients.category,
          displayName: clients.displayName,
          primaryId: clients.primaryId,
          contactPhone: clients.contactPhone,
          createdAt: clients.createdAt,
          extra: clients.extraAttributes,
        })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const isActive =
        (row.extra as unknown as { shadow_is_active?: boolean } | null)?.shadow_is_active ?? true;
      // Legacy branch: same logic with dynamic presence check
      let policyRows: Array<{ id: number; policyNumber: string }> = [];
      try {
        const result = await db.execute(sql`
          with has_col as (
            select exists (
              select 1 from information_schema.columns where table_name='policies' and column_name='client_id'
            ) as present
          ),
          has_agent as (
            select exists (
              select 1 from information_schema.columns where table_name='policies' and column_name='agent_id'
            ) as present
          )
          select p.id, p.policy_number as "policyNumber"
          from "policies" p
          inner join "cars" c on c.policy_id = p.id
          where
            (
              ((select present from has_col) and p.client_id = ${clientId})
              or (not (select present from has_col) and (
                (c.extra_attributes->>'clientId') = ${String(clientId)}
                or ((c.extra_attributes->'packagesSnapshot'->'policy')->>'clientId') = ${String(clientId)}
                or ((c.extra_attributes->'packagesSnapshot'->'policy'->'values')->>'clientId') = ${String(clientId)}
                or (c.extra_attributes->>'client_id') = ${String(clientId)}
                or (c.extra_attributes->>'clientid') = ${String(clientId)}
                or (c.extra_attributes::text ILIKE ${'%\"client%\":' + String(clientId) + '%'})
                or (c.extra_attributes::text ILIKE ${'%\"client%\":\"' + String(clientId) + '\"%'})
              ))
            )
            ${
              `and ( (select present from has_agent) = false or ${user.userType === "agent" ? sql`p.agent_id = ${Number(user.id)}` : sql`true`} )`
            }
          order by p.id desc
        `);
        const rows = (Array.isArray(result) ? result : (result as any)?.rows) as Array<{ id: number; policyNumber: string }>;
        if (Array.isArray(rows)) policyRows = rows.map((r) => ({ id: Number(r.id), policyNumber: String((r as any).policyNumber ?? (r as any).policy_number ?? "") }));
      } catch {
        policyRows = [];
      }
      const out = {
        id: row.id,
        clientNumber: row.clientNumber,
        category: row.category,
        displayName: row.displayName,
        primaryId: row.primaryId,
        contactPhone: row.contactPhone,
        createdAt: row.createdAt,
        isActive,
        extraAttributes: (() => {
          const base = (row.extra as unknown as Record<string, unknown> | null) ?? null;
          if (!base || typeof base !== "object") return row.extra as unknown;
          const normalizeKey = (k: string): string => {
            let out = String(k ?? "").trim();
            if (!out) return "";
            if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
            if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
            return out.toLowerCase();
          };
          const isDyn = (k: string) => k.startsWith("insured_") || k.startsWith("contactinfo_");
          const canon: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(base)) {
            const ck = normalizeKey(k);
            if (!ck) continue;
            if (isDyn(ck)) canon[ck] = v;
          }
          const auditRaw = (base as any)["_audit"] as unknown;
          if (Array.isArray(auditRaw)) {
            for (const entry of auditRaw as any[]) {
              const changes = Array.isArray(entry?.changes) ? entry.changes : [];
              for (const c of changes as any[]) {
                const ck = normalizeKey(String(c?.key ?? ""));
                if (!ck || !isDyn(ck)) continue;
                canon[ck] = c?.to;
              }
            }
          }
          const out: Record<string, unknown> = { ...base };
          for (const k of Object.keys(out)) {
            const ck = normalizeKey(k);
            if (!ck) continue;
            if (!isDyn(ck)) continue;
            if (k !== ck) delete out[k];
          }
          for (const [k, v] of Object.entries(canon)) out[k] = v;
          return out;
        })(),
        policies: policyRows,
      };
      return NextResponse.json(out, {
        status: 200,
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      });
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

