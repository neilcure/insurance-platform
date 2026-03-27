"use client";

import * as React from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";

type EndorsementRecord = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
  isActive: boolean;
  deletedAt: string | null;
  changes: { field: string; from: unknown; to: unknown }[];
};

export function EndorsementHistory({ policyId }: { policyId: number }) {
  const [records, setRecords] = React.useState<EndorsementRecord[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/policies?linkedPolicyId=${policyId}&_t=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const rows = (await res.json()) as Array<{
          policyId?: number;
          id?: number;
          policyNumber?: string;
          policy_number?: string;
          createdAt?: string;
          created_at?: string;
          isActive?: boolean;
          is_active?: boolean;
          extraAttributes?: Record<string, unknown>;
          carExtra?: Record<string, unknown>;
        }>;
        if (cancelled) return;
        const mapped: EndorsementRecord[] = rows.map((r) => {
          const extra = (r.extraAttributes ?? r.carExtra ?? {}) as Record<string, unknown>;
          return {
            policyId: r.policyId ?? r.id ?? 0,
            policyNumber: r.policyNumber ?? r.policy_number ?? "",
            createdAt: r.createdAt ?? r.created_at ?? "",
            isActive: r.isActive ?? r.is_active !== false,
            deletedAt: (extra._deletedAt as string) ?? null,
            changes: Array.isArray(extra._endorsementChanges)
              ? (extra._endorsementChanges as { field: string; from: unknown; to: unknown }[])
              : [],
          };
        });
        setRecords(mapped);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoaded(true); }
    }
    load();
    return () => { cancelled = true; };
  }, [policyId]);

  function openRecord(id: number) {
    setSelectedId(id);
    requestAnimationFrame(() => setDrawerOpen(true));
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setSelectedId(null), 400);
  }

  const activeRecords = records.filter((r) => r.isActive && !r.deletedAt);
  const deletedRecords = records.filter((r) => !r.isActive || !!r.deletedAt);

  if (!loaded) return null;
  if (records.length === 0) return null;

  const formatDate = (s: string) => {
    try {
      const d = new Date(s);
      return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    } catch { return s; }
  };

  return (
    <>
      <div className="rounded-md border border-amber-200 dark:border-amber-800">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-1 px-2 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/50"
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5 text-amber-500" />
            : <ChevronDown className="h-3.5 w-3.5 text-amber-500" />}
          Endorsements
          <span className="ml-0.5 text-[10px] font-normal text-amber-500">({activeRecords.length}{deletedRecords.length > 0 ? ` / ${deletedRecords.length} rolled back` : ""})</span>
        </button>
        {!collapsed && (
          <div className="space-y-1 border-t border-amber-200 px-2 py-1.5 dark:border-amber-800">
            {activeRecords.map((r) => (
              <button
                key={r.policyId}
                type="button"
                onClick={() => openRecord(r.policyId)}
                className="flex w-full items-start gap-2 rounded border border-amber-200 bg-amber-50/50 px-2 py-1.5 text-left transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:hover:bg-amber-900/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      {r.policyNumber}
                    </span>
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                      {formatDate(r.createdAt)}
                    </span>
                  </div>
                  {r.changes.length > 0 && (
                    <div className="mt-0.5 text-[10px] text-neutral-600 dark:text-neutral-400">
                      {r.changes.map((c, i) => {
                        const shortKey = String(c.field).includes("__")
                          ? String(c.field).split("__").slice(1).join("__")
                          : String(c.field);
                        const label = shortKey.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
                        return (
                          <span key={i}>
                            {i > 0 ? ", " : ""}
                            <span className="font-medium">{label}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </button>
            ))}
            {deletedRecords.map((r) => (
              <button
                key={r.policyId}
                type="button"
                onClick={() => openRecord(r.policyId)}
                className="flex w-full items-start gap-2 rounded border border-neutral-200 bg-neutral-50/50 px-2 py-1.5 text-left opacity-60 transition-colors hover:opacity-80 dark:border-neutral-700 dark:bg-neutral-900/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-medium text-neutral-400 line-through dark:text-neutral-500">
                      {r.policyNumber}
                    </span>
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                      {formatDate(r.createdAt)}
                    </span>
                    <span className="rounded bg-red-100 px-1 py-0.5 text-[9px] font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400">
                      Rolled back
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <PolicyDetailsDrawer
        policyId={selectedId}
        open={selectedId !== null}
        drawerOpen={drawerOpen}
        onClose={closeDrawer}
        title="Endorsement Details"
        entityLabel="Order Type"
      />
    </>
  );
}
