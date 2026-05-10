"use client";

import * as React from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { PackageBlock } from "@/components/policies/PackageBlock";
import { AddressTool, type AddressFieldMap } from "@/components/policies/address-tool";
import { discoverAddressFields } from "@/lib/address/discover-fields";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { X, UserPlus, UserSearch, ArrowRight, ArrowLeft, Check, Loader2 } from "lucide-react";
import { extractDisplayName } from "@/lib/import/entity-display-name";

type FlowOption = {
  id: number;
  label: string;
  value: string;
  meta?: {
    showInDashboard?: boolean;
    icon?: string;
    dashboardLabel?: string;
    recordPickerFlow?: string;
    recordPickerLabel?: string;
  } | null;
};

type StepRow = {
  id: number;
  label: string;
  value: string;
  sortOrder: number;
  meta?: {
    packages?: string[];
    packageCategories?: Record<string, string[]>;
    packageShowWhen?: Record<
      string,
      { package: string; category: string | string[] }[]
    >;
    packageGroupLabelsHidden?: Record<string, boolean>;
    categoryStepVisibility?: Record<string, string[]>;
    categoryShowWhen?: Record<string, { package: string; category: string | string[] }[]>;
    showWhen?: {
      package: string;
      category?: string | string[];
      field?: string;
      fieldValues?: string[];
      requiresSelectedRecord?: boolean;
    }[];
    isFinal?: boolean;
    wizardStep?: number;
    wizardStepLabel?: string;
    embeddedFlow?: string;
    embeddedFlowLabel?: string;
    _sourceFlow?: string;
    recordPickerFlow?: string;
  };
};

type PkgOption = { label: string; value: string };

type ClientRow = {
  id: number;
  clientNumber: string;
  category: string;
  displayName: string;
};

type RecordRow = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
  carExtra?: Record<string, unknown> | null;
  displayName?: string;
};

