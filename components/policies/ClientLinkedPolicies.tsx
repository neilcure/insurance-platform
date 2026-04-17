"use client";

import * as React from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";
import { cn } from "@/lib/utils";
import {
  inferInsuranceTypeFromPackages,
  OTHER_POLICIES_GROUP_LABEL,
  sortInsuranceTypeGroupLabels,
  VEHICLE_INSURANCE_LABEL,
} from "@/lib/policies/insurance-type-from-packages";
import { formatPolicyNumberForDisplay, stripPolicyLineSuffix } from "@/lib/policies/policy-number-display";
import { readVehicleRegistrationFromCar } from "@/lib/policies/vehicle-registration";

type LinkedPolicy = {
  policyId: number;
  policyNumber: string;
  isActive: boolean;
  plateNumber?: string | null;
  carExtra?: Record<string, unknown> | null;
};

type FormOptionRow = { value?: unknown; label?: unknown };

function readPackagesSnapshot(extra: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!extra || typeof extra !== "object") return undefined;
  const snap = extra.packagesSnapshot ?? (extra as { packages_snapshot?: unknown }).packages_snapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) return snap as Record<string, unknown>;
  return undefined;
}

/** Plate / registration from car row or vehicle package snapshot. */
function readRegistrationLabel(policies: LinkedPolicy[]): string | null {
  for (const p of policies) {
    const r = readVehicleRegistrationFromCar(p.plateNumber, p.carExtra ?? undefined);
    if (r) return r;
  }
  return null;
}

function clusterKey(policyNumber: string): string {
  return stripPolicyLineSuffix(policyNumber).toLowerCase();
}

/** Prefer the row without "(a)" suffix; else smallest policy id. */
function pickPrimaryPolicyId(cluster: LinkedPolicy[]): number {
  if (cluster.length === 0) return 0;
  const base = stripPolicyLineSuffix(cluster[0].policyNumber);
  const withoutParen = cluster.find(
    (p) => stripPolicyLineSuffix(p.policyNumber).toLowerCase() === base.toLowerCase()
      && !/\([a-z]\)\s*$/i.test(p.policyNumber.trim()),
  );
  if (withoutParen) return withoutParen.policyId;
  return cluster.reduce((min, p) => Math.min(min, p.policyId), cluster[0].policyId);
}

function clusterPoliciesByBaseNumber(items: LinkedPolicy[]): LinkedPolicy[][] {
  const order: string[] = [];
  const map = new Map<string, LinkedPolicy[]>();
  for (const p of items) {
    const k = clusterKey(p.policyNumber);
    if (!map.has(k)) {
      map.set(k, []);
      order.push(k);
    }
    map.get(k)!.push(p);
  }
  return order.map((key) => map.get(key)!);
}

