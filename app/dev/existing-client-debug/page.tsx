"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";

type ClientListRow = {
  id: number;
  clientNumber: string;
  category: string;
  displayName: string;
  primaryId?: string;
  contactPhone?: string | null;
  createdAt?: string;
};

type ClientDetail = ClientListRow & {
  extraAttributes?: Record<string, unknown> | null;
  policies?: Array<{ id: number; policyNumber: string }>;
};

type InsuredFieldOpt = {
  label?: unknown;
  value?: unknown;
  meta?: unknown;
  sortOrder?: unknown;
};

function canonicalizeKey(k: string): string {
  let out = String(k ?? "").trim();
  if (!out) return "";
  if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
  if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
  return out.toLowerCase();
}

function meaningToken(k: string): string {
  return canonicalizeKey(k)
    .replace(/^(insured|contactinfo)_/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function groupOfCanonicalKey(ck: string): "insured" | "contactinfo" | null {
  return ck.startsWith("insured_") ? "insured" : ck.startsWith("contactinfo_") ? "contactinfo" : null;
}

export default function ExistingClientDebugPage() {
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<ClientListRow[]>([]);
  const [q, setQ] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [selectedListRow, setSelectedListRow] = React.useState<ClientListRow | null>(null);
  const [detail, setDetail] = React.useState<ClientDetail | null>(null);
  const [insuredFields, setInsuredFields] = React.useState<Array<{ label: string; value: string }>>([]);
  const [error, setError] = React.useState<string | null>(null);

  const loadListAndConfig = React.useCallback(async () => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [clientsRes, insuredRes] = await Promise.all([
          fetch("/api/clients", { cache: "no-store" }),
          fetch("/api/form-options?groupKey=insured_fields&includeInactive=true", { cache: "no-store" }),
        ]);
        if (!clientsRes.ok) throw new Error(await clientsRes.text());
        const clientsRaw = await clientsRes.json();
        const clientsJson: any[] = Array.isArray(clientsRaw)
          ? clientsRaw
          : Array.isArray(clientsRaw?.rows)
            ? clientsRaw.rows
            : [];
        const list = clientsJson.map((r) => ({
          id: Number(r?.id ?? 0),
          clientNumber: String(r?.clientNumber ?? ""),
          category: String(r?.category ?? ""),
          displayName: String(r?.displayName ?? ""),
          primaryId: typeof r?.primaryId === "string" ? r.primaryId : undefined,
          contactPhone: typeof r?.contactPhone === "string" ? r.contactPhone : (r?.contactPhone ?? null),
          createdAt: typeof r?.createdAt === "string" ? r.createdAt : undefined,
        })).filter((r) => Number.isFinite(r.id) && r.id > 0);

        const insuredJson = insuredRes.ok ? ((await insuredRes.json()) as InsuredFieldOpt[]) : [];
        const insuredMapped = (Array.isArray(insuredJson) ? insuredJson : [])
          .map((o) => ({
            label: String(o?.label ?? ""),
            value: String(o?.value ?? "").trim(),
          }))
          .filter((o) => o.value.length > 0);

        if (!cancelled) {
          setRows(list);
          setInsuredFields(insuredMapped);
          // keep selected list row in sync after refresh
          if (selectedId) {
            setSelectedListRow(list.find((r) => r.id === selectedId) ?? null);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e ?? "Failed to load"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  React.useEffect(() => {
    void loadListAndConfig();
  }, [loadListAndConfig]);

  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((r) => `${r.clientNumber} ${r.displayName} ${r.category}`.toLowerCase().includes(qq));
  }, [q, rows]);

  async function selectClient(id: number) {
    setSelectedId(id);
    setDetail(null);
    setError(null);
    setSelectedListRow(rows.find((r) => r.id === id) ?? null);
    try {
      const res = await fetch(`/api/clients/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as ClientDetail;
      setDetail(json);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "Failed to load client detail"));
    }
  }

  const resolved = React.useMemo(() => {
    const extra = (detail?.extraAttributes ?? null) as Record<string, unknown> | null;
    const canonicalDyn: Record<string, unknown> = {};
    if (extra && typeof extra === "object") {
      for (const [k, v] of Object.entries(extra)) {
        const ck = canonicalizeKey(k);
        if (!ck) continue;
        if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
        if (typeof canonicalDyn[ck] === "undefined" || k === ck) canonicalDyn[ck] = v;
      }
    }
    const canonicalByGroupToken = new Map<string, unknown>();
    for (const [ck, v] of Object.entries(canonicalDyn)) {
      const g = groupOfCanonicalKey(ck);
      if (!g) continue;
      const token = meaningToken(ck);
      if (!token) continue;
      canonicalByGroupToken.set(`${g}:${token}`, v);
    }
    const insuredPicked = insuredFields.map((f) => {
      const key = f.value;
      const group: "insured" | "contactinfo" =
        key.toLowerCase().startsWith("contactinfo_") || key.toLowerCase().startsWith("contactinfo__")
          ? "contactinfo"
          : "insured";
      const token = meaningToken(key);
      const mapKey = `${group}:${token}`;
      return {
        configuredKey: key,
        label: f.label || key,
        token,
        canonicalKey: `${group}_${token}`,
        value: canonicalByGroupToken.get(mapKey),
      };
    });
    return { canonicalDyn, canonicalByGroupToken, insuredPicked };
  }, [detail?.extraAttributes, insuredFields]);

  return (
    <div className="p-3 space-y-5 sm:p-6">
      <div className="space-y-1">
        <div className="text-xl font-semibold">Existing Client Debug Picker</div>
        <div className="text-sm text-neutral-500">
          Compares <code>/api/clients</code> vs <code>/api/clients/:id</code> and shows what Step 2 would fill for insured fields.
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-medium">Client list (<code>/api/clients</code>)</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-8 rounded px-2 text-sm border border-neutral-300 dark:border-neutral-700"
                onClick={() => void loadListAndConfig()}
                disabled={loading}
              >
                {loading ? "Refreshing…" : "Refresh list"}
              </button>
              <div className="text-xs text-neutral-500">{loading ? "" : `${rows.length} rows`}</div>
            </div>
          </div>
          <input
            className="mb-2 h-9 w-full rounded border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Search by client no, name, category…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-[55vh] overflow-auto space-y-2">
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => void selectClient(r.id)}
                className={`w-full rounded border px-2 py-2 text-left transition-colors ${
                  selectedId === r.id
                    ? "border-green-500 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200"
                    : "border-neutral-200 hover:border-green-500 hover:bg-green-50 dark:border-neutral-800 dark:hover:bg-green-900/20"
                }`}
              >
                <div className="text-xs font-mono text-neutral-500">{r.clientNumber}</div>
                <div className="text-sm font-medium">{r.displayName || <span className="text-neutral-400">(empty)</span>}</div>
                <div className="text-xs text-neutral-500 capitalize">{r.category}</div>
              </button>
            ))}
            {filtered.length === 0 ? <div className="text-sm text-neutral-500">No clients.</div> : null}
          </div>
        </div>

        <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-medium">Selected client detail (<code>/api/clients/:id</code>)</div>
            <button
              type="button"
              className="h-8 rounded px-2 text-sm border border-neutral-300 dark:border-neutral-700"
              disabled={!selectedId}
              onClick={() => (selectedId ? void selectClient(selectedId) : undefined)}
            >
              Refresh
            </button>
          </div>

          {!selectedId ? (
            <div className="text-sm text-neutral-500">Pick a client from the list.</div>
          ) : !detail ? (
            <div className="text-sm text-neutral-500">Loading…</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-neutral-500">List displayName</div>
                  <div className="font-mono text-xs">{selectedListRow?.displayName ?? "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Detail displayName</div>
                  <div className="font-mono text-xs">{detail.displayName ?? "-"}</div>
                </div>
              </div>

              <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
                <div className="text-xs font-medium mb-1">Canonical dynamic keys (resolved)</div>
                <div className="max-h-40 overflow-auto text-xs font-mono whitespace-pre">
                  {JSON.stringify(resolved.canonicalDyn, null, 2)}
                </div>
              </div>

              <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
                <div className="text-xs font-medium mb-2">Insured fields pick result (what Step 2 should fill)</div>
                <div className="space-y-1">
                  {resolved.insuredPicked.map((p) => (
                    <div key={p.configuredKey} className="flex items-start justify-between gap-3 text-xs">
                      <div className="text-neutral-600 dark:text-neutral-300">
                        <div className="font-medium">{p.label}</div>
                        <div className="font-mono text-[11px] text-neutral-500">{p.configuredKey}</div>
                      </div>
                      <div className="max-w-[55%] text-right font-mono">
                        {typeof p.value === "undefined" ? (
                          <span className="text-neutral-400">(missing)</span>
                        ) : (
                          String(p.value)
                        )}
                      </div>
                    </div>
                  ))}
                  {resolved.insuredPicked.length === 0 ? (
                    <div className="text-xs text-neutral-500">No `insured_fields` options found.</div>
                  ) : null}
                </div>
              </div>

              <details className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
                <summary className="cursor-pointer text-xs font-medium">Raw JSON (list row + detail)</summary>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <div className="text-xs font-mono whitespace-pre max-h-40 overflow-auto">
                    {JSON.stringify(selectedListRow, null, 2)}
                  </div>
                  <div className="text-xs font-mono whitespace-pre max-h-40 overflow-auto">
                    {JSON.stringify(detail, null, 2)}
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