function StepDot({
  n,
  active,
  done,
  onClick,
}: {
  n: number;
  active: boolean;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium transition-colors ${
        active
          ? "border-yellow-500 bg-yellow-500 text-white"
          : done
            ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            : "border-neutral-300 bg-white text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
      }`}
    >
      {n}
    </button>
  );
}

// ----- Client fill helpers -----

function fillFormFromClient(
  form: UseFormReturn<Record<string, unknown>>,
  extra: Record<string, unknown>,
  category?: string,
) {
  const isEmpty = (v: unknown) =>
    typeof v === "undefined" || v === null || (typeof v === "string" && v.trim() === "");

  const formValues = form.getValues() as Record<string, unknown>;
  const registeredKeys = Object.keys(formValues);
  const registeredByLower = new Map<string, string>();
  for (const rk of registeredKeys) {
    registeredByLower.set(rk.toLowerCase(), rk);
  }

  const setIfEmpty = (name: string, v: unknown) => {
    try {
      const curr = formValues[name];
      if (!isEmpty(curr)) return;
      form.setValue(name as never, v as never, { shouldDirty: false, shouldTouch: false });
      try {
        form.resetField(name as never, { defaultValue: v as never });
      } catch { /* field may not be registered yet */ }
    } catch { /* ignore */ }
  };

  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    const lower = k.toLowerCase();

    if (lower.startsWith("insured_") || lower.startsWith("insured__")) {
      const tail = lower.replace(/^insured__?/, "");
      setIfEmpty(`insured__${tail}`, v);
      setIfEmpty(`insured_${tail}`, v);
      setIfEmpty(k, v);
      const regMatch = registeredByLower.get(`insured__${tail}`);
      if (regMatch && regMatch !== `insured__${tail}`) setIfEmpty(regMatch, v);
    } else if (lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")) {
      const tail = lower.replace(/^contactinfo__?/, "");
      setIfEmpty(`contactinfo__${tail}`, v);
      setIfEmpty(`contactinfo_${tail}`, v);
      setIfEmpty(k, v);
      const regMatch = registeredByLower.get(`contactinfo__${tail}`);
      if (regMatch && regMatch !== `contactinfo__${tail}`) setIfEmpty(regMatch, v);
    }
  }

  if (category === "company" || category === "personal") {
    const currType = String(formValues?.insuredType ?? "").trim().toLowerCase();
    if (!currType || currType !== category) {
      form.setValue("_suppressInsuredTypeConfirm" as never, true as never, { shouldDirty: false });
      form.setValue("insuredType" as never, category as never, { shouldDirty: false, shouldTouch: false });
      setIfEmpty("insured__category", category);
    }
  }
}

function fillFormFromRecord(
  form: UseFormReturn<Record<string, unknown>>,
  extraAttributes: Record<string, unknown>,
) {
  const isEmpty = (v: unknown) =>
    typeof v === "undefined" || v === null || (typeof v === "string" && v.trim() === "");

  const setVal = (name: string, v: unknown) => {
    try {
      form.setValue(name as never, v as never, { shouldDirty: false, shouldTouch: false });
      try { form.resetField(name as never, { defaultValue: v as never }); } catch { /* not registered yet */ }
    } catch { /* ignore */ }
  };

  const pkgs = (extraAttributes.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const [pkg, data] of Object.entries(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const structured = data as { category?: string; values?: Record<string, unknown> };
    const values = structured.values ?? (data as Record<string, unknown>);
    if (structured.category) {
      setVal(`${pkg}__category`, structured.category);
    }
    for (const [k, v] of Object.entries(values)) {
      if (isEmpty(v)) continue;
      setVal(k, v);
      if (!k.startsWith(`${pkg}__`)) {
        setVal(`${pkg}__${k}`, v);
      }
    }
  }

  const insured = (extraAttributes.insuredSnapshot ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(insured)) {
    if (isEmpty(v)) continue;
    setVal(k, v);
    const lower = k.toLowerCase();
    if (lower.startsWith("insured_") || lower.startsWith("insured__")) {
      const tail = lower.replace(/^insured__?/, "");
      setVal(`insured__${tail}`, v);
    } else if (lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")) {
      const tail = lower.replace(/^contactinfo__?/, "");
      setVal(`contactinfo__${tail}`, v);
    }
  }
}

// ----- Main page -----

export default function FlowNewPage() {
  const params = useParams();
  const flowKey = params.flow as string;
  const router = useRouter();
  const form = useForm<Record<string, unknown>>({ mode: "onSubmit" });

  const [flowInfo, setFlowInfo] = React.useState<FlowOption | null>(null);
  const [flowOptions, setFlowOptions] = React.useState<FlowOption[]>([]);
  const [steps, setSteps] = React.useState<StepRow[]>([]);
  const [pkgOptions, setPkgOptions] = React.useState<PkgOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmUpdateOpen, setConfirmUpdateOpen] = React.useState(false);
  const [confirmClientSaveOpen, setConfirmClientSaveOpen] = React.useState(false);
  const [confirmNewClientOpen, setConfirmNewClientOpen] = React.useState(false);
  const [savingClient, setSavingClient] = React.useState(false);
  // Duplicate-client guard: populated when /api/policies POST returns
  // 409 (code: "DUPLICATE_CLIENT"). The dialog offers a one-click
  // "Use Existing Client" that reuses the same chooseExistingClient
  // path the picker uses, so the user lands in the same state as if
  // they had selected the client from the drawer in the first place.
  const [duplicateClient, setDuplicateClient] = React.useState<{
    id: number;
    policyNumber: string;
    displayName: string;
    matchedField: string;
    matchedValue: string;
  } | null>(null);
  const loadedSnapshotRef = React.useRef<string | null>(null);
  const pendingSubmitRef = React.useRef<(() => void) | null>(null);
  const pendingContinueRef = React.useRef<(() => void) | null>(null);
  const [wizardStep, setWizardStep] = React.useState(1);
  const [highestCompleted, setHighestCompleted] = React.useState(0);
  const [selectedRowByStep, setSelectedRowByStep] = React.useState<
    Record<number, string | undefined>
  >({});

  const [userType, setUserType] = React.useState<string | null>(null);

  // Client picker state (kept for create-client mode)
  const [clientPickerOpen, setClientPickerOpen] = React.useState(false);
  const [clientDrawerOpen, setClientDrawerOpen] = React.useState(false);
  const [clientRows, setClientRows] = React.useState<ClientRow[]>([]);
  const [loadingClients, setLoadingClients] = React.useState(false);
  const [clientSearch, setClientSearch] = React.useState("");
  const [selectedClientId, setSelectedClientId] = React.useState<number | null>(null);
  const [selectedClientNumber, setSelectedClientNumber] = React.useState<string>("");
  const pendingClientFillRef = React.useRef<{ insured: Record<string, unknown>; category?: string } | null>(null);
  const fillingClientRef = React.useRef(false);

  // Record picker state (for "Select Existing" in flow context)
  const [recordPickerOpen, setRecordPickerOpen] = React.useState(false);
  const [recordDrawerOpen, setRecordDrawerOpen] = React.useState(false);
  const [recordRows, setRecordRows] = React.useState<RecordRow[]>([]);
  const [loadingRecords, setLoadingRecords] = React.useState(false);
  const [recordSearch, setRecordSearch] = React.useState("");
  const [selectedRecordId, setSelectedRecordId] = React.useState<number | null>(null);
  const selectedRecordFlowRef = React.useRef<string | null>(null);

  // Address Tool state
  const [addressFieldMap, setAddressFieldMap] = React.useState<AddressFieldMap>({});
  const [areaOptions, setAreaOptions] = React.useState<{ label?: string; value?: string }[]>([]);

  // Track selected record's package keys for non-embedded endorsement flow
  const selectedRecordPkgsRef = React.useRef<Set<string> | null>(null);

  // Auto-scroll state for endorsement workflow
  const pendingScrollGroupRef = React.useRef<string | null>(null);
  const scrollAfterLoadRef = React.useRef(false);

  // Load flow, steps (with embedded expansion), packages, account
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [flowsRes, stepsRes, pkgsRes, accRes] = await Promise.all([
          fetch("/api/form-options?groupKey=flows", { cache: "no-store" }),
          fetch(
            `/api/form-options?groupKey=${encodeURIComponent(`flow_${flowKey}_steps`)}`,
            { cache: "no-store" },
          ),
          fetch("/api/form-options?groupKey=packages", { cache: "no-store" }),
          fetch("/api/account/info", { cache: "no-store" }),
        ]);

        if (cancelled) return;

        if (flowsRes.ok) {
          const flows = (await flowsRes.json()) as FlowOption[];
          setFlowOptions(flows);
          const match = flows.find((f) => f.value === flowKey);
          if (match) setFlowInfo(match);
        }

        if (stepsRes.ok) {
          const data = (await stepsRes.json()) as StepRow[];
          const raw = Array.isArray(data) ? data : [];
          const sorted = [...raw].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

          const expanded: StepRow[] = [];
          let wizardStepCounter = 1;

          async function expandEmbeddedFlow(
            embeddedFlowKey: string,
            labelOverride: string | undefined,
            sourceFlow: string,
            depth: number,
          ) {
            if (depth > 5 || cancelled) return;
            const embedRes = await fetch(
              `/api/form-options?groupKey=${encodeURIComponent(`flow_${embeddedFlowKey}_steps`)}`,
              { cache: "no-store" },
            );
            if (!embedRes.ok || cancelled) return;
            const embedData = (await embedRes.json()) as StepRow[];
            const embedSteps = Array.isArray(embedData)
              ? [...embedData].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              : [];
            const byStep = new Map<number, StepRow[]>();
            for (const es of embedSteps) {
              const rawWs = Number(es.meta?.wizardStep ?? -1);
              const n = rawWs > 0 ? rawWs : (Number.isFinite(es.sortOrder) ? es.sortOrder : 999);
              if (!byStep.has(n)) byStep.set(n, []);
              byStep.get(n)!.push(es);
            }
            const sortedGroupKeys = [...byStep.keys()].sort((a, b) => a - b);
            for (const k of sortedGroupKeys) {
              const group = byStep.get(k) ?? [];
              for (const es of group) {
                const esMeta = es.meta ?? {};
                if (esMeta.embeddedFlow) {
                  const nestedHasOwn = Array.isArray(esMeta.packages) && esMeta.packages.length > 0;
                  if (nestedHasOwn) {
                    expanded.push({
                      ...es,
                      id: es.id * 10000 + wizardStepCounter,
                      meta: {
                        ...esMeta,
                        wizardStep: wizardStepCounter,
                        wizardStepLabel: labelOverride || esMeta.wizardStepLabel,
                        _sourceFlow: sourceFlow,
                      },
                    });
                    wizardStepCounter++;
                  }
                  await expandEmbeddedFlow(
                    esMeta.embeddedFlow as string,
                    (esMeta.embeddedFlowLabel as string)?.trim() || labelOverride,
                    esMeta.embeddedFlow as string,
                    depth + 1,
                  );
                } else {
                  expanded.push({
                    ...es,
                    id: es.id * 10000 + wizardStepCounter,
                    meta: {
                      ...esMeta,
                      wizardStep: wizardStepCounter,
                      wizardStepLabel: labelOverride || esMeta.wizardStepLabel,
                      _sourceFlow: sourceFlow,
                    },
                  });
                }
              }
              const anyAdded = group.some((es) => !es.meta?.embeddedFlow || (Array.isArray(es.meta?.packages) && es.meta!.packages.length > 0));
              if (anyAdded) wizardStepCounter++;
            }
          }

          for (const step of sorted) {
            const meta = step.meta ?? {};
            if (meta.embeddedFlow) {
              const hasOwnPackages = Array.isArray(meta.packages) && meta.packages.length > 0;
              if (hasOwnPackages) {
                expanded.push({
                  ...step,
                  meta: { ...meta, wizardStep: wizardStepCounter },
                });
                wizardStepCounter++;
              }
              await expandEmbeddedFlow(
                meta.embeddedFlow as string,
                (meta.embeddedFlowLabel as string)?.trim(),
                meta.embeddedFlow as string,
                0,
              );
            } else {
              expanded.push({
                ...step,
                meta: { ...meta, wizardStep: wizardStepCounter },
              });
              wizardStepCounter++;
            }
          }
          if (!cancelled) setSteps(expanded);
        }

        if (pkgsRes.ok) {
          const data = (await pkgsRes.json()) as PkgOption[];
          setPkgOptions(Array.isArray(data) ? data : []);
        }

        if (accRes.ok) {
          const acc = (await accRes.json()) as { user?: { userType?: string } | null };
          setUserType(acc.user?.userType ?? null);
        }
      } catch {
        toast.error("Failed to load flow configuration");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [flowKey]);

  // Discover address fields from ALL packages (step packages + all active packages)
  React.useEffect(() => {
    let cancelled = false;
    async function discover() {
      const allPkgs = new Set<string>();
      // From step packages
      for (const s of steps) {
        for (const p of (s.meta?.packages ?? []) as string[]) allPkgs.add(p);
      }
      // Always include contactinfo — address fields commonly live here
      allPkgs.add("contactinfo");
      // Also include all known packages
      for (const po of pkgOptions) if (po.value) allPkgs.add(po.value);

      const mergedMap: Record<string, string> = {};
      let mergedAreaOpts: { label?: string; value?: string }[] = [];
      const usedFieldValues = new Set<string>();

      for (const pkg of allPkgs) {
        try {
          const res = await fetch(
            `/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`,
            { cache: "no-store" },
          );
          if (!res.ok) continue;
          const rows = (await res.json()) as {
            label?: string;
            value?: string;
            meta?: { options?: { label?: string; value?: string }[] };
          }[];
          const { fieldMap, areaOptions: ao } = discoverAddressFields(rows, pkg, { usedFieldValues });
          for (const [k, v] of Object.entries(fieldMap)) {
            if (v && !mergedMap[k]) mergedMap[k] = v;
          }
          if (ao.length > 0 && mergedAreaOpts.length === 0) mergedAreaOpts = ao;
        } catch { /* ignore */ }
      }

      if (!cancelled) {
        setAddressFieldMap(mergedMap as AddressFieldMap);
        if (mergedAreaOpts.length > 0) setAreaOptions(mergedAreaOpts);
      }
    }
    void discover();
    return () => { cancelled = true; };
  }, [steps, pkgOptions]);

  // Re-apply pending client data when form fields change (e.g. PackageBlock registers new fields)
  React.useEffect(() => {
    const sub = form.watch(() => {
      const pending = pendingClientFillRef.current;
      if (!pending || fillingClientRef.current) return;
      const vals = form.getValues() as Record<string, unknown>;
      const keys = Object.keys(vals);
      const hasInsuredFields = keys.some((k) => {
        const l = k.toLowerCase();
        return l.startsWith("insured_") || l.startsWith("insured__");
      });
      if (!hasInsuredFields) return;
      const anyEmpty = keys.some((k) => {
        const l = k.toLowerCase();
        if (!(l.startsWith("insured_") || l.startsWith("insured__"))) return false;
        if (l === "insured__category" || l === "insuredtype") return false;
        const v = vals[k];
        return v === undefined || v === null || (typeof v === "string" && !v.trim());
      });
      if (!anyEmpty) {
        pendingClientFillRef.current = null;
        loadedSnapshotRef.current = JSON.stringify(vals);
        return;
      }
      fillingClientRef.current = true;
      fillFormFromClient(form, pending.insured, pending.category);
      loadedSnapshotRef.current = JSON.stringify(form.getValues());
      fillingClientRef.current = false;
    });
    return () => sub.unsubscribe();
  }, [form]);

  // Client picker drawer animation
  React.useEffect(() => {
    if (clientPickerOpen) {
      setClientDrawerOpen(false);
      requestAnimationFrame(() => setClientDrawerOpen(true));
    } else {
      setClientDrawerOpen(false);
    }
  }, [clientPickerOpen]);

  const clientFlowKey = React.useMemo(() => {
    for (const s of steps) {
      const sf = s.meta?._sourceFlow ?? "";
      if (sf.toLowerCase().includes("client")) return sf;
      const ef = s.meta?.embeddedFlow ?? "";
      if (ef.toLowerCase().includes("client")) return ef;
    }
    return "";
  }, [steps]);

  // Load clients from flow-based records when picker opens
  React.useEffect(() => {
    let cancelled = false;
    async function loadClients() {
      if (!clientPickerOpen) return;
      setLoadingClients(true);
      try {
        const flowFilter = clientFlowKey || flowKey;
        const isClientFlow = flowFilter.toLowerCase().includes("client");
        const url = isClientFlow
          ? `/api/policies?flow=${encodeURIComponent(flowFilter)}&limit=500&_t=${Date.now()}`
          : `/api/policies?flow=${encodeURIComponent(flowFilter)}&limit=500&_t=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        const raw = res.ok ? await res.json() : null;
        const json: Array<Record<string, unknown>> = Array.isArray(raw)
          ? (raw as Array<Record<string, unknown>>)
          : Array.isArray(raw?.rows)
            ? (raw.rows as Array<Record<string, unknown>>)
            : [];
        if (!cancelled) {
          setClientRows(
            json
              .map((r: Record<string, unknown>) => {
                const policyId = Number(r.policyId ?? r.id ?? 0);
                const policyNumber = String(r.policyNumber ?? r.policy_number ?? "");
                const extra = (r.carExtra ?? r.extraAttributes ?? r.extra_attributes ?? null) as Record<string, unknown> | null;
                const insured = (extra?.insuredSnapshot ?? {}) as Record<string, unknown>;
                const rawType = String(insured?.insuredType ?? insured?.insured__category ?? "").trim().toLowerCase();
                const category = rawType === "company" || rawType === "personal" ? rawType : "";
                // Use the shared canonical extractor so:
                //  - keys like `insured__companyName`, `insured_companyName`,
                //    or bare `companyName` all resolve through `insuredGet`
                //    (handles legacy snapshots where multiple key variants
                //    coexist and the wrong one would otherwise win).
                //  - the picker label matches what the rest of the app shows
                //    for the same client (header chips, PDF templates, etc.).
                //  - personal-type insured falls back through `lastName +
                //    firstName` → `fullName` correctly.
                const displayName = extractDisplayName(extra ?? undefined);
                return { id: policyId, clientNumber: policyNumber, category, displayName };
              })
              .filter((r) => Number.isFinite(r.id) && r.id > 0),
          );
        }
      } catch {
        if (!cancelled) setClientRows([]);
      } finally {
        if (!cancelled) setLoadingClients(false);
      }
    }
    void loadClients();
    return () => { cancelled = true; };
  }, [clientPickerOpen, clientFlowKey, flowKey]);

  const filteredClients = React.useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clientRows;
    return clientRows.filter((r) => {
      const hay = `${r.clientNumber} ${r.displayName} ${r.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clientRows, clientSearch]);

  // Record picker drawer animation
  React.useEffect(() => {
    if (recordPickerOpen) {
      setRecordDrawerOpen(false);
      requestAnimationFrame(() => setRecordDrawerOpen(true));
    } else {
      setRecordDrawerOpen(false);
    }
  }, [recordPickerOpen]);

  // Load flow records when picker opens (uses step-level recordPickerFlow override if set)
  React.useEffect(() => {
    let cancelled = false;
    async function loadRecords() {
      if (!recordPickerOpen || !flowKey) return;
      // Compute the effective picker flow from step meta
      const stepGroup = (() => {
        const sorted2 = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const grps: Record<number, StepRow[]> = {};
        for (const s of sorted2) {
          const n = Number(s.meta?.wizardStep ?? 0) || 999;
          if (!grps[n]) grps[n] = [];
          grps[n]!.push(s);
        }
        return grps[wizardStep] ?? [];
      })();
      const selVal = selectedRowByStep[wizardStep];
      const activeRow = stepGroup.length === 1
        ? stepGroup[0]
        : stepGroup.find((r) => r.value === selVal) ?? null;
      const pickerFlow = activeRow?.meta?.recordPickerFlow || flowInfo?.meta?.recordPickerFlow || flowKey;
      setLoadingRecords(true);
      try {
        const res = await fetch(`/api/policies?flow=${encodeURIComponent(pickerFlow)}&limit=500`, { cache: "no-store" });
        const raw = res.ok ? await res.json() : null;
        const json: RecordRow[] = Array.isArray(raw)
          ? (raw as RecordRow[])
          : Array.isArray(raw?.rows)
            ? (raw.rows as RecordRow[])
            : [];
        if (!cancelled) {
          // Use the shared canonical extractor — same path the EntityPickerDrawer
          // and "Select Existing Client" picker use. Tries `insuredSnapshot`
          // (via `getInsuredDisplayName`) FIRST so a policy with a personal
          // insured doesn't accidentally surface a driver's first/last name
          // from the driver package; falls back to scanning packages with the
          // `insured` package prioritised; finally falls back to broker /
          // company / vendor heuristics for entity-type pickers.
          setRecordRows(
            (Array.isArray(json) ? json : [])
              .filter((r: RecordRow) => Number.isFinite(r.policyId) && r.policyId > 0)
              .map((r: RecordRow) => {
                const extra = (r.carExtra ?? null) as Record<string, unknown> | null;
                if (!extra) return r;
                const displayName = extractDisplayName(extra);
                return { ...r, displayName };
              }),
          );
        }
      } catch {
        if (!cancelled) setRecordRows([]);
      } finally {
        if (!cancelled) setLoadingRecords(false);
      }
    }
    void loadRecords();
    return () => { cancelled = true; };
  }, [recordPickerOpen, flowKey, steps, wizardStep, selectedRowByStep]);

  const filteredRecords = React.useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    if (!q) return recordRows;
    return recordRows.filter((r) => {
      const hay = `${r.policyNumber} ${r.displayName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [recordRows, recordSearch]);

  async function chooseExistingClient(policyId: number) {
    try {
      const res = await fetch(`/api/policies/${policyId}?_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        toast.error("Failed to load client");
        return;
      }
      const detail = (await res.json()) as {
        policyId: number;
        policyNumber?: string;
        recordId?: number;
        recordNumber?: string;
        extraAttributes?: Record<string, unknown> | null;
      };
      const extra = (detail?.extraAttributes ?? {}) as Record<string, unknown>;
      const insured = (extra.insuredSnapshot ?? {}) as Record<string, unknown>;
      const category = String(insured?.insuredType ?? insured?.insured__category ?? "").trim().toLowerCase();

      const clearAndFill = () => {
        fillingClientRef.current = true;
        const vals = form.getValues() as Record<string, unknown>;
        for (const k of Object.keys(vals)) {
          const lower = k.toLowerCase();
          if (
            lower.startsWith("insured_") || lower.startsWith("insured__") ||
            lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")
          ) {
            try { form.setValue(k as never, "" as never, { shouldDirty: false }); } catch {}
          }
        }
        try { form.setValue("insuredType" as never, "" as never, { shouldDirty: false }); } catch {}
        fillFormFromClient(form, insured, category || undefined);
        fillingClientRef.current = false;
      };

      clearAndFill();
      loadedSnapshotRef.current = JSON.stringify(form.getValues());
      pendingClientFillRef.current = { insured, category: category || undefined };

      setClientWasCreatedByButton(false);
      setSelectedClientId(detail.recordId ?? detail.policyId);
      setSelectedClientNumber(detail.recordNumber ?? detail.policyNumber ?? String(detail.policyId));
      setClientPickerOpen(false);
      toast.success(
        `Client selected: ${detail.recordNumber ?? detail.policyNumber ?? detail.policyId}`,
        { duration: 1500 },
      );

      // Re-apply after PackageBlock fields finish registering (only fills empty fields)
      const retryFill = () => {
        if (!pendingClientFillRef.current) return;
        fillingClientRef.current = true;
        fillFormFromClient(form, insured, category || undefined);
        loadedSnapshotRef.current = JSON.stringify(form.getValues());
        fillingClientRef.current = false;
      };
      setTimeout(retryFill, 400);
      setTimeout(retryFill, 1000);
      setTimeout(() => {
        retryFill();
        pendingClientFillRef.current = null;
      }, 2000);
    } catch {
      toast.error("Failed to load client details");
    }
  }

  async function chooseExistingRecord(policyId: number) {
    try {
      const res = await fetch(`/api/policies/${policyId}`, { cache: "no-store" });
      if (!res.ok) {
        toast.error("Failed to load record");
        return;
      }
      const detail = (await res.json()) as {
        policyId?: number;
        policyNumber?: string;
        recordId?: number;
        recordNumber?: string;
        extraAttributes?: Record<string, unknown> | null;
      };
      const extra = (detail?.extraAttributes ?? {}) as Record<string, unknown>;
      fillFormFromRecord(form, extra);
      loadedSnapshotRef.current = JSON.stringify(form.getValues());
      const pkgsSnapshot = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;
      selectedRecordPkgsRef.current = new Set(Object.keys(pkgsSnapshot));
      setSelectedRecordId(detail.recordId ?? detail.policyId ?? policyId);
      const stepGroup = (() => {
        const sorted2 = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const grps: Record<number, StepRow[]> = {};
        for (const s of sorted2) {
          const n = Number(s.meta?.wizardStep ?? 0) || 999;
          if (!grps[n]) grps[n] = [];
          grps[n]!.push(s);
        }
        return grps[wizardStep] ?? [];
      })();
      const selVal = selectedRowByStep[wizardStep];
      const activeRow = stepGroup.length === 1
        ? stepGroup[0]
        : stepGroup.find((r) => r.value === selVal) ?? null;
      const pickerFlow = activeRow?.meta?.recordPickerFlow || flowInfo?.meta?.recordPickerFlow || null;
      selectedRecordFlowRef.current = pickerFlow && pickerFlow !== flowKey ? pickerFlow : null;

      setRecordPickerOpen(false);
      toast.success(
        `${title} loaded: ${detail.recordNumber ?? detail.policyNumber ?? policyId}`,
        { duration: 1500 },
      );

      // After loading, scroll to the target section if a scrollToPackage/scrollToGroup is set
      scrollAfterLoadRef.current = true;
      setTimeout(() => {
        if (!pendingScrollGroupRef.current) return;
        scrollToTarget(pendingScrollGroupRef.current);
        scrollAfterLoadRef.current = false;
      }, 600);
    } catch {
      toast.error("Failed to load record details");
    }
  }

  // Watch for "Choose Existing Client" selection to open picker
  const wizardFormValues = form.watch();
  const [creatingClient, setCreatingClient] = React.useState(false);
  const [clientWasCreatedByButton, setClientWasCreatedByButton] = React.useState(false);

  const hasClientStep = React.useMemo(() => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    for (const k of Object.keys(wizardFormValues ?? {})) {
      const nk = normalize(k);
      if (
        nk.includes("existorcreateclient") ||
        nk.includes("newexistingclient") ||
        nk.includes("neworexistingclient") ||
        nk.includes("existingornewclient") ||
        nk.includes("newexisting") ||
        nk.includes("existcreate") ||
        nk.includes("existingclient")
      ) return true;
    }
    return false;
  }, [wizardFormValues]);

  const isCreateNewClientMode = React.useMemo(() => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    let namespacedResult: boolean | null = null;
    let rawResult: boolean | null = null;
    for (const [k, v] of Object.entries(wizardFormValues ?? {})) {
      const nk = normalize(k);
      const isField =
        nk.includes("existorcreateclient") ||
        nk.includes("newexistingclient") ||
        nk.includes("neworexistingclient") ||
        nk.includes("existingornewclient") ||
        nk.includes("newexisting") ||
        nk.includes("existcreate") ||
        nk.includes("existingclient");
      if (!isField) continue;
      const nv = normalize(String(v ?? ""));
      let result: boolean | null = null;
      if (nv.includes("create") || nv.includes("new")) result = true;
      else if (nv.includes("existing") || nv.includes("choose")) result = false;
      if (result !== null) {
        if (k.includes("__")) namespacedResult = result;
        else rawResult = result;
      }
    }
    return namespacedResult ?? rawResult ?? false;
  }, [wizardFormValues]);

  const handleCreateClient = React.useCallback(async () => {
    setCreatingClient(true);
    try {
      const values = form.getValues() as Record<string, unknown>;
      const insuredOut: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (typeof k !== "string") continue;
        const lower = k.toLowerCase();
        const isInsured =
          lower.startsWith("insured_") ||
          lower.startsWith("insured__") ||
          lower.includes("__insured_") ||
          lower.includes("__insured__");
        const isContact =
          lower.startsWith("contactinfo_") ||
          lower.startsWith("contactinfo__") ||
          lower.includes("__contactinfo_") ||
          lower.includes("__contactinfo__");
        if (!isInsured && !isContact) continue;
        if (v === undefined || v === null) continue;
        if (typeof v === "string" && v.trim() === "") continue;
        insuredOut[k] = v;
      }
      const getAlias = (name: string): unknown => {
        const direct = values[name];
        if (typeof direct !== "undefined") return direct;
        const nameNorm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const [kk, vv] of Object.entries(values)) {
          const nk = kk.toLowerCase();
          if (nk.endsWith(`__${nameNorm}`) || nk.endsWith(`_${nameNorm}`)) {
            const sv = typeof vv === "string" ? vv : (vv as any)?.toString?.();
            if (typeof sv === "string" && sv.trim() !== "") return sv;
            if (vv !== undefined && vv !== null && typeof vv !== "string") return vv;
          }
        }
        return undefined;
      };
      let insuredTypeVal = values["insuredType"] as unknown;
      if (typeof insuredTypeVal !== "string" || !insuredTypeVal.trim()) {
        insuredTypeVal = getAlias("category") ?? getAlias("insuredType");
      }
      if (typeof insuredTypeVal === "string") {
        const t = insuredTypeVal.trim().toLowerCase();
        if (t === "company" || t === "personal") insuredOut["insuredType"] = t;
      }
      if (!insuredOut["insuredType"]) {
        const cat = (values["insured__category"] ?? getAlias("category")) as unknown;
        if (typeof cat === "string" && cat.trim()) insuredOut["insuredType"] = cat.trim().toLowerCase();
      }
      const addIfMissing = (destKey: string, val: unknown) => {
        if (typeof insuredOut[destKey] === "undefined") {
          if (typeof val === "string" ? val.trim() !== "" : typeof val !== "undefined" && val !== null) {
            insuredOut[destKey] = typeof val === "string" ? val.trim() : val;
          }
        }
      };
      addIfMissing("insured_companyName", getAlias("companyName"));
      addIfMissing("insured_brNumber", getAlias("brNumber"));
      addIfMissing("insured_ciNumber", getAlias("ciNumber"));
      addIfMissing("insured_firstName", getAlias("firstName"));
      addIfMissing("insured_lastName", getAlias("lastName"));
      addIfMissing("insured_fullName", getAlias("fullName"));
      addIfMissing("insured_idNumber", getAlias("idNumber"));
      addIfMissing("insured_contactPhone", getAlias("contactPhone"));
      addIfMissing("insured_contactName", getAlias("contactName"));
      addIfMissing("insured_contactEmail", getAlias("contactEmail"));
      if (Object.keys(insuredOut).length === 0) {
        toast.error("Please provide insured/contact information to create client.");
        return;
      }
      const targetFlow = clientFlowKey || "clientSet";
      const resClient = await fetch("/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ insured: insuredOut, flowKey: targetFlow }),
      });
      const jClient = (await resClient.json().catch(() => ({}))) as Record<string, unknown>;
      // 409 + DUPLICATE_CLIENT → server-side dedupe matched an existing
      // client by CI Number / BR Number / HKID. Open the dialog so the
      // user can switch to the existing record with one click instead
      // of typing the data again or hunting through the picker.
      if (resClient.status === 409 && jClient?.code === "DUPLICATE_CLIENT") {
        const existing = jClient.existingClient as
          | { id?: number; policyNumber?: string; displayName?: string; matchedField?: string; matchedValue?: string }
          | undefined;
        if (existing && Number.isFinite(Number(existing.id)) && Number(existing.id) > 0) {
          setDuplicateClient({
            id: Number(existing.id),
            policyNumber: String(existing.policyNumber ?? ""),
            displayName: String(existing.displayName ?? ""),
            matchedField: String(existing.matchedField ?? "ID"),
            matchedValue: String(existing.matchedValue ?? ""),
          });
          return;
        }
      }
      const newRecordId = Number(jClient?.recordId ?? jClient?.policyId ?? jClient?.id ?? 0);
      if (resClient.ok && newRecordId > 0) {
        setSelectedClientId(newRecordId);
        setSelectedClientNumber(String(jClient.recordNumber ?? jClient.policyNumber ?? newRecordId));
        setClientWasCreatedByButton(true);
        toast.success(
          `Client created: ${jClient.recordNumber ?? jClient.policyNumber ?? newRecordId}`,
        );
      } else {
        toast.error((jClient?.error as string) ?? "Failed to create client");
      }
    } catch {
      toast.error("Failed to create/find client");
    } finally {
      setCreatingClient(false);
    }
  }, [form, setSelectedClientId, clientFlowKey]);

  const evaluateStepShowWhen = React.useCallback(
    (
      rules?: {
        package: string;
        category?: string | string[];
        field?: string;
        fieldValues?: string[];
        requiresSelectedRecord?: boolean;
      }[],
    ): boolean => {
      if (!rules || rules.length === 0) return true;
      return rules.every((rule) => {
        if (rule.requiresSelectedRecord) {
          return !!selectedRecordId;
        }
        if (rule.field && rule.fieldValues) {
          const val = String(wizardFormValues[rule.field] ?? "");
          return rule.fieldValues.includes(val);
        }
        const catKey = `${rule.package}__category`;
        const current = String(wizardFormValues[catKey] ?? "");
        if (!current) return false;
        const allowed = Array.isArray(rule.category)
          ? rule.category
          : rule.category ? [rule.category] : [];
        if (allowed.length === 0) return true;
        return allowed.includes(current);
      });
    },
    [wizardFormValues, selectedRecordId],
  );

  const sorted = React.useMemo(
    () => [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [steps],
  );

  const { groups, wizardNums, hiddenSteps } = React.useMemo(() => {
    const grps: Record<number, StepRow[]> = {};
    const nums: number[] = [];
    const hidden: { n: number; label: string; reason: string }[] = [];

    const allDefined = sorted
      .map((s) => Number(s.meta?.wizardStep ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    let auto = allDefined.length > 0 ? Math.max(...allDefined) : 0;

    for (const s of sorted) {
      let n = Number(s.meta?.wizardStep ?? 0);
      if (!Number.isFinite(n) || n <= 0) n = ++auto;

      const rules = s.meta?.showWhen as { package: string; category?: string | string[]; requiresSelectedRecord?: boolean }[] | undefined;
      const pass = evaluateStepShowWhen(rules);

      if (pass) {
        if (!grps[n]) grps[n] = [];
        grps[n]!.push(s);
        if (!nums.includes(n)) nums.push(n);
      } else if (rules && rules.length > 0) {
        const reasons = rules.map((r) => {
          if (r.requiresSelectedRecord) return "requires selected record";
          const pkgLabel = pkgOptions.find((p) => p.value === r.package)?.label ?? r.package;
          const cats = Array.isArray(r.category) ? r.category : r.category ? [r.category] : [];
          return `${pkgLabel} = ${cats.join(" or ")}`;
        });
        hidden.push({
          n,
          label: s.meta?.wizardStepLabel || s.label,
          reason: reasons.join(", "),
        });
      }
    }
    return { groups: grps, wizardNums: nums.sort((a, b) => a - b), hiddenSteps: hidden };
  }, [sorted, evaluateStepShowWhen, pkgOptions]);

  const maxStep =
    wizardNums.length > 0 ? wizardNums[wizardNums.length - 1]! : 0;
  const currentGroup = groups[wizardStep] ?? [];
  const isFinal =
    wizardStep >= maxStep ||
    currentGroup.some((r) => Boolean(r.meta?.isFinal));

  const title =
    flowInfo?.meta?.dashboardLabel || flowInfo?.label || flowKey;

  const isEmbeddedClientStep = React.useMemo(() => {
    const sourceFlow = currentGroup.find((r) => r.meta?._sourceFlow)?.meta?._sourceFlow ?? "";
    return sourceFlow.toLowerCase().includes("client");
  }, [currentGroup]);

  // Derive recordPickerFlow: step-level override > flow-level meta > current flow
  const activeRecordPickerFlow = React.useMemo(() => {
    const selectedRowValue = selectedRowByStep[wizardStep];
    const row = currentGroup.length === 1
      ? currentGroup[0]
      : currentGroup.find((r) => r.value === selectedRowValue) ?? null;
    return row?.meta?.recordPickerFlow ?? flowInfo?.meta?.recordPickerFlow ?? undefined;
  }, [currentGroup, selectedRowByStep, wizardStep, flowInfo]);

  const effectiveRecordPickerFlow = activeRecordPickerFlow ?? flowKey;

  const recordPickerTitle = React.useMemo(() => {
    if (!activeRecordPickerFlow || activeRecordPickerFlow === flowKey) return title;
    const matchFlow = flowOptions.find((f) => f.value === activeRecordPickerFlow);
    return matchFlow?.meta?.dashboardLabel || matchFlow?.label || activeRecordPickerFlow;
  }, [activeRecordPickerFlow, flowKey, flowOptions, title]);

  const recordPickerButtonLabel = React.useMemo(() => {
    if (flowInfo?.meta?.recordPickerLabel) return flowInfo.meta.recordPickerLabel;
    return `Select Existing ${recordPickerTitle}`;
  }, [flowInfo, recordPickerTitle]);

  // Handle auto-scroll from PackageBlock (triggered by option scrollToPackage/scrollToGroup)
  const scrollToTarget = React.useCallback((target: string) => {
    const [sectionPart, fieldPart] = target.split("|field:");
    const fieldKey = fieldPart?.trim() || null;

    let sectionEl: Element | null = null;
    if (sectionPart.startsWith("pkg:")) {
      const pkgKey = sectionPart.slice(4);
      sectionEl = document.getElementById(`pkg-block-${pkgKey}`) ??
        document.querySelector(`[data-pkg-block="${pkgKey}"]`);
    } else if (sectionPart.startsWith("grp:")) {
      const grpName = sectionPart.slice(4);
      const slug = grpName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      sectionEl = document.querySelector(`[data-group-name="${grpName}"]`) ??
        document.querySelector(`[id*="pkg-group-"][id$="-${slug}"]`);
    }

    if (!sectionEl) return;

    const applyHighlight = (highlightEl: Element, inputEl?: Element | null) => {
      highlightEl.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightEl.classList.remove("endorsement-highlight");
      void (highlightEl as HTMLElement).offsetWidth;
      highlightEl.classList.add("endorsement-highlight");

      if (inputEl) {
        const dismiss = () => {
          highlightEl.classList.add("endorsement-highlight-fade");
          setTimeout(() => {
            highlightEl.classList.remove("endorsement-highlight", "endorsement-highlight-fade");
          }, 600);
          inputEl.removeEventListener("input", dismiss);
          inputEl.removeEventListener("change", dismiss);
        };
        inputEl.addEventListener("input", dismiss, { once: true });
        inputEl.addEventListener("change", dismiss, { once: true });
      }
    };

    if (fieldKey) {
      const pkgKey = sectionPart.startsWith("pkg:") ? sectionPart.slice(4) : "";
      const fieldName = pkgKey ? `${pkgKey}__${fieldKey}` : fieldKey;
      const fieldEl = sectionEl.querySelector(`[name="${fieldName}"]`) ??
        sectionEl.querySelector(`[name$="__${fieldKey}"]`) ??
        sectionEl.querySelector(`[data-field-key="${fieldKey}"]`);
      if (fieldEl) {
        let wrapper: Element | null = fieldEl;
        while (wrapper && wrapper !== sectionEl) {
          const parent: Element | null = wrapper.parentElement;
          if (parent?.classList.contains("grid") && parent.classList.contains("gap-4")) {
            break;
          }
          wrapper = parent;
        }
        if (!wrapper || wrapper === sectionEl) {
          wrapper = fieldEl.closest(".space-y-1, .space-y-2, .col-span-2") ?? fieldEl.parentElement;
        }
        applyHighlight(wrapper ?? fieldEl, fieldEl);
        return;
      }
    }

    // Highlight the entire section — stays until any input inside it changes
    sectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    sectionEl.classList.remove("endorsement-highlight");
    void (sectionEl as HTMLElement).offsetWidth;
    sectionEl.classList.add("endorsement-highlight");
    const dismissSection = () => {
      sectionEl!.classList.add("endorsement-highlight-fade");
      setTimeout(() => {
        sectionEl!.classList.remove("endorsement-highlight", "endorsement-highlight-fade");
      }, 600);
    };
    sectionEl.addEventListener("input", dismissSection, { once: true });
    sectionEl.addEventListener("change", dismissSection, { once: true });
  }, []);

  const handleAutoScrollGroup = React.useCallback((target: string, _pkg: string) => {
    pendingScrollGroupRef.current = target;

    const sectionPart = target.split("|field:")[0];
    const targetPkg = sectionPart.startsWith("pkg:") ? sectionPart.slice(4) : null;

    if (targetPkg) {
      let targetStep: number | null = null;
      for (const [stepNum, stepRows] of Object.entries(groups)) {
        for (const row of stepRows) {
          const pkgs = Array.isArray(row.meta?.packages) ? (row.meta!.packages as string[]) : [];
          if (pkgs.includes(targetPkg)) {
            targetStep = Number(stepNum);
            break;
          }
        }
        if (targetStep !== null) break;
      }

      if (targetStep !== null && targetStep !== wizardStep && wizardNums.includes(targetStep)) {
        setHighestCompleted((h) => Math.max(h, wizardStep));
        setWizardStep(targetStep);
        return;
      }
    }

    requestAnimationFrame(() => scrollToTarget(target));
  }, [scrollToTarget, groups, wizardStep, wizardNums]);

  const goto = (step: number) => {
    if (step < wizardStep) {
      setWizardStep(step);
      return;
    }
    if (step > wizardStep) {
      toast.error("Please use the Continue button to proceed.");
    }
  };

  const saveClientChanges = React.useCallback(async () => {
    if (!selectedClientId) return;
    setSavingClient(true);
    try {
      const values = form.getValues() as Record<string, unknown>;
      const insuredOut: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined || v === null) continue;
        if (typeof v === "string" && v.trim() === "") continue;
        const lower = k.toLowerCase();
        if (
          lower.startsWith("insured_") || lower.startsWith("insured__") ||
          lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")
        ) {
          insuredOut[k] = v;
        }
      }
      const insuredType = values.insuredType ?? values["insured__category"];
      if (insuredType) insuredOut.insuredType = insuredType;

      const res = await fetch(`/api/policies/${selectedClientId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ insured: insuredOut }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string })?.error ?? "Save failed");
      }
      loadedSnapshotRef.current = JSON.stringify(form.getValues());
      toast.success("Client data saved", { duration: 1500 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save client");
    } finally {
      setSavingClient(false);
    }
  }, [form, selectedClientId]);

  const proceedToNextStep = React.useCallback(() => {
    setHighestCompleted((h) => Math.max(h, wizardStep));
    const nextNums = wizardNums.filter((n) => n > wizardStep);
    if (nextNums.length > 0) {
      setWizardStep(nextNums[0]!);
    }
  }, [wizardStep, wizardNums]);

  // After step transition, scroll+highlight the pending target (e.g. from endorsement change type)
  React.useEffect(() => {
    if (!pendingScrollGroupRef.current) return;
    const target = pendingScrollGroupRef.current;
    let attempt = 0;
    const maxAttempts = 5;
    const tryScroll = () => {
      attempt++;
      scrollToTarget(target);
      if (attempt < maxAttempts) {
        const sectionPart = target.split("|field:")[0];
        const exists = sectionPart.startsWith("pkg:")
          ? document.querySelector(`[data-pkg-block="${sectionPart.slice(4)}"]`)
          : document.querySelector(`[data-group-name="${sectionPart.slice(4)}"]`);
        if (!exists) setTimeout(tryScroll, 400);
      }
    };
    const timer = setTimeout(tryScroll, 500);
    return () => clearTimeout(timer);
  }, [wizardStep, scrollToTarget]);

  // Returns true when the client was created (or already exists and was
  // resolved here via setSelectedClientId), false when the duplicate
  // dialog was opened OR an error toast was shown. Callers use the
  // return value to decide whether to advance to the next wizard step
  // — without this gate, the duplicate dialog would open and the
  // wizard would simultaneously navigate forward, leaving the user
  // on the wrong step with the dialog still mounted.
  const doCreateClientFromForm = async (): Promise<boolean> => {
    const values = form.getValues() as Record<string, unknown>;
    const getVal = (key: string): unknown => {
      const direct = values[key];
      if (typeof direct !== "undefined") return direct;
      const lower = key.toLowerCase();
      for (const [k, v] of Object.entries(values)) {
        if (k.toLowerCase() === lower) return v;
      }
      return undefined;
    };
    const pickByTokens = (tokens: string[]): unknown => {
      for (const [k, v] of Object.entries(values)) {
        const nk = k.toLowerCase();
        if (tokens.some((t) => nk.includes(t))) {
          if (typeof v === "string" && v.trim().length > 0) return v;
        }
      }
      return undefined;
    };

    const insuredPayload: Record<string, unknown> = {
      insuredType: (getVal("insuredType") ?? getVal("insured__category") ?? values.insuredType) as unknown,
    };
    const insuredType = String(insuredPayload.insuredType ?? "").trim();
    if (insuredType === "company") {
      insuredPayload.companyName =
        getVal("companyName") ?? pickByTokens(["companyname", "company"]);
      insuredPayload.brNumber =
        getVal("brNumber") ?? pickByTokens(["brnumber", "businessreg"]);
    } else if (insuredType === "personal") {
      const firstName = getVal("firstName") ?? pickByTokens(["firstname"]);
      const lastName = getVal("lastName") ?? pickByTokens(["lastname", "surname"]);
      const nameField = getVal("fullName") ?? pickByTokens(["fullname", "name"]);
      insuredPayload.fullName =
        typeof nameField === "string" && nameField.trim()
          ? nameField
          : [lastName, firstName]
              .map((x) => (typeof x === "string" ? x.trim() : ""))
              .filter(Boolean)
              .join(" ");
      insuredPayload.idNumber = getVal("idNumber") ?? pickByTokens(["hkid", "idnumber"]);
    }

    const insuredOut: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && !v.trim()) continue;
      const lower = k.toLowerCase();
      if (
        lower.startsWith("insured_") ||
        lower.startsWith("insured__") ||
        lower.startsWith("contactinfo_") ||
        lower.startsWith("contactinfo__")
      ) {
        insuredOut[k] = v;
      }
    }
    if (insuredType) insuredOut.insuredType = insuredType;
    const targetFlow = clientFlowKey || "clientSet";
    try {
      const resClient = await fetch("/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ insured: insuredOut, flowKey: targetFlow }),
      });
      const jClient = (await resClient.json().catch(() => ({}))) as Record<string, unknown>;
      // Same DUPLICATE_CLIENT guard as handleCreateClient — see that
      // function for the rationale. We share the dialog state so the
      // user gets the same UX whether they triggered the create from
      // the explicit "Create Client" button or from the implicit
      // "Continue" path that auto-creates when no existing client is
      // selected (handleContinue → doCreateClientFromForm).
      if (resClient.status === 409 && jClient?.code === "DUPLICATE_CLIENT") {
        const existing = jClient.existingClient as
          | { id?: number; policyNumber?: string; displayName?: string; matchedField?: string; matchedValue?: string }
          | undefined;
        if (existing && Number.isFinite(Number(existing.id)) && Number(existing.id) > 0) {
          setDuplicateClient({
            id: Number(existing.id),
            policyNumber: String(existing.policyNumber ?? ""),
            displayName: String(existing.displayName ?? ""),
            matchedField: String(existing.matchedField ?? "ID"),
            matchedValue: String(existing.matchedValue ?? ""),
          });
          return false;
        }
      }
      const newRecordId = Number((jClient as any)?.recordId ?? (jClient as any)?.policyId ?? (jClient as any)?.id ?? 0);
      if (resClient.ok && newRecordId > 0) {
        setSelectedClientId(newRecordId);
        setSelectedClientNumber(String((jClient as any).recordNumber ?? (jClient as any).policyNumber ?? newRecordId));
        toast.success(`Client created: ${(jClient as any).recordNumber ?? (jClient as any).policyNumber ?? newRecordId}`);
        return true;
      }
      toast.error((jClient as any)?.error ?? "Failed to create client");
      return false;
    } catch {
      toast.error("Failed to create/find client");
      return false;
    }
  };

  const handleContinue = async () => {
    if (isCreateNewClientMode && !selectedClientId) {
      toast.error("Please click \"Create Client\" to create the client first.");
      return;
    }

    if (isEmbeddedClientStep && selectedClientId && loadedSnapshotRef.current) {
      const currentValues = JSON.stringify(form.getValues());
      if (currentValues !== loadedSnapshotRef.current) {
        pendingContinueRef.current = proceedToNextStep;
        setConfirmClientSaveOpen(true);
        return;
      }
    }

    const values = form.getValues() as Record<string, unknown>;
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

    // Check if explicit "create new" was selected via a toggle field
    let shouldCreateClient = false;
    if (!selectedClientId) {
      for (const [k, v] of Object.entries(values)) {
        const nk = normalize(k);
        const isField =
          nk.includes("existorcreateclient") ||
          nk.includes("newexistingclient") ||
          nk.includes("neworexistingclient");
        if (!isField) continue;
        const nv = normalize(String(v ?? ""));
        if (nv.includes("create") || nv.includes("new")) {
          shouldCreateClient = true;
          break;
        }
      }
    }

    if (shouldCreateClient) {
      const ok = await doCreateClientFromForm();
      if (ok) proceedToNextStep();
      return;
    }

    // On a client step without a selected client, prompt the user
    if (!selectedClientId && (hasClientStep || isEmbeddedClientStep)) {
      setConfirmNewClientOpen(true);
      return;
    }

    proceedToNextStep();
  };

  const doSubmit = React.useCallback(async (isUpdate: boolean) => {
    setSubmitting(true);
    try {
      const values = form.getValues() as Record<string, unknown>;
      const packagesPayload: Record<
        string,
        { category?: string; values: Record<string, unknown> }
      > = {};

      for (const stepRows of Object.values(groups)) {
        for (const row of stepRows) {
          const pkgs = Array.isArray(row.meta?.packages)
            ? (row.meta!.packages as string[])
            : [];
          for (const p of pkgs) {
            const prefix = `${p}__`;
            const pkgValues: Record<string, unknown> = {};
            let categoryValue: string | undefined;
            const cv = values[`${p}__category`];
            if (cv !== undefined && cv !== null && String(cv).trim()) {
              categoryValue = String(cv);
            }
            for (const [k, v] of Object.entries(values)) {
              if (k.startsWith(prefix) && k !== `${p}__category` && !k.includes("___linked")) {
                pkgValues[k] = v;
              }
            }
            if (Object.keys(pkgValues).length > 0 || categoryValue) {
              packagesPayload[p] = {
                category: categoryValue,
                values: pkgValues,
              };
            }
          }
        }
      }

      const insuredSnapshot: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined || v === null) continue;
        const lower = k.toLowerCase();
        if (
          lower.startsWith("insured_") ||
          lower.startsWith("insured__") ||
          lower.startsWith("contactinfo_") ||
          lower.startsWith("contactinfo__")
        ) {
          insuredSnapshot[k] = v;
        }
      }
      const resolvedInsuredType =
        values.insuredType ??
        values["insured__category"] ??
        values["insured_category"];
      if (resolvedInsuredType) insuredSnapshot.insuredType = resolvedInsuredType;

      // Store client reference as snapshot metadata (not as FK to old clients table)
      if (selectedClientId) {
        insuredSnapshot.clientPolicyId = selectedClientId;
        if (selectedClientNumber) insuredSnapshot.clientPolicyNumber = selectedClientNumber;
      }

      const selectedAgentId = Number(values._agentId);
      const agentIdPayload = Number.isFinite(selectedAgentId) && selectedAgentId > 0
        ? { policy: { agentId: selectedAgentId } }
        : {};

      let resultPolicyId: number | null = null;

      // Determine if this is an endorsement-style flow (recordPickerFlow from another flow)
      // Premium packages are always treated as own-flow so endorsements get separate premium records
      const PREMIUM_PKG_KEYS = new Set(["premiumRecord", "accounting"]);
      let recordPickerFlowValue: string | null = null;
      const ownFlowPkgs = new Set<string>();
      const embeddedPkgs = new Set<string>();
      for (const stepRows of Object.values(groups)) {
        for (const row of stepRows) {
          const rpf = row.meta?.recordPickerFlow;
          if (rpf && rpf !== flowKey) recordPickerFlowValue = rpf;
          const pkgs = Array.isArray(row.meta?.packages) ? (row.meta!.packages as string[]) : [];
          const isEmbedded = !!row.meta?._sourceFlow;
          for (const p of pkgs) {
            if (PREMIUM_PKG_KEYS.has(p) || !isEmbedded) ownFlowPkgs.add(p);
            else embeddedPkgs.add(p);
          }
        }
      }

      // Also check selectedRecordFlowRef as fallback for recordPickerFlowValue
      if (!recordPickerFlowValue && selectedRecordFlowRef.current) {
        recordPickerFlowValue = selectedRecordFlowRef.current;
      }

      const effectiveRecordId = selectedRecordId;

      // Endorsement: cross-flow record picker + selected record (works with or without embedding)
      const isEndorsement = !!recordPickerFlowValue && !!effectiveRecordId;

      console.log("[doSubmit endorsement debug]", {
        isEndorsement,
        recordPickerFlowValue,
        selectedRecordId,
        effectiveRecordId,
        ownFlowPkgs: [...ownFlowPkgs],
        embeddedPkgs: [...embeddedPkgs],
        selectedRecordPkgs: selectedRecordPkgsRef.current ? [...selectedRecordPkgsRef.current] : null,
        allPackageKeys: Object.keys(packagesPayload),
        stepsWithSourceFlow: steps.filter((s) => !!s.meta?._sourceFlow).map((s) => ({ label: s.label, sourceFlow: s.meta?._sourceFlow, pkgs: s.meta?.packages })),
      });

      if (isEndorsement && effectiveRecordId) {
        // Endorsement: POST endorsement record + PATCH original policy with changes
        const orderTypePkgs: typeof packagesPayload = {};
        const policyPkgs: typeof packagesPayload = {};

        if (embeddedPkgs.size > 0) {
          // Embedded flow mode: use embedded vs own-flow split
          for (const [pkg, data] of Object.entries(packagesPayload)) {
            if (embeddedPkgs.has(pkg)) policyPkgs[pkg] = data;
            else orderTypePkgs[pkg] = data;
          }
        } else {
          // Non-embedded mode: use selected record's packages to determine policy vs endorsement
          const recordPkgs = selectedRecordPkgsRef.current;
          for (const [pkg, data] of Object.entries(packagesPayload)) {
            if (PREMIUM_PKG_KEYS.has(pkg)) {
              orderTypePkgs[pkg] = data;
            } else if (recordPkgs?.has(pkg)) {
              policyPkgs[pkg] = data;
            } else {
              orderTypePkgs[pkg] = data;
            }
          }
        }

        console.log("[doSubmit split]", {
          orderTypePkgKeys: Object.keys(orderTypePkgs),
          policyPkgKeys: Object.keys(policyPkgs),
        });

        // Compute endorsement changes (old → new) for policy fields
        const policyPkgKeys = new Set(Object.keys(policyPkgs));
        const endorsementChanges: { field: string; from: unknown; to: unknown }[] = [];
        if (loadedSnapshotRef.current) {
          const oldValues = JSON.parse(loadedSnapshotRef.current) as Record<string, unknown>;
          const currentValues = form.getValues() as Record<string, unknown>;
          for (const key of Object.keys(currentValues)) {
            if (key.startsWith("_") || key.endsWith("__category") || key.includes("___linked")) continue;
            const isPolicyField = [...policyPkgKeys].some((p) => key.startsWith(`${p}__`));
            if (!isPolicyField) continue;
            const oldVal = oldValues[key];
            const newVal = currentValues[key];
            const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
            if (isEmpty(oldVal) && isEmpty(newVal)) continue;
            if (JSON.stringify(oldVal ?? null) !== JSON.stringify(newVal ?? null)) {
              endorsementChanges.push({ field: key, from: oldVal ?? null, to: newVal ?? null });
            }
          }
        }

        // 1. Create the endorsement record with ALL packages (full snapshot)
        const postRes = await fetch("/api/policies", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            packages: packagesPayload,
            insured: insuredSnapshot,
            flowKey,
            linkedPolicyId: effectiveRecordId,
            endorsementChanges: endorsementChanges.length > 0 ? endorsementChanges : undefined,
            ...agentIdPayload,
          }),
        });
        const postJson = (await postRes.json().catch(() => ({}))) as { error?: string; policyId?: number; recordId?: number };
        if (!postRes.ok) {
          throw new Error(postJson?.error ?? "Failed to create endorsement record");
        }

        // 2. Update the original policy — only send packages with actual changes
        const changedPkgs: typeof policyPkgs = {};
        if (loadedSnapshotRef.current) {
          const oldValues = JSON.parse(loadedSnapshotRef.current) as Record<string, unknown>;
          for (const [pkg, data] of Object.entries(policyPkgs)) {
            const changedValues: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(data.values)) {
              if (JSON.stringify(oldValues[k] ?? null) !== JSON.stringify(v ?? null)) {
                changedValues[k] = v;
              }
            }
            if (Object.keys(changedValues).length > 0) {
              changedPkgs[pkg] = { ...data, values: changedValues };
            }
          }
        } else {
          Object.assign(changedPkgs, policyPkgs);
        }

        if (Object.keys(changedPkgs).length > 0) {
          const patchRes = await fetch(`/api/policies/${effectiveRecordId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              packages: changedPkgs,
              ...agentIdPayload,
            }),
          });
          if (!patchRes.ok) {
            const patchJson = (await patchRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(patchJson?.error ?? "Failed to update policy");
          }
        }

        resultPolicyId = postJson.recordId ?? postJson.policyId ?? null;
        toast.success("Endorsement created & original record updated", { duration: 2000 });
      } else if (isUpdate && selectedRecordId) {
        const res = await fetch(`/api/policies/${selectedRecordId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            packages: packagesPayload,
            insured: insuredSnapshot,
            flowKey,
            ...agentIdPayload,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; policyId?: number; recordId?: number };
        if (!res.ok) {
          throw new Error(json?.error ?? "Update failed");
        }
        resultPolicyId = json.recordId ?? json.policyId ?? selectedRecordId;
        toast.success(`${title} updated`, { duration: 1500 });
      } else {
        const res = await fetch("/api/policies", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            packages: packagesPayload,
            insured: insuredSnapshot,
            flowKey,
            ...agentIdPayload,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; policyId?: number; recordId?: number };
        if (!res.ok) {
          throw new Error(json?.error ?? "Submit failed");
        }
        resultPolicyId = json.recordId ?? json.policyId ?? null;
        toast.success(`${title} created`, { duration: 1500 });
      }

      // Redirect: endorsement → original policy; otherwise → current flow
      if (effectiveRecordId && recordPickerFlowValue) {
        router.push(`/dashboard/flows/${encodeURIComponent(recordPickerFlowValue)}?open=${effectiveRecordId}`);
      } else if (resultPolicyId) {
        router.push(`/dashboard/flows/${encodeURIComponent(flowKey)}?open=${resultPolicyId}`);
      } else {
        router.push(`/dashboard/flows/${encodeURIComponent(flowKey)}`);
      }
    } catch (err: unknown) {
      const message =
        (err as { message?: string } | undefined)?.message ??
        "Submit failed";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- steps used for debug logging only
  }, [form, groups, selectedRecordId, selectedClientId, flowKey, router]);

  const handleFinish = async () => {
    if (isCreateNewClientMode && !selectedClientId) {
      toast.error("Please click \"Create Client\" to create the client first.");
      return;
    }

    // Endorsement-style flow: always POST new + PATCH original (no confirm dialog)
    const hasCrossFlowPicker = (() => {
      for (const stepRows of Object.values(groups)) {
        for (const row of stepRows) {
          if (row.meta?.recordPickerFlow && row.meta.recordPickerFlow !== flowKey) return true;
        }
      }
      return !!selectedRecordFlowRef.current;
    })();
    if (hasCrossFlowPicker && !selectedRecordId) {
      toast.error("Please select an existing policy to endorse first.");
      return;
    }
    if (selectedRecordId && hasCrossFlowPicker) {
      void doSubmit(false);
      return;
    }

    if (selectedRecordId) {
      const currentValues = JSON.stringify(form.getValues());
      if (loadedSnapshotRef.current && currentValues !== loadedSnapshotRef.current) {
        setConfirmUpdateOpen(true);
        return;
      }
      void doSubmit(true);
      return;
    }
    void doSubmit(false);
  };

  const displayNumMap = React.useMemo(() => {
    const map: Record<number, number> = {};
    wizardNums.forEach((n, i) => { map[n] = i + 1; });
    return map;
  }, [wizardNums]);

  const stepLabel = React.useMemo(() => {
    const group = currentGroup;
    const totalSteps = wizardNums.length;
    const dn = displayNumMap[wizardStep] ?? wizardStep;
    const base = totalSteps <= 1 ? title : `${title} — Step ${dn}`;
    if (group.length === 0) return base;
    const stepLbl = String(
      group.find(
        (r) =>
          typeof r.meta?.wizardStepLabel === "string" &&
          r.meta?.wizardStepLabel,
      )?.meta?.wizardStepLabel ?? "",
    ).trim();
    if (stepLbl) return totalSteps <= 1 ? `${title}: ${stepLbl}` : `${base}: ${stepLbl}`;
    return base;
  }, [title, wizardStep, currentGroup, wizardNums, displayNumMap]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full rounded-lg" />
      </div>
    );
  }

  if (!flowInfo) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-neutral-500 dark:text-neutral-400">
              Flow &ldquo;{flowKey}&rdquo; not found.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => router.back()}
            >
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-neutral-500 dark:text-neutral-400">
              No steps configured for &ldquo;{title}&rdquo;. Please
              configure steps in the admin panel under Flows &rarr;{" "}
              {title} &rarr; Steps.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => router.back()}
            >
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const requiresSelection = currentGroup.length > 1;
  const selectedRowValue = selectedRowByStep[wizardStep];
  const selectedRow =
    currentGroup.length === 1
      ? currentGroup[0]
      : currentGroup.find((r) => r.value === selectedRowValue) ?? null;

  const activePkgs = (() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of currentGroup) {
      const pkgs = Array.isArray(row.meta?.packages)
        ? (row.meta!.packages as string[])
        : [];
      const pkgShowWhen = (row.meta?.packageShowWhen ?? {}) as Record<
        string,
        { package: string; category: string | string[]; field?: string; fieldValues?: string[] }[]
      >;
      const catShowWhen = (row.meta?.categoryShowWhen ?? {}) as Record<string, unknown[]>;
      const isSelected = selectedRow ? row === selectedRow : row === currentGroup[0];
      if (!isSelected && currentGroup.length > 1) continue;
      for (const p of pkgs) {
        if (!p || seen.has(p)) continue;
        if (!pkgOptions.some((po) => po.value === p)) continue;
        const hasCatConds = Object.keys(catShowWhen).some(
          (k) => k.startsWith(`${p}__`) && (catShowWhen[k]?.length ?? 0) > 0,
        );
        if (!hasCatConds) {
          const rules = pkgShowWhen[p];
          if (rules && rules.length > 0) {
            const pass = rules.every((rule) => {
              if (rule.field && rule.fieldValues) {
                const fieldKey = rule.package ? `${rule.package}__${rule.field}` : rule.field;
                const val = String(wizardFormValues[fieldKey] ?? "");
                return rule.fieldValues.includes(val);
              }
              const catKey = `${rule.package}__category`;
              const currentVal = String(wizardFormValues[catKey] ?? "");
              if (!currentVal) return false;
              const allowed = Array.isArray(rule.category)
                ? rule.category
                : [rule.category];
              return allowed.includes(currentVal);
            });
            if (!pass) continue;
          }
        }
        seen.add(p);
        result.push(p);
      }
    }
    return result;
  })();

  const allSelectedBranches = new Set(
    Object.entries(selectedRowByStep)
      .filter(([stepNum]) => Number(stepNum) !== wizardStep)
      .map(([, val]) => val)
      .filter(Boolean) as string[],
  );

  const hasAddressFields = Object.keys(addressFieldMap).length > 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {wizardNums.length > 1 ? wizardNums.map((n, i) => (
            <StepDot
              key={n}
              n={i + 1}
              active={wizardStep === n}
              done={highestCompleted >= n}
              onClick={() => goto(n)}
            />
          )) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasAddressFields ? (
            <AddressTool
              form={form}
              fieldMap={addressFieldMap}
              areaOptions={areaOptions}
            />
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (hasClientStep || isEmbeddedClientStep) ? setClientPickerOpen(true) : setRecordPickerOpen(true)}
          >
            {(hasClientStep || isEmbeddedClientStep) ? "Select Existing Client" : recordPickerButtonLabel}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-yellow-500">{stepLabel}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {selectedRecordId ? (
            <div className="rounded-md border p-2 text-sm flex items-center justify-between border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              <span>
                Existing {title} record loaded.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="underline text-xs"
                  onClick={() => {
                    setSelectedRecordId(null);
                    selectedRecordPkgsRef.current = null;
                    setRecordPickerOpen(true);
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  className="underline text-xs text-red-600 dark:text-red-400"
                  onClick={() => {
                    setSelectedRecordId(null);
                    selectedRecordPkgsRef.current = null;
                    const vals = form.getValues() as Record<string, unknown>;
                    for (const k of Object.keys(vals)) {
                      const lower = k.toLowerCase();
                      if (
                        lower.startsWith("insured_") || lower.startsWith("insured__") ||
                        lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__") ||
                        lower === "insuredtype" ||
                        lower.endsWith("__category") ||
                        lower.startsWith("_")
                      ) continue;
                      try {
                        form.setValue(k as never, "" as never, { shouldDirty: false });
                        form.resetField(k as never, { defaultValue: "" as never });
                      } catch {}
                    }
                    loadedSnapshotRef.current = JSON.stringify(form.getValues());
                    toast.success("Selection cleared", { duration: 1500 });
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : selectedClientId ? (
            <div className={`rounded-md border p-2 text-sm flex items-center justify-between ${
              clientWasCreatedByButton
                ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300"
                : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
            }`}>
              <span>
                Client {selectedClientNumber || `#${selectedClientId}`} {clientWasCreatedByButton ? "created successfully" : "selected"}.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="underline text-xs"
                  onClick={() => {
                    setClientWasCreatedByButton(false);
                    setSelectedClientId(null);
                    setSelectedClientNumber("");
                    setClientPickerOpen(true);
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  className="underline text-xs text-red-600 dark:text-red-400"
                  onClick={() => {
                    setClientWasCreatedByButton(false);
                    setSelectedClientId(null);
                    setSelectedClientNumber("");
                    pendingClientFillRef.current = null;
                    const vals = form.getValues() as Record<string, unknown>;
                    for (const k of Object.keys(vals)) {
                      const lower = k.toLowerCase();
                      if (
                        lower.startsWith("insured_") || lower.startsWith("insured__") ||
                        lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")
                      ) {
                        try {
                          form.setValue(k as never, "" as never, { shouldDirty: false });
                          form.resetField(k as never, { defaultValue: "" as never });
                        } catch {}
                      }
                    }
                    try {
                      form.setValue("insuredType" as never, "" as never, { shouldDirty: false });
                      form.resetField("insuredType" as never, { defaultValue: "" as never });
                    } catch {}
                    loadedSnapshotRef.current = JSON.stringify(form.getValues());
                    toast.success("Client selection cleared", { duration: 1500 });
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}

          {currentGroup.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              No content for this step.
            </p>
          ) : (
            <div className="space-y-8">
              {requiresSelection ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Choose:</span>
                  <div className="flex flex-wrap items-center gap-4">
                    {currentGroup.map((r) => (
                      <label
                        key={r.value}
                        className="inline-flex items-center gap-2 text-sm"
                      >
                        <input
                          type="radio"
                          className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black"
                          value={r.value}
                          checked={selectedRowValue === r.value}
                          onChange={(e) =>
                            setSelectedRowByStep((m) => ({
                              ...m,
                              [wizardStep]: e.target.value || undefined,
                            }))
                          }
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {!selectedRow && requiresSelection ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Please select an option above to continue.
                </p>
              ) : activePkgs.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No packages configured for this step.
                </p>
              ) : (
                activePkgs.map((p, pIdx) => {
                  const row = selectedRow ?? currentGroup[0]!;
                  const pkgCats = (row.meta?.packageCategories ??
                    {}) as Record<string, string[]>;
                  const csv = (row.meta?.categoryStepVisibility ??
                    {}) as Record<string, string[]>;
                  const catShowWhen = (row.meta?.categoryShowWhen ??
                    {}) as Record<string, { package: string; category: string | string[] }[]>;
                  const pkgGrpHidden = (row.meta?.packageGroupLabelsHidden ?? {}) as Record<string, boolean>;
                  const baseCats = pkgCats[p];
                  let finalCats = baseCats;
                  if (
                    Object.keys(csv).length > 0 &&
                    allSelectedBranches.size > 0
                  ) {
                    const csvFiltered = Object.entries(csv)
                      .filter(([, targets]) =>
                        targets.some((ts) => allSelectedBranches.has(ts)),
                      )
                      .map(([catVal]) => catVal);
                    finalCats = baseCats
                      ? baseCats.filter((c) => csvFiltered.includes(c))
                      : csvFiltered;
                  }
                  if (finalCats && Object.keys(catShowWhen).length > 0) {
                    finalCats = finalCats.filter((catVal) => {
                      const rules = catShowWhen[`${p}__${catVal}`];
                      if (!rules || rules.length === 0) return true;
                      return rules.every((rule) => {
                        const catKey = `${rule.package}__category`;
                        const currentVal = String(wizardFormValues[catKey] ?? "");
                        if (!currentVal) return false;
                        const allowed = Array.isArray(rule.category)
                          ? rule.category
                          : rule.category ? [rule.category] : [];
                        if (allowed.length === 0) return true;
                        return allowed.includes(currentVal);
                      });
                    });
                  }
                  if (Array.isArray(finalCats) && finalCats.length === 0) return null;
                  return (
                    <PackageBlock
                      key={`${p}_${pIdx}`}
                      form={form}
                      pkg={p}
                      allowedCategories={finalCats}
                      isAdmin={userType === "admin"}
                      viewerUserType={userType ?? undefined}
                      hideGroupLabels={!!pkgGrpHidden[p]}
                      onAutoScrollGroup={handleAutoScrollGroup}/>
                  );
                })
              )}
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => router.push(`/dashboard/flows/${encodeURIComponent(flowKey)}`)}>
              <X className="h-4 w-4 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
            {wizardStep > (wizardNums[0] ?? 1) ? (
              <Button
                variant="outline"
                onClick={() => {
                  pendingScrollGroupRef.current = null;
                  const prev = [...wizardNums]
                    .reverse()
                    .find((n) => n < wizardStep);
                  if (prev !== undefined) setWizardStep(prev);
                }}
              >
                <ArrowLeft className="h-4 w-4 sm:hidden lg:inline" />
                <span className="hidden sm:inline">Back</span>
              </Button>
            ) : null}
            {!selectedClientId ? (
              isCreateNewClientMode ? (
                <Button variant="secondary" onClick={handleCreateClient} disabled={creatingClient}>
                  {creatingClient ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4 sm:hidden lg:inline" />
                  )}
                  <span className="hidden sm:inline">{creatingClient ? "Creating…" : "Create Client"}</span>
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => (hasClientStep || isEmbeddedClientStep) ? setClientPickerOpen(true) : setRecordPickerOpen(true)}>
                  <UserSearch className="h-4 w-4 sm:hidden lg:inline" />
                  <span className="hidden sm:inline">{(hasClientStep || isEmbeddedClientStep) ? "Select Existing Client" : recordPickerButtonLabel}</span>
                </Button>
              )
            ) : null}
            {isFinal ? (
              <Button onClick={handleFinish} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 sm:hidden lg:inline" />
                )}
                <span className="hidden sm:inline">{submitting ? "Submitting…" : "Finish"}</span>
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (requiresSelection && !selectedRowValue) {
                    toast.error("Please choose an option to continue.");
                    return;
                  }
                  void handleContinue();
                }}
              >
                <ArrowRight className="h-4 w-4 sm:hidden lg:inline" />
                <span className="hidden sm:inline">Continue</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Client picker drawer */}
      <Drawer
        open={clientPickerOpen}
        onOpenChange={(open) => {
          if (open) {
            setClientPickerOpen(true);
          } else {
            setClientDrawerOpen(false);
            setTimeout(() => setClientPickerOpen(false), 320);
          }
        }}
        overlayClassName={`transition-opacity duration-300 ${clientDrawerOpen ? "opacity-60" : "opacity-0"}`}
      >
        <DrawerContent
          className={`${clientDrawerOpen ? "translate-x-0" : "-translate-x-full"} w-[280px] sm:w-[320px] md:w-[380px]`}
        >
          <DrawerHeader>
            <DrawerTitle>Select Existing Client</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-3 p-4">
            <Input
              placeholder="Search by client no., name, category…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
            />
            <div className="max-h-[65vh] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
              {loadingClients ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-5/6" />
                  <Skeleton className="h-6 w-4/6" />
                </div>
              ) : filteredClients.length === 0 ? (
                <div className="p-3 text-sm text-neutral-500 dark:text-neutral-400">
                  No clients found.
                </div>
              ) : (
                <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {filteredClients.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                          {r.clientNumber}
                        </div>
                        <div className="truncate">{r.displayName}</div>
                        <div className="text-xs capitalize text-neutral-500 dark:text-neutral-400">
                          {r.category}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void chooseExistingClient(r.id)}
                      >
                        Select
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Record picker drawer (flow-specific) */}
      <Drawer
        open={recordPickerOpen}
        onOpenChange={(open) => {
          if (open) {
            setRecordPickerOpen(true);
          } else {
            setRecordDrawerOpen(false);
            setTimeout(() => setRecordPickerOpen(false), 320);
          }
        }}
        overlayClassName={`transition-opacity duration-300 ${recordDrawerOpen ? "opacity-60" : "opacity-0"}`}
      >
        <DrawerContent
          className={`${recordDrawerOpen ? "translate-x-0" : "-translate-x-full"} w-[280px] sm:w-[320px] md:w-[380px]`}
        >
          <DrawerHeader>
            <DrawerTitle>{recordPickerButtonLabel}</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-3 p-4">
            <Input
              placeholder="Search by name or record number…"
              value={recordSearch}
              onChange={(e) => setRecordSearch(e.target.value)}
            />
            <div className="max-h-[65vh] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
              {loadingRecords ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-5/6" />
                  <Skeleton className="h-6 w-4/6" />
                </div>
              ) : filteredRecords.length === 0 ? (
                <div className="p-3 text-sm text-neutral-500 dark:text-neutral-400">
                  No existing {recordPickerTitle.toLowerCase()} records found.
                </div>
              ) : (
                <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {filteredRecords.map((r) => (
                    <li
                      key={r.policyId}
                      className="flex items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        {r.displayName && (
                          <div className="text-xs font-medium wrap-break-word">{r.displayName}</div>
                        )}
                        <div className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
                          {r.policyNumber}
                        </div>
                        <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void chooseExistingRecord(r.policyId)}
                      >
                        Select
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Confirm update dialog */}
      <Dialog open={confirmUpdateOpen} onOpenChange={setConfirmUpdateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Existing Record</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            You are about to update an existing <strong>{title}</strong> record. This will overwrite the current data with your changes.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUpdateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmUpdateOpen(false);
                void doSubmit(true);
              }}
            >
              Confirm &amp; Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm new client creation dialog */}
      <Dialog open={confirmNewClientOpen} onOpenChange={setConfirmNewClientOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a New Client?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            You have not selected an existing client. Would you like to create a new client with the information you entered, or go back and select an existing client?
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmNewClientOpen(false);
                (hasClientStep || isEmbeddedClientStep) ? setClientPickerOpen(true) : setRecordPickerOpen(true);
              }}
            >
              Select Existing Client
            </Button>
            <Button
              onClick={async () => {
                setConfirmNewClientOpen(false);
                const ok = await doCreateClientFromForm();
                if (ok) proceedToNextStep();
              }}
            >
              Create New Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate-client guard dialog — opened when /api/policies POST
          returns 409 (server-side dedupe matched an existing client by
          CI/BR for companies, HKID for personal). Hard-block per
          product spec: the user MUST either pick the existing client
          or cancel and edit the form — they cannot create a duplicate.
          The "Use Existing Client" path reuses chooseExistingClient so
          the form is rehydrated from the matched record exactly as if
          the user had picked it from the drawer. */}
      <Dialog
        open={!!duplicateClient}
        onOpenChange={(open) => {
          if (!open) setDuplicateClient(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate Client Found</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
            <p>
              A client with this <strong>{duplicateClient?.matchedField}</strong>
              {duplicateClient?.matchedValue ? (
                <>
                  {" "}(<span className="font-mono uppercase">{duplicateClient.matchedValue}</span>)
                </>
              ) : null}{" "}
              already exists.
            </p>
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="font-medium text-neutral-900 dark:text-neutral-100">
                {duplicateClient?.displayName || "(no name)"}
              </div>
              <div className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                {duplicateClient?.policyNumber}
              </div>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              To prevent duplicate client records, please use the existing client
              instead of creating a new one.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDuplicateClient(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const id = duplicateClient?.id;
                setDuplicateClient(null);
                if (id) {
                  await chooseExistingClient(id);
                }
              }}
            >
              <UserSearch className="h-4 w-4 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Use Existing Client</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm client save dialog (embedded step) */}
      <Dialog open={confirmClientSaveOpen} onOpenChange={setConfirmClientSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Client Changes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            You have modified the client data. Would you like to save these changes before continuing?
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmClientSaveOpen(false);
                pendingContinueRef.current?.();
                pendingContinueRef.current = null;
              }}
            >
              Skip
            </Button>
            <Button
              disabled={savingClient}
              onClick={async () => {
                await saveClientChanges();
                setConfirmClientSaveOpen(false);
                pendingContinueRef.current?.();
                pendingContinueRef.current = null;
              }}
            >
              {savingClient ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {savingClient ? "Saving…" : "Save & Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
