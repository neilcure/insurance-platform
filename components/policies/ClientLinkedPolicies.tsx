"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { PolicySnapshotView } from "@/components/policies/PolicySnapshotView";
import type { PolicyDetail } from "@/lib/types/policy";

type LinkedPolicy = {
  policyId: number;
  policyNumber: string;
  isActive: boolean;
};

export function ClientLinkedPolicies({
  clientPolicyNumber,
  clientPolicyId,
}: {
  clientPolicyNumber: string;
  clientPolicyId: number;
}) {
  const [policies, setPolicies] = React.useState<LinkedPolicy[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [selectedDetail, setSelectedDetail] = React.useState<PolicyDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [loadingId, setLoadingId] = React.useState<number | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => { setMounted(true); }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/policies?clientNumber=${encodeURIComponent(clientPolicyNumber)}&_t=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const rows = (await res.json()) as Array<{
          policyId?: number;
          id?: number;
          policyNumber?: string;
          policy_number?: string;
          isActive?: boolean;
          is_active?: boolean;
        }>;
        if (cancelled) return;
        const mapped: LinkedPolicy[] = rows
          .map((r) => ({
            policyId: r.policyId ?? r.id ?? 0,
            policyNumber: r.policyNumber ?? r.policy_number ?? "",
            isActive: r.isActive ?? r.is_active !== false,
          }))
          .filter((p) => p.policyId !== clientPolicyId && p.policyNumber !== clientPolicyNumber);
        setPolicies(mapped);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [clientPolicyNumber, clientPolicyId]);

  async function openPolicy(id: number) {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/policies/${id}?_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as PolicyDetail;
      setSelectedDetail(data);
      requestAnimationFrame(() => setDrawerOpen(true));
    } catch {
      /* ignore */
    } finally {
      setLoadingId(null);
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setSelectedDetail(null), 400);
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading policies...
      </div>
    );
  }

  if (policies.length === 0) return null;

  return (
    <>
      <div className="rounded-md border border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center gap-1 px-2 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
            : <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />}
          Policies
          <span className="ml-0.5 text-[10px] font-normal text-neutral-400">({policies.length})</span>
        </button>
        {!collapsed && (
          <div className="flex flex-wrap gap-1.5 border-t border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
            {policies.map((p) => (
              <button
                key={p.policyId}
                type="button"
                onClick={() => openPolicy(p.policyId)}
                disabled={loadingId === p.policyId}
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                  p.isActive
                    ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400 dark:hover:bg-green-900/50"
                    : "border-neutral-300 bg-neutral-50 text-neutral-400 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-500 dark:hover:bg-neutral-800"
                }`}
              >
                {loadingId === p.policyId ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                {p.policyNumber}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedDetail && mounted
        ? createPortal(
            <SlideDrawer
              open={drawerOpen}
              onClose={closeDrawer}
              title="Policy Details"
              side="right"
              zClass="z-60"
              passthrough
            >
              <div className="overflow-y-auto p-3 text-sm" style={{ maxHeight: "calc(100vh - 52px)" }}>
                <PolicySnapshotView detail={selectedDetail} entityLabel="Policy" />
              </div>
            </SlideDrawer>,
            document.body,
          )
        : null}
    </>
  );
}
