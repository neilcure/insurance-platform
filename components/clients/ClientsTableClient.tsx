"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClientRowActions } from "@/components/clients/ClientRowActions";
import { Info, Loader2, X, ChevronDown } from "lucide-react";
// import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatContactLabel, getContactSortWeight } from "@/lib/format/contact-info";
import { PolicySnapshotView } from "@/components/policies/PolicySnapshotView";
import { Checkbox } from "@/components/ui/checkbox";
import { RecentHighlight } from "@/components/RecentHighlight";

// Audit types for client extraAttributes._audit
type AuditChange = { key: string; from: unknown; to: unknown };
type AuditEntry = {
	at?: string;
	by?: { id?: number | string; email?: string } | Record<string, unknown>;
	changes?: AuditChange[];
};

type Row = {
	id: number;
	clientNumber: string;
	category: string;
	displayName: string;
	isActive: boolean;
	createdAt: string;
};

type ClientDetail = {
	id: number;
	clientNumber: string;
	category: string;
	displayName: string;
	primaryId: string;
	contactPhone: string | null;
	isActive: boolean;
	createdAt: string;
	extraAttributes?: Record<string, unknown> | null;
	policies?: Array<{ id: number; policyNumber: string; createdAt?: string }>;
};

export default function ClientsTableClient({ initialRows }: { initialRows: Row[] }) {
	const [rows, setRows] = React.useState<Row[]>(initialRows);
	const [drawerOpen, setDrawerOpen] = React.useState(false);
	const [openId, setOpenId] = React.useState<number | null>(null);
	const [openingId, setOpeningId] = React.useState<number | null>(null);
	const [detail, setDetail] = React.useState<ClientDetail | null>(null);
	const [refreshing, setRefreshing] = React.useState(false);
	const refreshTimerRef = React.useRef<number | null>(null);
	// Dynamic insured fields (exact keys, e.g. insured_companyname)
	const [insuredFields, setInsuredFields] = React.useState<
		Array<{
			key: string;
			label: string;
			inputType: string;
			options?: Array<{ value: string; label: string }>;
			categories?: string[];
		}>
	>([]);
	const [insuredValues, setInsuredValues] = React.useState<Record<string, unknown>>({});
	const [dynamicEditOpen, setDynamicEditOpen] = React.useState(false);
	const [dynamicEditGroup, setDynamicEditGroup] = React.useState<"insured" | "contactinfo" | null>(null);
	const [auditOpen, setAuditOpen] = React.useState(false);
	const [auditDrawerOpen, setAuditDrawerOpen] = React.useState(false);
	// Removed client-level agent assignment (per-policy model)
	// Policy details view handled on /dashboard/policies
	// Right-hand policy details drawer (keeps client drawer visible)
	type PolicyDetail = {
		policyId: number;
		policyNumber: string;
		createdAt: string;
		carId: number | null;
		extraAttributes?: Record<string, unknown> | null;
		clientId?: number | null;
		client?: { id: number; clientNumber?: string; createdAt?: string } | null;
	};
	const [policyOpen, setPolicyOpen] = React.useState(false);
	const [policyDrawerOpen, setPolicyDrawerOpen] = React.useState(false);
	const [policyOpeningId, setPolicyOpeningId] = React.useState<number | null>(null);
	const [policyDetail, setPolicyDetail] = React.useState<PolicyDetail | null>(null);
	
	// UI: collapse control for Policies block in client details
	const [policiesCollapsed, setPoliciesCollapsed] = React.useState(false);

	React.useEffect(() => {
		if (openId === null) return;
		// Keep Client Details consistent with other pages by refreshing
		// when the tab regains focus (common workflow: update client via policy wizard, then return here).
		const schedule = () => {
			if (dynamicEditOpen) return;
			if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
			refreshTimerRef.current = window.setTimeout(() => {
				void openDetails(openId, { silent: true });
			}, 150);
		};
		const onFocus = () => schedule();
		const onVis = () => {
			if (!document.hidden) schedule();
		};
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onVis);
		return () => {
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onVis);
			if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
			refreshTimerRef.current = null;
		};
	}, [openId, dynamicEditOpen]);

	function openAudit() {
		setAuditOpen(true);
		requestAnimationFrame(() => setAuditDrawerOpen(true));
	}
	function closeAudit() {
		setAuditDrawerOpen(false);
		setTimeout(() => setAuditOpen(false), 400);
	}
	async function openPolicyDetails(id: number) {
		setPolicyOpeningId(id);
		setPolicyDetail(null);
		setPolicyOpen(true);
		requestAnimationFrame(() => setPolicyDrawerOpen(true));
		try {
			const res = await fetch(`/api/policies/${id}`, { cache: "no-store" });
			if (res.ok) {
				const d = (await res.json()) as PolicyDetail;
				setPolicyDetail(d);
				// Field label loading is handled by the shared PolicySnapshotView component
			}
		} finally {
			setPolicyOpeningId(null);
		}
	}
	function closePolicyDetails() {
		setPolicyDrawerOpen(false);
		setTimeout(() => setPolicyOpen(false), 400);
	}

	function formatDDMMYYYY(iso: string) {
		const d = new Date(iso);
		const dd = String(d.getDate()).padStart(2, "0");
		const mm = String(d.getMonth() + 1).padStart(2, "0");
		const yyyy = d.getFullYear();
		return `${dd}-${mm}-${yyyy}`;
	}

	function closeDrawer() {
		setDrawerOpen(false);
		setTimeout(() => setOpenId(null), 250);
	}

	async function openDetails(id: number, opts?: { silent?: boolean }) {
		const silent = Boolean(opts?.silent);
		if (!silent) {
			setOpenId(id);
			setDetail(null);
			setDrawerOpen(false);
			requestAnimationFrame(() => setDrawerOpen(true));
		}
		setOpeningId(id);
		try {
			const res = await fetch(`/api/clients/${id}`, { cache: "no-store" });
			if (!res.ok) throw new Error(await res.text());
			const json = (await res.json()) as ClientDetail;
			setDetail(json);
			// No client-level agent assignment data needed
			// Load related policies using the dedicated API filters to ensure consistent matching
			try {
				const fetchBy = async (qs: string) => {
					const r = await fetch(`/api/policies?${qs}`, { cache: "no-store" });
					if (!r.ok) return [] as Array<{ policyId?: number; policyNumber?: string }>;
					return (await r.json()) as Array<{ policyId?: number; policyNumber?: string }>;
				};
				let list = await fetchBy(`clientId=${encodeURIComponent(String(id))}`);
				if (!Array.isArray(list) || list.length === 0) {
					// fallback to clientNumber if no rows by id (dynamic data that stores only number)
					const cn = String(json.clientNumber ?? "");
					if (cn) {
						list = await fetchBy(`clientNumber=${encodeURIComponent(cn)}`);
					}
					// final fallback: fetch all (with extras) and filter by snapshot keys locally
					if ((!Array.isArray(list) || list.length === 0) && cn) {
						try {
							const r = await fetch(`/api/policies`, { cache: "no-store" });
							if (r.ok) {
								type APIRow = {
									policyId?: number;
									policyNumber?: string;
									carExtra?: {
										clientId?: number | string | null;
										clientNumber?: string | null;
										packagesSnapshot?: {
											policy?: { clientNumber?: string | null; values?: { clientNumber?: string | null } | null } | null;
										} | null;
									} | null;
								};
								const all = (await r.json()) as APIRow[];
								const matches: Array<{ policyId: number; policyNumber: string }> = [];
								for (const row of Array.isArray(all) ? all : []) {
									const pid = Number(row?.policyId ?? 0);
									const pno = String(row?.policyNumber ?? "");
									if (!(Number.isFinite(pid) && pid > 0 && pno)) continue;
									const extra = (row?.carExtra ?? null) as Record<string, unknown> | null;
									if (!extra || typeof extra !== "object") continue;
									const cidRaw = (extra as Record<string, unknown>)?.["clientId"];
									const cidNum = Number(cidRaw as unknown);
									const clientIdMatch = Number.isFinite(cidNum) && cidNum === Number(id);
									const cnSnap =
										String((extra as { clientNumber?: string | null }).clientNumber ?? "") ||
										String(
											(
												(extra as {
													packagesSnapshot?: { policy?: { clientNumber?: string | null } | null } | null;
												}).packagesSnapshot?.policy?.clientNumber ?? ""
											)
										) ||
										String(
											(
												(extra as {
													packagesSnapshot?: { policy?: { values?: { clientNumber?: string | null } | null } | null } | null;
												}).packagesSnapshot?.policy?.values?.clientNumber ?? ""
											)
										) ||
										"";
									const clientNoMatch = cn && cnSnap && cnSnap === cn;
									if (clientIdMatch || clientNoMatch) {
										matches.push({ policyId: pid, policyNumber: pno });
									}
								}
								if (matches.length > 0) {
									list = matches;
								}
							}
						} catch {
							// ignore
						}
					}
				}
				const policies = Array.isArray(list)
					? list
							.map((r) => ({
								id: Number((r as { policyId?: number }).policyId ?? 0),
								policyNumber: String((r as { policyNumber?: string }).policyNumber ?? ""),
								createdAt: (() => {
									const raw = (r as { createdAt?: unknown })?.createdAt;
									return typeof raw === "string" ? raw : undefined;
								})(),
							}))
							.filter((p) => Number.isFinite(p.id) && p.id > 0 && p.policyNumber.length > 0)
					: [];
				const policiesSorted = [...policies].sort((a, b) => {
					const ta = Date.parse(String(a.createdAt ?? ""));
					const tb = Date.parse(String(b.createdAt ?? ""));
					const fa = Number.isFinite(ta);
					const fb = Number.isFinite(tb);
					// newest first
					if (fa && fb && ta !== tb) return tb - ta;
					if (fa && !fb) return -1;
					if (!fa && fb) return 1;
					// fallback: higher id is newer
					return b.id - a.id;
				});
				setDetail((d) => (d ? { ...d, policies: policiesSorted } : d));
			} catch {
				// ignore policy loading failure
			}
			// Load dynamic insured fields (groupKey follows Step 1)
			try {
				// If the user is editing, do not refresh under them (prevents confusing overwrite).
				if (dynamicEditOpen) return;

				const canonicalizePrefixedKey = (k: string): string => {
					let out = String(k ?? "").trim();
					if (!out) return "";
					if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
					if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
					return out.toLowerCase();
				};
				const normalizeBase = (key: string) =>
					String(key ?? "")
						.replace(/^(insured|contactinfo)__?/i, "")
						.toLowerCase()
						.replace(/[^a-z0-9]/g, "");

				// load both insured_fields and contactinfo_fields
				const [insRes, conRes] = await Promise.all([
					fetch(`/api/form-options?groupKey=insured_fields&includeInactive=true`, { cache: "no-store" }),
					fetch(`/api/form-options?groupKey=contactinfo_fields&includeInactive=true`, { cache: "no-store" }),
				]);
				const insured = insRes.ok
					? ((await insRes.json()) as Array<{ value?: unknown; label?: unknown; meta?: unknown; options?: unknown }>)
					: [];
				const contact = conRes.ok
					? ((await conRes.json()) as Array<{ value?: unknown; label?: unknown; meta?: unknown; options?: unknown }>)
					: [];
				// Sort each group by sortOrder if present to preserve admin configuration order
				const sortByOrder = <T extends { sortOrder?: unknown }>(arr: T[]): T[] => {
					return [...arr].sort((a, b) => (Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0)));
				};
				const insuredSorted = sortByOrder(insured as Array<{ sortOrder?: number }>);
				const contactSorted = sortByOrder(contact as Array<{ sortOrder?: number }>);

				const mapFields = (
					list: Array<{ value?: unknown; label?: unknown; meta?: unknown }>,
					prefix: "insured" | "contactinfo"
				) =>
					list
						.map((f) => {
							const rawKey = String(f?.value ?? "").trim();
							const keyRawPrefixed =
								rawKey.startsWith(`${prefix}_`) || rawKey.startsWith(`${prefix}__`) ? rawKey : `${prefix}_${rawKey}`;
							const key = canonicalizePrefixedKey(keyRawPrefixed);
							const label = String(f?.label ?? key);
							const meta = (f?.meta ?? {}) as {
								inputType?: unknown;
								options?: Array<{ value?: unknown; label?: unknown }>;
								categories?: unknown;
							};
							const inputType = typeof meta.inputType === "string" ? meta.inputType : "text";
							const opts = Array.isArray(meta?.options)
								? (meta.options as Array<{ value?: unknown; label?: unknown }>).map((o) => ({
										value: String(o?.value ?? o?.label ?? ""),
										label: String(o?.label ?? o?.value ?? ""),
								  }))
								: undefined;
							const categories = Array.isArray(meta?.categories)
								? (meta.categories as unknown[]).map((c) => String(c ?? "").toLowerCase())
								: undefined;
							return { key, label, inputType, options: opts, categories };
						})
						// do not filter by prefixes here; some configs use unprefixed keys
						.filter((f) => typeof f.key === "string" && f.key.trim() !== "");

				const mappedInsured = mapFields(insuredSorted as Array<{ value?: unknown; label?: unknown; meta?: unknown }>, "insured");
				const mappedContact = mapFields(contactSorted as Array<{ value?: unknown; label?: unknown; meta?: unknown }>, "contactinfo");
				// Fallback: include any extraAttributes keys that start with insured_/contactinfo_ but are not in options
				const baseEA: Record<string, unknown> =
					(typeof json.extraAttributes === "object" && json.extraAttributes) ? (json.extraAttributes as Record<string, unknown>) : {};
				const existingKeys = new Set([...mappedInsured, ...mappedContact].map((m) => canonicalizePrefixedKey(m.key)));
				const extraFallbacks: Array<{ key: string; label: string; inputType: string; options?: Array<{ value: string; label: string }> }> = [];
				const fallbackAdded = new Set<string>();
				for (const k of Object.keys(baseEA)) {
					if (typeof k !== "string") continue;
					if (
						!(
							k.startsWith("insured_") ||
							k.startsWith("contactinfo_") ||
							k.startsWith("insured__") ||
							k.startsWith("contactinfo__")
						)
					)
						continue;
					const canon = canonicalizePrefixedKey(k);
					if (!canon) continue;
					if (existingKeys.has(canon)) continue;
					const norm = normalizeBase(canon);
					if (fallbackAdded.has(norm)) continue;
					// Derive a readable label from the key: remove prefix and title-case
					const raw = canon.replace(/^(insured|contactinfo)__?/, "");
					const label = raw
						.replace(/_/g, " ")
						.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
						.replace(/\s+/g, " ")
						.trim()
						.replace(/^./, (c) => c.toUpperCase());
					extraFallbacks.push({ key: canon, label: label || canon, inputType: "text" });
					fallbackAdded.add(norm);
				}
				const finalFields = [...mappedInsured, ...mappedContact, ...extraFallbacks];
				setInsuredFields(finalFields);
				// Seed values from client's extraAttributes if present
				const base: Record<string, unknown> =
					(typeof json.extraAttributes === "object" && json.extraAttributes) ? (json.extraAttributes as Record<string, unknown>) : {};
				// Use the same resolution logic as the left display:
				// - normalize by meaning (group + normalized base token)
				// - apply audit in append-order (last wins)
				// - otherwise fall back to best stored value among variants
				const normalizeBaseToken = (k: string): string =>
					String(k ?? "")
						.replace(/^(insured|contactinfo)__?/i, "")
						.toLowerCase()
						.replace(/[^a-z0-9]/g, "");
				const getGroupAndNorm = (k: string): { group: "insured" | "contactinfo" | null; norm: string } => {
					const canon = canonicalizePrefixedKey(k);
					const group = canon.startsWith("insured_")
						? "insured"
						: canon.startsWith("contactinfo_")
							? "contactinfo"
							: null;
					return { group, norm: normalizeBaseToken(canon) };
				};
				const bestValueByGroupNorm = new Map<string, unknown>();
				const bestScoreByGroupNorm = new Map<string, number>();
				const scoreKeyShape = (rawKey: string): number => {
					const canon = canonicalizePrefixedKey(rawKey);
					if (!canon) return 0;
					const lower = rawKey === rawKey.toLowerCase() ? 10 : 0;
					const single = rawKey.startsWith("insured_") || rawKey.startsWith("contactinfo_") ? 6 : 0;
					const dbl = rawKey.startsWith("insured__") || rawKey.startsWith("contactinfo__") ? -2 : 0;
					const rest = canon.replace(/^(insured|contactinfo)_/i, "");
					const snake = /_/.test(rest) ? 1 : 0;
					return lower + single + dbl + snake;
				};
				for (const k of Object.keys(base)) {
					const { group, norm } = getGroupAndNorm(k);
					if (!group || !norm) continue;
					const mapKey = `${group}:${norm}`;
					const score = scoreKeyShape(k);
					const prevScore = bestScoreByGroupNorm.get(mapKey);
					if (typeof prevScore === "undefined" || score > prevScore) {
						bestScoreByGroupNorm.set(mapKey, score);
						bestValueByGroupNorm.set(mapKey, base[k]);
					}
				}
				const maybeAudit = (base as Record<string, unknown>)["_audit" as const] as unknown;
				const audit: AuditEntry[] = Array.isArray(maybeAudit) ? (maybeAudit as unknown[]).map((x) => x as AuditEntry) : [];
				const auditToByGroupNorm = new Map<string, unknown>();
				for (const entry of audit) {
					const changes = Array.isArray(entry?.changes) ? (entry.changes as AuditChange[]) : [];
					for (const c of changes) {
						const { group, norm } = getGroupAndNorm(String(c?.key ?? ""));
						if (!group || !norm) continue;
						auditToByGroupNorm.set(`${group}:${norm}`, c?.to);
					}
				}
				const initial: Record<string, unknown> = {};
				for (const f of finalFields) {
					const fk = canonicalizePrefixedKey(f.key);
					const { group, norm } = getGroupAndNorm(fk);
					const mapKey = group && norm ? `${group}:${norm}` : "";
					const auditTo = mapKey ? auditToByGroupNorm.get(mapKey) : undefined;
					const fallback = mapKey ? bestValueByGroupNorm.get(mapKey) : undefined;
					const val =
						(typeof auditTo !== "undefined" ? auditTo : typeof fallback !== "undefined" ? fallback : undefined) ??
						(f.inputType === "boolean" ? false : "");
					initial[fk] = val;
				}
				setInsuredValues(initial);
			} catch {
				setInsuredFields([]);
				setInsuredValues({});
			}
		} catch {
			setDrawerOpen(false);
			setTimeout(() => setOpenId(null), 250);
		} finally {
			setOpeningId(null);
		}
	}

	async function refreshCurrentClient() {
		if (openId === null) return;
		if (dynamicEditOpen) return;
		if (refreshing) return;
		setRefreshing(true);
		try {
			await openDetails(openId, { silent: true });
		} finally {
			setRefreshing(false);
		}
	}

	// removed legacy core edit; core fields are not editable

	async function saveInsured() {
		if (!detail) return;
		try {
			const canonicalizePrefixedKey = (k: string): string => {
				let out = String(k ?? "").trim();
				if (!out) return "";
				if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
				if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
				return out.toLowerCase();
			};
			// Only submit canonical insured_/contactinfo_ keys (prevents stale camelCase variants from "winning" in the UI)
			const submit: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(insuredValues)) {
				const canon = canonicalizePrefixedKey(k);
				if (!canon) continue;
				if (!(canon.startsWith("insured_") || canon.startsWith("contactinfo_"))) continue;
				submit[canon] = v;
			}
			const res = await fetch(`/api/clients/${detail.id}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ insured: submit }),
			});
			if (!res.ok) throw new Error(await res.text());
			// Optimistically update local detail with merged values and audit metadata
			setDetail((d) => {
				if (!d) return d;
				const base = ((d.extraAttributes as unknown) ?? {}) as Record<string, unknown>;
				const merged: Record<string, unknown> = { ...base, ...submit };
				try {
					const nowIso = new Date().toISOString();
					const changes: Array<{ key: string; from: unknown; to: unknown }> = [];
					for (const [k, v] of Object.entries(submit)) {
						if (typeof k !== "string") continue;
						if (!(k.startsWith("insured_") || k.startsWith("contactinfo_"))) continue;
						const prev = base[k];
						const equal =
							(typeof prev === "object" || typeof v === "object")
								? JSON.stringify(prev) === JSON.stringify(v)
								: prev === v;
						if (!equal) changes.push({ key: k, from: prev, to: v });
					}
					if (changes.length > 0) {
						const auditKey = "_audit" as const;
						const lastEditedKey = "_lastEditedAt" as const;
						const mergedRec = merged as Record<string, unknown>;
						const currentAudit = Array.isArray(mergedRec[auditKey]) ? (mergedRec[auditKey] as unknown[]) : [];
						mergedRec[auditKey] = [...currentAudit, { at: nowIso, changes }] as unknown;
						mergedRec[lastEditedKey] = nowIso as unknown;
					}
				} catch {
					// ignore local audit failure
				}
				return { ...d, extraAttributes: merged };
			});
			toast.success("Details saved");
			setDynamicEditOpen(false);
			setDynamicEditGroup(null);
			// Re-fetch from server so the drawer reflects server-side pruning of legacy key variants.
			// This prevents the UI from continuing to show "old" aliased keys after a save.
			await openDetails(detail.id, { silent: true });
		} catch (err: unknown) {
			const message = (err as { message?: string } | undefined)?.message ?? "Save failed";
			toast.error(message);
		}
	}

	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Client No.</TableHead>
						<TableHead>Name</TableHead>
						<TableHead>Category</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((r) => (
						<TableRow key={r.id}>
							<TableCell className="font-medium">
								<span className={r.isActive ? "text-green-600 dark:text-green-400" : "text-neutral-500 dark:text-neutral-400"}>
									{r.clientNumber}
								</span>
							</TableCell>
							<TableCell>{r.displayName}</TableCell>
							<TableCell className="capitalize">{r.category}</TableCell>
							<TableCell className="text-right">
								<div className="flex justify-end gap-2">
									<Button
										size="sm"
										variant="secondary"
										onClick={() => openDetails(r.id)}
										disabled={openingId === r.id}
										aria-busy={openingId === r.id}
										className="inline-flex items-center gap-2 transition-transform active:scale-95"
									>
										{openingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Info className="h-4 w-4" />}
										{openingId === r.id ? "Opening…" : "Details"}
									</Button>
									<ClientRowActions
										id={r.id}
										isActive={r.isActive}
										showEdit={false}
										onToggle={(next) => {
											setRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, isActive: next } : x)));
										}}
										onDeleted={() => {
											setRows((rows) => rows.filter((x) => x.id !== r.id));
										}}
									/>
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			{openId !== null ? (
				<div className="fixed inset-0 z-50">
					<div
						className={`absolute inset-0 bg-black transition-opacity duration-300 ${drawerOpen ? "opacity-60" : "opacity-0"}`}
						onClick={closeDrawer}
					/>
					<aside
						className={`absolute left-0 top-0 h-full w-[280px] sm:w-[320px] md:w-[380px] bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-300 ease-out will-change-transform ${
							drawerOpen ? "translate-x-0" : "-translate-x-full"
						}`}
					>
						<div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
							<div className="font-semibold">Client Details</div>
							<Button size="iconCompact" variant="ghost" onClick={closeDrawer} aria-label="Close">
								<X className="h-4 w-4" />
							</Button>
						</div>
						<div className="p-3 text-sm">
							{detail ? (
								<div className="space-y-3">
									<div className="rounded-md border border-yellow-300/50 bg-yellow-50 p-2 text-[11px] leading-snug text-yellow-800 dark:border-yellow-700/50 dark:bg-yellow-950/40 dark:text-yellow-300">
										Recent changes in the last 7 days are highlighted in yellow.
									</div>
									<div className="flex items-center justify-between">
										<div className="font-medium">Overview</div>
										<div className="flex items-center gap-2">
											<Button size="sm" variant="outline" onClick={refreshCurrentClient} disabled={refreshing}>
												{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
											</Button>
											<Button size="sm" variant="outline" onClick={openAudit}>
												Log
											</Button>
										</div>
									</div>
									{/* Client-level agent assignment removed (per-policy model). */}
									<div>
										<div className="text-xs text-neutral-500">Client No.</div>
										<div className="font-mono">{detail.clientNumber}</div>
									</div>
									<div>
										<div className="text-xs text-neutral-500">Created</div>
										<div className="font-mono">{formatDDMMYYYY(detail.createdAt)}</div>
									</div>
									{Array.isArray(detail.policies) && detail.policies.length > 0 ? (
										<div className="space-y-1">
											<button
												type="button"
												onClick={() => setPoliciesCollapsed((v) => !v)}
												aria-expanded={!policiesCollapsed}
												aria-controls="client-policies-list"
												className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-xs text-neutral-500 transition-colors hover:text-green-700 dark:hover:text-green-300"
											>
												<span>Policies</span>
												<ChevronDown
													className={`h-3 w-3 transition-transform ${policiesCollapsed ? "-rotate-90" : "rotate-0"}`}
												/>
											</button>
											{!policiesCollapsed && (
												<div id="client-policies-list" className="flex flex-col gap-2">
													{detail.policies.map((p) => (
														<button
															key={p.id}
															type="button"
															onClick={() => openPolicyDetails(p.id)}
															className="inline-flex items-center rounded border border-neutral-300 px-2 py-0.5 text-xs font-mono transition-colors hover:border-green-500 hover:bg-green-50 hover:text-green-700 dark:border-neutral-700 dark:hover:border-green-500 dark:hover:bg-green-900/30 dark:hover:text-green-300"
														>
															{policyOpeningId === p.id ? "Opening…" : p.policyNumber}
														</button>
													))}
												</div>
											)}
										</div>
									) : (
										<div className="text-xs text-neutral-500">No related policies</div>
									)}
									{/* Match Policy Details layout: Insured and Contact Information */}
									{(() => {
										// Build read-only pairs from dynamic fields preserving configured order
										const base: Record<string, unknown> =
											(typeof detail.extraAttributes === "object" && detail.extraAttributes) ? (detail.extraAttributes as Record<string, unknown>) : {};
										const clientCategory = String((detail as unknown as { category?: unknown })?.category ?? "")
											.trim()
											.toLowerCase();
										const canonicalizePrefixedKey = (k: string): string => {
											let out = String(k ?? "").trim();
											if (!out) return "";
											// Normalize "insured" / "contactinfo" prefixes even when missing underscore
											// e.g. "contactinfoTel" -> "contactinfo_Tel" (later lowercased)
											if (/^insured(?![_])/i.test(out)) out = `insured_${out.slice("insured".length)}`;
											if (/^contactinfo(?![_])/i.test(out)) out = `contactinfo_${out.slice("contactinfo".length)}`;
											if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
											if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
											return out.toLowerCase();
										};
										const normalizeBaseToken = (k: string): string =>
											String(k ?? "")
												.replace(/^(insured|contactinfo)__?/i, "")
												.toLowerCase()
												.replace(/[^a-z0-9]/g, "");
										const getGroupAndNorm = (k: string): { group: "insured" | "contactinfo" | null; norm: string } => {
											const canon = canonicalizePrefixedKey(k);
											const group = canon.startsWith("insured_")
												? "insured"
												: canon.startsWith("contactinfo_")
													? "contactinfo"
													: null;
											return { group, norm: normalizeBaseToken(canon) };
										};
										// helper: display values with label mapping; preserve original order
										const displayFor = (
											field: { inputType: string; options?: Array<{ value: string; label: string }> },
											value: unknown
										) => {
											const hasOptions = Array.isArray(field.options) && field.options.length > 0;
											const toTitle = (s: string) =>
												s
													.replace(/[_\-]+/g, " ")
													.trim()
													.toLowerCase()
													.replace(/\b\w/g, (c) => c.toUpperCase());
											// boolean
											if (field.inputType === "boolean") {
												return value === true || value === "true"
													? "Yes"
													: value === false || value === "false"
													? "No"
													: "";
											}
											// numbers
											if (field.inputType === "number") return String(value ?? "");
											// multi (array) → map each item to label if options exist
											if ((field.inputType === "multi_select" || Array.isArray(value)) && Array.isArray(value)) {
												const vals = (value as unknown[]).map((v) => String(v ?? ""));
												return vals
													.map((v) => (hasOptions ? (field.options?.find((o) => o.value === v)?.label ?? v) : v))
													.filter(Boolean)
													.join(", ");
											}
											// single select or string with options → map to label
											if (field.inputType === "select" || hasOptions) {
												const sv = String(value ?? "");
												const label = hasOptions ? field.options?.find((o) => o.value === sv)?.label ?? sv : sv;
												return label;
											}
											// default string → title-case common tokens
											const raw = String(value ?? "");
											const canon = raw.trim().toLowerCase();
											if (canon === "company") return "Company";
											if (canon === "personal") return "Personal";
											if (["mr", "mrs", "ms", "miss", "dr"].includes(canon)) return toTitle(canon);
											if (["hki", "hk", "hong kong island"].includes(canon)) return "Hong Kong Island";
											if (["kln", "kowloon"].includes(canon)) return "Kowloon";
											if (["nt", "new territories", "new territory"].includes(canon)) return "New Territories";
											return toTitle(raw);
										};
										const isEmptyValue = (v: unknown): boolean => {
											if (v === null || typeof v === "undefined") return true;
											if (typeof v === "string" && v.trim() === "") return true;
											if (Array.isArray(v) && v.length === 0) return true;
											return false;
										};
										// Pretty label formatter (keeps config order; only changes the text shown)
										const prettifyLabel = (rawLabel: string, key: string) => {
											return formatContactLabel(rawLabel, key);
										};
										type Pair = { key: string; label: string; value: string };
										// Split dynamic fields into insured/contact groups preserving their original order
										// Use state list we stored in admin order, then split by prefix for sections
										const ordered = insuredFields as Array<{
											key: string;
											label: string;
											inputType: string;
											options?: Array<{ value: string; label: string }>;
											categories?: string[];
										}>;
										const visibleByCategory = (f: { categories?: string[] }) => {
											const cats = Array.isArray(f.categories) ? f.categories : [];
											if (!clientCategory) return true;
											// If no explicit categories are configured, apply a safe heuristic so we don't
											// show personal-only identity fields for company clients (and vice versa).
											const keyToken = String((f as any)?.key ?? "")
												.replace(/^(insured|contactinfo)__?/i, "")
												.toLowerCase()
												.replace(/[^a-z0-9]/g, "");
											const personalOnly = new Set(["firstname", "lastname", "fullname", "idnumber", "hkid", "dob", "dateofbirth"]);
											const companyOnly = new Set(["companyname", "brnumber", "cinumber", "businessregistration", "businessregno"]);
											if (cats.length === 0) {
												if (clientCategory === "company" && personalOnly.has(keyToken)) return false;
												if (clientCategory === "personal" && companyOnly.has(keyToken)) return false;
												return true;
											}
											return cats.includes(clientCategory);
										};
										const orderedVisible = ordered.filter(visibleByCategory);
										// Build index map to preserve admin order for fallback
										const indexByKey = new Map(orderedVisible.map((f, i) => [f.key, i] as const));
										// Insured priority ordering: Category > Company Name > CI Number > BR Number
										const insuredPriority: Record<string, number> = {
											category: 10,
											companyname: 20,
											cinumber: 30,
											brnumber: 40,
										};
										const baseKey = (k: string) =>
											k.replace(/^(insured|contactinfo)__?/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
										const insuredOrdered = orderedVisible
											.filter((f) => f.key.startsWith("insured_"))
											.slice()
											.sort((a, b) => {
												const wa = insuredPriority[baseKey(a.key)] ?? 10000 + (indexByKey.get(a.key) ?? 0);
												const wb = insuredPriority[baseKey(b.key)] ?? 10000 + (indexByKey.get(b.key) ?? 0);
												return wa - wb;
											});
										let contactOrdered = orderedVisible.filter((f) => f.key.startsWith("contactinfo_"));
										contactOrdered = contactOrdered.slice().sort((a, b) => {
											const wa = getContactSortWeight(a.key);
											const wb = getContactSortWeight(b.key);
											if (wa !== wb) return wa - wb;
											return 0;
										});

										// Lookup value from extraAttributes using key variants to avoid missing data
										const pickValue = (obj: Record<string, unknown>, baseKey: string): unknown => {
											const candidates = [
												baseKey,
												`insured_${baseKey}`,
												`insured__${baseKey}`,
												`contactinfo_${baseKey}`,
												`contactinfo__${baseKey}`,
											];
											for (const k of candidates) {
												if (Object.prototype.hasOwnProperty.call(obj, k)) {
													const v = obj[k];
													if (!(v === null || typeof v === "undefined" || String(v).trim() === "")) return v;
												}
											}
											return undefined;
										};

										// Build last-changed map (key -> last edited at) from audit
										const maybeAuditFromBase = (base as Record<string, unknown>)["_audit" as const] as unknown;
										const audit: AuditEntry[] = Array.isArray(maybeAuditFromBase)
											? (maybeAuditFromBase as unknown[]).map((x) => x as AuditEntry)
											: [];
										// Build "best current value" map by *normalized* base key so we don't end up with
										// two parallel keys (companyName vs company_name vs companyname).
										// This is the main reason you see "two data": different writers used different key shapes.
										const bestValueByGroupNorm = new Map<string, unknown>();
										const scoreKeyShape = (rawKey: string): number => {
											const canon = canonicalizePrefixedKey(rawKey);
											if (!canon) return 0;
											const lower = rawKey === rawKey.toLowerCase() ? 10 : 0;
											const single = rawKey.startsWith("insured_") || rawKey.startsWith("contactinfo_") ? 6 : 0;
											const dbl = rawKey.startsWith("insured__") || rawKey.startsWith("contactinfo__") ? -2 : 0;
											const rest = canon.replace(/^(insured|contactinfo)_/i, "");
											const snake = /_/.test(rest) ? 1 : 0;
											return lower + single + dbl + snake;
										};
										const bestScoreByGroupNorm = new Map<string, number>();
										for (const k of Object.keys(base)) {
											const { group, norm } = getGroupAndNorm(k);
											if (!group || !norm) continue;
											const mapKey = `${group}:${norm}`;
											const score = scoreKeyShape(k);
											const prevScore = bestScoreByGroupNorm.get(mapKey);
											if (typeof prevScore === "undefined" || score > prevScore) {
												bestScoreByGroupNorm.set(mapKey, score);
												bestValueByGroupNorm.set(mapKey, base[k]);
											}
										}
										// Now apply audit "to" values as the most recent truth for that normalized key.
										// This makes the left panel consistent with the Change Log even when older writers used different key spellings.
										// IMPORTANT: We intentionally use append-order (last change wins), not timestamps.
										// Timestamps can be missing/invalid from legacy data, and we never want the left panel
										// to disagree with the log just because of a parse edge-case.
										const auditToByGroupNorm = new Map<string, unknown>();
										for (const entry of audit) {
											const changes = Array.isArray(entry?.changes) ? (entry.changes as AuditChange[]) : [];
											for (const c of changes) {
												const { group, norm } = getGroupAndNorm(String(c?.key ?? ""));
												if (!group || !norm) continue;
												const mapKey = `${group}:${norm}`;
												// last one wins
												auditToByGroupNorm.set(mapKey, c?.to);
											}
										}
										const lastChangedAtByKey: Record<string, string> = {};
										for (const entry of audit) {
											const at = String((entry?.at as unknown) ?? "");
											const changes = Array.isArray(entry?.changes) ? (entry.changes as Array<{ key: string }>) : [];
											for (const c of changes) {
												const k = String(c?.key ?? "");
												if (!k) continue;
												// keep the most recent timestamp
												if (!lastChangedAtByKey[k] || new Date(at).getTime() > new Date(lastChangedAtByKey[k]).getTime()) {
													lastChangedAtByKey[k] = at;
												}
											}
										}

										const toPairs = (list: Array<{ key: string; label: string; inputType: string; options?: Array<{ value: string; label: string }> }>): Pair[] => {
											const pairs: Pair[] = [];
											for (const f of list) {
												const { group, norm } = getGroupAndNorm(f.key);
												if (!group || !norm) continue;
												const mapKey = `${group}:${norm}`;
												const auditTo = auditToByGroupNorm.get(mapKey);
												const raw = typeof auditTo !== "undefined" ? auditTo : bestValueByGroupNorm.get(mapKey);
												// Hide fields that are empty/null (when a value is cleared it should disappear).
												if (isEmptyValue(raw)) continue;
												const label = prettifyLabel(f.label || f.key, f.key);
												const val = displayFor(f, raw);
												const shown = String(val ?? "").trim();
												if (!shown) continue;
												pairs.push({ key: f.key, label, value: shown });
											}
											return pairs;
										};

										const insuredPairs: Pair[] = toPairs(insuredOrdered);
										const contactPairs: Pair[] = toPairs(contactOrdered);
										// Deduplicate across both groups by normalized base key (remove prefix + non-alphanumeric)
										const normalizeBase = (key: string) =>
											key.replace(/^(insured|contactinfo)__?/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
										const seen = new Set<string>();
										const dedupe = (pairs: Pair[]) => {
											const out: Pair[] = [];
											for (const p of pairs) {
												const norm = normalizeBase(p.key);
												if (seen.has(norm)) continue;
												seen.add(norm);
												out.push(p);
											}
											return out;
										};
										const insuredPairsDeduped = dedupe(insuredPairs);
										const contactPairsDeduped = dedupe(contactPairs);
										// render helpers
										const Row = ({ p }: { p: Pair }) => (
											<div className="flex items-start justify-between gap-3 text-xs">
												<div className="text-neutral-500">{p.label}</div>
												<RecentHighlight since={lastChangedAtByKey[p.key]} windowDays={7} className="max-w-[60%] wrap-break-word font-mono">
													{p.value}
												</RecentHighlight>
											</div>
										);
										return (
											<React.Fragment>
												{insuredPairsDeduped.length > 0 ? (
													<div className="space-y-2">
														<div className="flex items-center justify-between">
															<div className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Insured</div>
															<Button
																size="sm"
																variant="secondary"
																onClick={() => {
																	setDynamicEditGroup("insured");
																	setDynamicEditOpen(true);
																}}
															>
																Edit
															</Button>
														</div>
														<div className="space-y-1">
															{insuredPairsDeduped.map((p, i) => (
																<Row key={`ins-${i}-${p.label}`} p={p} />
															))}
														</div>
													</div>
												) : null}
												{contactPairsDeduped.length > 0 ? (
													<div className="space-y-2">
														<div className="flex items-center justify-between">
															<div className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Contact Information</div>
															<Button
																size="sm"
																variant="secondary"
																onClick={() => {
																	setDynamicEditGroup("contactinfo");
																	setDynamicEditOpen(true);
																}}
															>
																Edit
															</Button>
														</div>
														<div className="space-y-1">
															{contactPairsDeduped.map((p, i) => (
																<Row key={`con-${i}-${p.label}`} p={p} />
															))}
														</div>
													</div>
												) : null}
											</React.Fragment>
										);
									})()}
								</div>
							) : (
								<div className="text-neutral-500">Loading...</div>
							)}
						</div>
					</aside>
				</div>
			) : null}

			{/* Audit Log slide-over (right side) */}
			{auditOpen ? (
				<div className="fixed inset-0 z-60 pointer-events-none">
					{/* Transparent click-catcher to close (no lightbox) */}
					<div
						className="pointer-events-auto absolute inset-0"
						onClick={closeAudit}
						aria-label="Close change log"
					/>
					<aside
						className={`pointer-events-auto absolute right-0 top-0 h-full w-[300px] sm:w-[360px] md:w-[420px] bg-white dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-400 ease-in-out will-change-transform ${
							auditDrawerOpen ? "translate-x-0" : "translate-x-full"
						}`}
					>
						<div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
							<div className="font-semibold">Change Log</div>
							<Button size="iconCompact" variant="ghost" onClick={closeAudit} aria-label="Close">
								<X className="h-4 w-4" />
							</Button>
						</div>
						<div className="p-3 text-xs">
							{(() => {
								if (!detail) return <div className="text-neutral-500">No details.</div>;
								const extra = (detail.extraAttributes as unknown) as Record<string, unknown> | null;
								const maybeAudit = (extra ?? undefined)?.["_audit" as const] as unknown;
								const audit: AuditEntry[] = Array.isArray(maybeAudit)
									? (maybeAudit as unknown[]).map((x) => x as AuditEntry)
									: [];
								const isEmpty = (v: unknown): boolean =>
									v === null ||
									typeof v === "undefined" ||
									(typeof v === "string" && v.trim() === "") ||
									(Array.isArray(v) && v.length === 0);
								const canonicalizePrefixedKey = (k: string): string => {
									let out = String(k ?? "").trim();
									if (!out) return "";
									if (/^insured(?![_])/i.test(out)) out = `insured_${out.slice("insured".length)}`;
									if (/^contactinfo(?![_])/i.test(out)) out = `contactinfo_${out.slice("contactinfo".length)}`;
									if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
									if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
									return out.toLowerCase();
								};
								const normalizeBaseToken = (k: string): string =>
									String(k ?? "")
										.replace(/^(insured|contactinfo)__?/i, "")
										.toLowerCase()
										.replace(/[^a-z0-9]/g, "");
								const getGroupAndNorm = (k: string): { group: "insured" | "contactinfo" | null; norm: string } => {
									const canon = canonicalizePrefixedKey(k);
									const group = canon.startsWith("insured_") ? "insured" : canon.startsWith("contactinfo_") ? "contactinfo" : null;
									return { group, norm: normalizeBaseToken(canon) };
								};
								const fieldByGroupNorm = new Map<
									string,
									{ key: string; label: string; inputType: string; options?: Array<{ value: string; label: string }> }
								>();
								for (const f of (insuredFields ?? []) as Array<{
									key: string;
									label: string;
									inputType: string;
									options?: Array<{ value: string; label: string }>;
								}>) {
									const { group, norm } = getGroupAndNorm(f.key);
									if (!group || !norm) continue;
									const mapKey = `${group}:${norm}`;
									if (!fieldByGroupNorm.has(mapKey)) {
										fieldByGroupNorm.set(mapKey, {
											key: f.key,
											label: formatContactLabel(f.label || f.key, f.key),
											inputType: f.inputType,
											options: f.options,
										});
									}
								}
								const toDisplay = (field: { inputType: string; options?: Array<{ value: string; label: string }> } | null, v: unknown) => {
									if (isEmpty(v)) return "";
									if (!field) return String(v ?? "");
									const opts = Array.isArray(field.options) ? field.options : [];
									if (field.inputType === "boolean") {
										return v === true || v === "true" ? "Yes" : v === false || v === "false" ? "No" : "";
									}
									if (field.inputType === "select") {
										const sv = String(v ?? "");
										return opts.find((o) => o.value === sv)?.label ?? sv;
									}
									if (field.inputType === "multi_select") {
										const arr = Array.isArray(v)
											? (v as unknown[]).map((x) => String(x ?? ""))
											: String(v ?? "")
													.split(",")
													.map((s) => s.trim())
													.filter(Boolean);
										return arr.map((x) => opts.find((o) => o.value === x)?.label ?? x).filter(Boolean).join(", ");
									}
									return typeof v === "object"
										? (() => {
												try {
													return JSON.stringify(v);
												} catch {
													return String(v);
												}
										  })()
										: String(v ?? "");
								};
								const isMeaningfulChange = (from: unknown, to: unknown): boolean => {
									// Treat empty/null/undefined as the same "empty" so we don't log noise
									if (isEmpty(from) && isEmpty(to)) return false;
									// Compare primitives directly
									if (typeof from !== "object" && typeof to !== "object") return String(from ?? "") !== String(to ?? "");
									// Fallback for objects/arrays
									try {
										return JSON.stringify(from) !== JSON.stringify(to);
									} catch {
										return String(from ?? "") !== String(to ?? "");
									}
								};
								const entries = audit
									.filter((e): e is Required<AuditEntry> => Array.isArray(e?.changes) && (e.changes?.length ?? 0) > 0)
									.reverse();
								if (entries.length === 0) return <div className="text-neutral-500">No changes recorded.</div>;
								return (
									<div className="space-y-3">
										{entries.map((e, idx) => {
											const at = String((e?.at as unknown) ?? "");
											const when = (() => {
												const d = new Date(at);
												if (Number.isNaN(d.getTime())) return at || "-";
												const dd = String(d.getDate()).padStart(2, "0");
												const mm = String(d.getMonth() + 1).padStart(2, "0");
												const yyyy = d.getFullYear();
												const hh = String(d.getHours()).padStart(2, "0");
												const min = String(d.getMinutes()).padStart(2, "0");
												return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
											})();
											const by = (e.by ?? {}) as { id?: number | string; email?: string };
											const who = by.email || by.id || "Unknown";
											const chRaw = Array.isArray(e?.changes) ? (e.changes as Array<{ key: string; from: unknown; to: unknown }>) : [];
											// Only show fields that actually changed (avoid spam like "null → null")
											const ch = chRaw.filter((c) => isMeaningfulChange(c?.from, c?.to));
											// De-dupe changes that refer to the same "meaning" (group + normalized token).
											// This prevents duplicates like `Tel` showing twice when both canonical and legacy key variants
											// are updated in the same audit entry (e.g. `contactinfo_tel` and `contactinfo__tel`).
											const chDedup = (() => {
												const map = new Map<string, AuditChange>();
												for (const c of ch) {
													const rawKey = String(c?.key ?? "");
													const { group, norm } = getGroupAndNorm(rawKey);
													const mapKey = group && norm ? `${group}:${norm}` : rawKey;
													// keep last occurrence (last-write-wins) while also moving it to the end
													if (map.has(mapKey)) map.delete(mapKey);
													map.set(mapKey, c as AuditChange);
												}
												return Array.from(map.values());
											})();
											return (
												<div key={`audit-${idx}`} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
													<div className="mb-1 flex items-center justify-between">
														<div className="font-medium">{when}</div>
														<div className="text-neutral-500">{who}</div>
													</div>
													<div className="grid grid-cols-1 gap-1">
														{chDedup.length === 0 ? (
															<div className="text-neutral-500">No field changes listed.</div>
														) : (
															chDedup.map((c, i) => {
																const { group, norm } = getGroupAndNorm(String(c.key ?? ""));
																const mapKey = group && norm ? `${group}:${norm}` : "";
																const field = mapKey ? fieldByGroupNorm.get(mapKey) ?? null : null;
																const label = field?.label ?? formatContactLabel(String(c.key), String(c.key));
																const fromVal = toDisplay(field, c.from);
																const toVal = toDisplay(field, c.to) || (isEmpty(c.to) ? "(cleared)" : "");
																return (
																	<div key={`chg-${idx}-${i}`} className="flex items-start justify-between gap-3">
																		<div className="text-neutral-500">{label}</div>
																		<div className="max-w-[65%] text-right font-mono">
																			{fromVal ? <span className="line-through opacity-70">{fromVal}</span> : null}
																			{fromVal ? " → " : ""}
																			<span>{toVal}</span>
																		</div>
																	</div>
																);
															})
														)}
													</div>
												</div>
											);
										})}
									</div>
								);
							})()}
						</div>
					</aside>
				</div>
			) : null}

			{/* Policy Details slide-over (right side) */}
			{policyOpen ? (
				<div className="fixed inset-0 z-60 pointer-events-none">
					{/* Click-catcher to close only policy drawer; client drawer remains visible */}
					<div className="pointer-events-auto absolute inset-0" onClick={closePolicyDetails} aria-label="Close policy details" />
					<aside
						className={`pointer-events-auto absolute right-0 top-0 h-full w-[300px] sm:w-[360px] md:w-[420px] bg-white dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-300 ease-out will-change-transform ${
							policyDrawerOpen ? "translate-x-0" : "translate-x-full"
						}`}
					>
						<div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
							<div className="font-semibold">Policy Details</div>
							<Button size="iconCompact" variant="ghost" onClick={closePolicyDetails} aria-label="Close">
								<X className="h-4 w-4" />
							</Button>
						</div>
						<div className="overflow-y-auto p-3 text-sm" style={{ maxHeight: "calc(100vh - 52px)" }}>
							{policyDetail ? (
								<PolicySnapshotView detail={policyDetail} />
							) : (
								<div className="text-neutral-500">Loading...</div>
							)}
						</div>
					</aside>
				</div>
			) : null}
			{/* Core edit removed: core fields are not editable */}
			{/* Dynamic Edit dialog for Insured / Contact Information */}
			<Dialog
				open={dynamicEditOpen}
				onOpenChange={(o) => {
					setDynamicEditOpen(o);
					if (!o) setDynamicEditGroup(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{dynamicEditGroup === "contactinfo"
								? "Edit Contact Information"
								: dynamicEditGroup === "insured"
								? "Edit Insured"
								: "Edit Details"}
						</DialogTitle>
					</DialogHeader>
					<div className="grid gap-3">
						{(() => {
							const list =
								(dynamicEditGroup
									? insuredFields.filter((f) => f.key.startsWith(`${dynamicEditGroup}_`))
									: insuredFields) ?? [];
							const clientCategory = String((detail as unknown as { category?: unknown })?.category ?? "")
								.trim()
								.toLowerCase();
							const listFiltered = list.filter((f) => {
								const cats = Array.isArray((f as unknown as { categories?: unknown })?.categories)
									? ((f as unknown as { categories?: unknown }).categories as unknown[]).map((c) => String(c ?? "").toLowerCase())
									: [];
								if (!clientCategory) return true;
								const keyToken = String((f as any)?.key ?? "")
									.replace(/^(insured|contactinfo)__?/i, "")
									.toLowerCase()
									.replace(/[^a-z0-9]/g, "");
								const personalOnly = new Set(["firstname", "lastname", "fullname", "idnumber", "hkid", "dob", "dateofbirth"]);
								const companyOnly = new Set(["companyname", "brnumber", "cinumber", "businessregistration", "businessregno"]);
								if (cats.length === 0) {
									if (clientCategory === "company" && personalOnly.has(keyToken)) return false;
									if (clientCategory === "personal" && companyOnly.has(keyToken)) return false;
									return true;
								}
								return cats.includes(clientCategory);
							});
							// Apply ordering rules to match display:
							// - contactinfo_* uses getContactSortWeight (canonical order)
							// - insured_* uses insuredPriority, then admin-configured order as fallback
							const indexByKey = new Map(insuredFields.map((f, i) => [f.key, i] as const));
							const insuredPriority: Record<string, number> = {
								category: 10,
								companyname: 20,
								cinumber: 30,
								brnumber: 40,
							};
							const baseKey = (k: string) =>
								k.replace(/^(insured|contactinfo)__?/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
							const listSorted =
								dynamicEditGroup === "contactinfo"
									? [...listFiltered].sort((a, b) => getContactSortWeight(a.key) - getContactSortWeight(b.key))
									: dynamicEditGroup === "insured"
									? [...listFiltered].sort((a, b) => {
											const wa = insuredPriority[baseKey(a.key)] ?? 10000 + (indexByKey.get(a.key) ?? 0);
											const wb = insuredPriority[baseKey(b.key)] ?? 10000 + (indexByKey.get(b.key) ?? 0);
											return wa - wb;
									  })
									: listFiltered;
							if (!detail || listFiltered.length === 0) {
								return <div className="text-neutral-500">No fields to edit.</div>;
							}
							return (
								<div className="space-y-3">
									{listSorted.map((f) => {
										const label = formatContactLabel(f.label || f.key, f.key);
										const value = insuredValues[f.key];
										// Render by type
										if (f.inputType === "boolean") {
											const checked = value === true || value === "true";
											return (
												<label key={f.key} className="flex items-center justify-between gap-3 text-sm">
													<span className="text-neutral-600 dark:text-neutral-300">{label}</span>
													<Checkbox
														checked={checked}
														onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
															setInsuredValues((s) => ({ ...s, [f.key]: Boolean(e.target.checked) }));
														}}
													/>
												</label>
											);
										}
										if (f.inputType === "number") {
											return (
												<div key={f.key}>
													<label className="text-sm text-neutral-600 dark:text-neutral-300">{label}</label>
													<Input
														type="number"
														value={String(value ?? "")}
														onChange={(e) => {
															const raw = e.target.value;
															setInsuredValues((s) => ({ ...s, [f.key]: raw === "" ? "" : Number(raw) }));
														}}
													/>
												</div>
											);
										}
										if (f.inputType === "multi_select") {
											const opts = Array.isArray(f.options) ? f.options : [];
											const current = Array.isArray(value) ? (value as string[]) : String(value ?? "")
												.split(",")
												.map((s) => s.trim())
												.filter(Boolean);
											return (
												<div key={f.key}>
													<label className="text-sm text-neutral-600 dark:text-neutral-300">{label}</label>
													<select
														multiple
														className="mt-1 w-full rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
														value={current}
														onChange={(e) => {
															const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
															setInsuredValues((s) => ({ ...s, [f.key]: selected }));
														}}
													>
														{opts.map((o) => (
															<option key={o.value} value={o.value}>
																{o.label}
															</option>
														))}
													</select>
												</div>
											);
										}
										if (f.inputType === "select" && Array.isArray(f.options)) {
											const opts = f.options;
											return (
												<div key={f.key}>
													<label className="text-sm text-neutral-600 dark:text-neutral-300">{label}</label>
													<select
														className="mt-1 w-full rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
														value={String(value ?? "")}
														onChange={(e) => setInsuredValues((s) => ({ ...s, [f.key]: e.target.value }))}
													>
														<option value="" />
														{opts.map((o) => (
															<option key={o.value} value={o.value}>
																{o.label}
															</option>
														))}
													</select>
												</div>
											);
										}
										// default text
										return (
											<div key={f.key}>
												<label className="text-sm text-neutral-600 dark:text-neutral-300">{label}</label>
												<Input
													value={String(value ?? "")}
													onChange={(e) => setInsuredValues((s) => ({ ...s, [f.key]: e.target.value }))}
												/>
											</div>
										);
									})}
								</div>
							);
						})()}
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={() => setDynamicEditOpen(false)}>
								Cancel
							</Button>
							<Button onClick={saveInsured}>Save</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>

			{/* Create Client dialog removed — redirect to /policies/new instead */}
		</div>
	);
}