export function ClientLinkedPolicies({
  clientPolicyNumber,
  clientPolicyId,
}: {
  clientPolicyNumber: string;
  clientPolicyId: number;
}) {
  const [policies, setPolicies] = React.useState<LinkedPolicy[]>([]);
  const [packageLabels, setPackageLabels] = React.useState<Record<string, string>>({});
  const [loaded, setLoaded] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [polRes, pkgRes] = await Promise.all([
          fetch(
            `/api/policies?clientNumber=${encodeURIComponent(clientPolicyNumber)}&_t=${Date.now()}`,
            { cache: "no-store" },
          ),
          fetch(`/api/form-options?groupKey=packages&_t=${Date.now()}`, { cache: "no-store" }),
        ]);
        if (!polRes.ok || cancelled) return;
        const rows = (await polRes.json()) as Array<{
          policyId?: number;
          id?: number;
          policyNumber?: string;
          policy_number?: string;
          isActive?: boolean;
          is_active?: boolean;
          plateNumber?: string | null;
          plate_number?: string | null;
          carExtra?: Record<string, unknown> | null;
          car_extra?: Record<string, unknown> | null;
        }>;
        const labels: Record<string, string> = {};
        if (pkgRes.ok) {
          const pkgRows = (await pkgRes.json()) as FormOptionRow[];
          if (Array.isArray(pkgRows)) {
            for (const row of pkgRows) {
              const key = String(row?.value ?? "").trim();
              const lab = String(row?.label ?? "").trim();
              if (key) labels[key] = lab || key;
            }
          }
        }
        if (cancelled) return;
        setPackageLabels(labels);

        const mapped: LinkedPolicy[] = rows
          .map((r) => ({
            policyId: r.policyId ?? r.id ?? 0,
            policyNumber: r.policyNumber ?? r.policy_number ?? "",
            isActive: r.isActive ?? r.is_active !== false,
            plateNumber: r.plateNumber ?? r.plate_number ?? null,
            carExtra: r.carExtra ?? r.car_extra ?? null,
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

  const policyGroups = React.useMemo(() => {
    if (policies.length === 0) return [];
    const byLabel = new Map<string, LinkedPolicy[]>();
    for (const p of policies) {
      const pkgs = readPackagesSnapshot(p.carExtra ?? undefined);
      const label = inferInsuranceTypeFromPackages(pkgs, packageLabels) ?? OTHER_POLICIES_GROUP_LABEL;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label)!.push(p);
    }
    const keys = sortInsuranceTypeGroupLabels([...byLabel.keys()]);
    return keys.map((groupLabel) => ({ groupLabel, items: byLabel.get(groupLabel)! }));
  }, [policies, packageLabels]);

  function openPolicy(id: number) {
    setSelectedId(id);
    requestAnimationFrame(() => setDrawerOpen(true));
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setSelectedId(null), 400);
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
      <div className="w-full min-w-0 max-w-full rounded-md border border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
            : <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />}
          Policies
          <span className="ml-0.5 text-[10px] font-normal text-neutral-400">({policies.length})</span>
        </button>
        {!collapsed && (
          <div className="space-y-1.5 border-t border-neutral-200 px-1.5 py-1.5 dark:border-neutral-800">
            {policyGroups.map(({ groupLabel, items }) => (
              <div key={groupLabel} className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  {groupLabel}
                </div>
                <div className="flex w-full min-w-0 flex-col gap-1.5">
                  {clusterPoliciesByBaseNumber(items).map((cluster) => {
                    const primaryId = pickPrimaryPolicyId(cluster);
                    const baseRaw = stripPolicyLineSuffix(cluster[0].policyNumber);
                    const displayNum = formatPolicyNumberForDisplay(baseRaw);
                    const anyActive = cluster.some((p) => p.isActive);
                    const reg =
                      groupLabel === VEHICLE_INSURANCE_LABEL ? readRegistrationLabel(cluster) : null;
                    const regSep = anyActive
                      ? "border-green-200/50 dark:border-green-800/50"
                      : "border-neutral-200/80 dark:border-neutral-600/80";

                    return (
                      <div
                        key={`${groupLabel}-${primaryId}-${displayNum}`}
                        className={cn(
                          "w-full min-w-0 rounded border px-2 py-1.5",
                          anyActive
                            ? "border-green-500/35 bg-green-50/80 dark:border-green-600/40 dark:bg-green-950/35"
                            : "border-neutral-300/70 bg-neutral-50 dark:border-neutral-600/50 dark:bg-neutral-900/60",
                        )}
                      >
                        <div
                          className={cn(
                            "flex min-w-0 w-full flex-col gap-1",
                            reg && "md:flex-row md:items-center md:gap-2",
                          )}
                        >
                          <button
                            type="button"
                            title="Open policy details"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openPolicy(primaryId);
                            }}
                            className={cn(
                              "inline-flex min-w-0 w-full items-center justify-start rounded border border-transparent px-0 py-0 text-left font-mono text-sm font-semibold leading-tight transition-colors md:min-w-0 md:flex-1",
                              anyActive
                                ? "text-green-900 hover:bg-green-100/70 dark:text-green-200 dark:hover:bg-green-900/40"
                                : "text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800/70",
                            )}
                          >
                            <span className="min-w-0 wrap-break-word text-left">{displayNum}</span>
                          </button>
                          {reg && (
                            <div
                              className={cn(
                                "flex min-w-0 w-full flex-col gap-0.5 border-t pt-1 md:ml-auto md:w-auto md:max-w-44 md:flex-none md:border-t-0 md:border-l md:pt-0 md:pl-2",
                                regSep,
                              )}
                            >
                              <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0 text-left md:justify-end md:text-right">
                                <span
                                  className={cn(
                                    "text-[10px] font-semibold uppercase tracking-wide",
                                    anyActive
                                      ? "text-emerald-900 dark:text-emerald-400"
                                      : "text-neutral-600 dark:text-neutral-400",
                                  )}
                                >
                                  Reg.
                                </span>
                                <span
                                  className={cn(
                                    "font-mono text-xs font-semibold tabular-nums tracking-tight sm:text-sm",
                                    anyActive
                                      ? "text-neutral-900 dark:text-neutral-50"
                                      : "text-neutral-800 dark:text-neutral-100",
                                  )}
                                >
                                  {reg}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PolicyDetailsDrawer
        policyId={selectedId}
        open={selectedId !== null}
        drawerOpen={drawerOpen}
        onClose={closeDrawer}
        title="Policy Details"
        hideClientInfo
      />
    </>
  );
}
