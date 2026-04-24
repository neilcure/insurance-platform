"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { deepEqual, formSnapshot } from "@/lib/form-utils";
import type { ShowWhenRule } from "@/lib/types/form";

type StepRow = {
  id: number;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  meta: {
    packages?: string[];
    packageCategories?: Record<string, string[]>;
    packageShowWhen?: Record<string, ShowWhenRule[]>;
    packageGroupLabelsHidden?: Record<string, boolean>;
    categoryStepVisibility?: Record<string, string[]>;
    isFinal?: boolean;
    wizardStep?: number;
    wizardStepLabel?: string;
    /** When set, this step embeds another flow's steps. Packages come from the embedded flow. */
    embeddedFlow?: string;
    /** Label override when embedding (shown instead of embedded flow's default title). */
    embeddedFlowLabel?: string;
    /** Step-level visibility: hide entire step unless these cross-package conditions pass. */
    showWhen?: { package: string; category?: string | string[]; requiresSelectedRecord?: boolean }[];
    /** Per-category visibility: hide a category tab unless cross-package conditions pass.
     *  Key format: `${pkg}__${categoryValue}` */
    categoryShowWhen?: Record<string, { package: string; category: string | string[] }[]>;
    /** When set, the "Select Existing" picker searches from this flow instead of the current one. */
    recordPickerFlow?: string;
  } | null;
};

export default function StepsManager({ flow }: { flow: string }) {
  const groupKey = `flow_${flow}_steps`;
  const [rows, setRows] = React.useState<StepRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StepRow | null>(null);
  const [packages, setPackages] = React.useState<{ label: string; value: string }[]>([]);
  const [flows, setFlows] = React.useState<{ label: string; value: string }[]>([]);
  const [categoriesByPkg, setCategoriesByPkg] = React.useState<Record<string, { label: string; value: string }[]>>({});
  const [fieldsByPkg, setFieldsByPkg] = React.useState<Record<string, { key: string; label: string; options?: { label: string; value: string }[] }[]>>({});
  const [pkgMappingOpen, setPkgMappingOpen] = React.useState(false);
  const [form, setForm] = React.useState<Partial<StepRow>>({
    label: "",
    value: "",
    sortOrder: 0,
    isActive: true,
    meta: { packages: [], packageCategories: {}, isFinal: false, wizardStep: 1, wizardStepLabel: "" },
  });
  const editSnapshot = React.useRef<Record<string, unknown> | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(groupKey)}`, { cache: "no-store" });
      if (!res.ok) {
        setRows([]);
        return;
      }
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  }, [groupKey]);
  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    async function loadFlows() {
      try {
        const res = await fetch(`/api/form-options?groupKey=flows`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        setFlows(Array.isArray(data) ? data : []);
      } catch {
        setFlows([]);
      }
    }
    void loadFlows();
  }, []);

  React.useEffect(() => {
    async function loadPackages() {
      try {
        const res = await fetch(`/api/form-options?groupKey=packages`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        const list = Array.isArray(data) ? data : [];
        setPackages(list);
        // When available packages change, prune any invalid selections from the form
        setForm((f) => {
          const current = Array.isArray(f.meta?.packages) ? (f.meta!.packages as string[]) : [];
          const valid = current.filter((p) => list.some((po) => po.value === p));
          const currentMap = (f.meta?.packageCategories ?? {}) as Record<string, string[]>;
          const prunedMap = Object.fromEntries(Object.entries(currentMap).filter(([k]) => valid.includes(k)));
          return { ...f, meta: { ...(f.meta ?? {}), packages: valid, packageCategories: prunedMap } as StepRow["meta"] };
        });
      } catch {
        // ignore
      }
    }
    void loadPackages();
  }, []);

  React.useEffect(() => {
    async function loadCatsFor(pkgs: string[]) {
      const newMap: Record<string, { label: string; value: string }[]> = {};
      // Only load categories for packages that still exist
      const validPkgs = pkgs.filter((p) => packages.some((po) => po.value === p));
      for (const p of validPkgs) {
        try {
          const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${p}_category`)}`, { cache: "no-store" });
          if (!res.ok) continue;
          const data = (await res.json()) as { label: string; value: string }[];
          newMap[p] = Array.isArray(data) ? data : [];
        } catch {
          newMap[p] = [];
        }
      }
      setCategoriesByPkg((prev) => ({ ...prev, ...newMap }));
    }
    const pkgs = Array.isArray(form.meta?.packages) ? (form.meta?.packages as string[]) : [];
    void loadCatsFor(pkgs);
  }, [form.meta?.packages, packages]);

  // Prefetch categories for all available packages for table display to keep labels fresh
  React.useEffect(() => {
    async function loadAllCats() {
      const all = packages.map((p) => p.value);
      const newMap: Record<string, { label: string; value: string }[]> = {};
      for (const p of all) {
        try {
          const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${p}_category`)}`, { cache: "no-store" });
          if (!res.ok) continue;
          const data = (await res.json()) as { label: string; value: string }[];
          newMap[p] = Array.isArray(data) ? data : [];
        } catch {
          newMap[p] = [];
        }
      }
      setCategoriesByPkg((prev) => ({ ...prev, ...newMap }));
    }
    if (packages.length > 0) void loadAllCats();
  }, [packages]);
  const ensureFieldsLoaded = React.useCallback(async (pkg: string) => {
    if (fieldsByPkg[pkg]) return;
    try {
      const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { value: string; label: string; meta?: { inputType?: string; options?: { label: string; value: string }[] } }[];
      const list = (Array.isArray(data) ? data : []).map((f) => ({
        key: f.value,
        label: f.label,
        options: Array.isArray(f.meta?.options) ? f.meta!.options : undefined,
      }));
      setFieldsByPkg((prev) => ({ ...prev, [pkg]: list }));
    } catch { /* ignore */ }
  }, [fieldsByPkg]);

  function startCreate() {
    editSnapshot.current = null;
    setEditing(null);
    setForm({
      label: "",
      value: "",
      sortOrder: 0,
      isActive: true,
      meta: { packages: [], packageCategories: {}, packageShowWhen: {}, isFinal: false, wizardStep: 1, wizardStepLabel: "" },
    });
    setOpen(true);
  }
  function startEdit(row: StepRow) {
    setEditing(row);
    const next = {
      ...row,
      meta:
        row.meta ??
        {
          packages: [],
          packageCategories: {},
          packageShowWhen: {},
          isFinal: false,
          wizardStep: 1,
          wizardStepLabel: "",
        },
    } as StepRow;
    // Prune any packages that no longer exist
    if (packages.length > 0) {
      const valid = (next.meta?.packages ?? []).filter((p) => packages.some((po) => po.value === p));
      const currentMap = (next.meta?.packageCategories ?? {}) as Record<string, string[]>;
      const prunedMap = Object.fromEntries(Object.entries(currentMap).filter(([k]) => valid.includes(k)));
      const showWhenMap = (next.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>;
      const prunedShowWhen = Object.fromEntries(Object.entries(showWhenMap).filter(([k]) => valid.includes(k)));
      next.meta = { ...(next.meta ?? {}), packages: valid, packageCategories: prunedMap, packageShowWhen: prunedShowWhen };
    }
    setForm(next);
    editSnapshot.current = formSnapshot(buildSavePayload(next) as Record<string, unknown>);
    setOpen(true);
  }
  function buildSavePayload(form: Partial<StepRow>) {
    const embeddedFlow = String(form.meta?.embeddedFlow ?? "").trim();
    const selectedPkgsRaw = Array.isArray(form.meta?.packages) ? (form.meta?.packages as string[]) : [];
    const selectedPkgs = selectedPkgsRaw.filter((p) => packages.some((po) => po.value === p));
    const pkgCatsRaw = (form.meta?.packageCategories ?? {}) as Record<string, string[]>;
    const pkgCats = Object.fromEntries(Object.entries(pkgCatsRaw).filter(([k]) => selectedPkgs.includes(k)));
    const pkgShowWhenRaw = (form.meta?.packageShowWhen ?? {}) as Record<string, (ShowWhenRule & { field?: string; fieldValues?: string[] })[]>;
    const pkgShowWhen = Object.fromEntries(
      Object.entries(pkgShowWhenRaw)
        .filter(([k]) => selectedPkgs.includes(k))
        .map(([k, rules]) => [k, rules.filter((r) => {
          if (r.field && Array.isArray(r.fieldValues) && r.fieldValues.length > 0) return true;
          return r.package && (Array.isArray(r.category) ? r.category.length > 0 : !!r.category);
        })]),
    );
    const wizardStepNum = Number(form.meta?.wizardStep);
    const wizardStep = Number.isFinite(wizardStepNum) && wizardStepNum > 0 ? wizardStepNum : undefined;
    const rawLabel = form.meta?.wizardStepLabel;
    const wizardStepLabel =
      typeof rawLabel === "string" && rawLabel.trim().length > 0 ? rawLabel.trim() : undefined;
    const csvRaw = (form.meta?.categoryStepVisibility ?? {}) as Record<string, string[]>;
    const categoryStepVisibility = Object.fromEntries(
      Object.entries(csvRaw).filter(([, steps]) => Array.isArray(steps) && steps.length > 0),
    );
    const pkgGrpLabelsRaw = (form.meta?.packageGroupLabelsHidden ?? {}) as Record<string, boolean>;
    const packageGroupLabelsHidden = Object.fromEntries(
      Object.entries(pkgGrpLabelsRaw).filter(([k, v]) => selectedPkgs.includes(k) && v),
    );
    const embeddedFlowLabel = typeof form.meta?.embeddedFlowLabel === "string" ? form.meta.embeddedFlowLabel.trim() : undefined;
    const stepShowWhen = (Array.isArray(form.meta?.showWhen) ? form.meta!.showWhen : [])
      .filter((r): r is { package: string; category?: string | string[]; requiresSelectedRecord?: boolean } =>
        !!r.package || !!(r as { requiresSelectedRecord?: boolean }).requiresSelectedRecord,
      );
    const catShowWhenRaw = (form.meta?.categoryShowWhen ?? {}) as Record<string, { package: string; category: string | string[] }[]>;
    const categoryShowWhen = Object.fromEntries(
      Object.entries(catShowWhenRaw)
        .filter(([k, rules]) => {
          const [pkg] = k.split("__");
          return selectedPkgs.includes(pkg!) && rules.length > 0 && rules.some((r) => !!r.package);
        })
        .map(([k, rules]) => [k, rules.filter((r) => !!r.package)]),
    );
    return {
      label: form.label!,
      value: form.value!,
      sortOrder: Number(form.sortOrder) || 0,
      isActive: !!form.isActive,
      valueType: "string",
      meta: {
        ...(form.meta ?? {}),
        packages: selectedPkgs,
        packageCategories: pkgCats,
        packageShowWhen: pkgShowWhen,
        packageGroupLabelsHidden,
        categoryStepVisibility,
        categoryShowWhen: Object.keys(categoryShowWhen).length > 0 ? categoryShowWhen : undefined,
        wizardStep,
        wizardStepLabel,
        embeddedFlow: embeddedFlow || undefined,
        embeddedFlowLabel: embeddedFlowLabel || undefined,
        showWhen: stepShowWhen.length > 0 ? stepShowWhen : undefined,
        recordPickerFlow: (form.meta?.recordPickerFlow ?? "").trim() || undefined,
      },
    };
  }
  function toggleCategory(pkg: string, value: string) {
    const currentMap = (form.meta?.packageCategories ?? {}) as Record<string, string[]>;
    const current = Array.isArray(currentMap[pkg]) ? [...currentMap[pkg]] : [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    const newMap = { ...currentMap, [pkg]: next };
    setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageCategories: newMap } as StepRow["meta"] }));
  }

  const pkgMappingData = React.useMemo(() => {
    const selectedPkgs = Array.isArray(form.meta?.packages) ? (form.meta!.packages as string[]) : [];
    const psw = (form.meta?.packageShowWhen ?? {}) as Record<string, (ShowWhenRule & { field?: string; fieldValues?: string[] })[]>;
    const fieldRules = Object.entries(psw).filter(([, rules]) => rules.some((r) => r.field));
    if (fieldRules.length === 0) return null;
    const firstRule = fieldRules[0][1].find((r) => r.field);
    if (!firstRule?.field || !firstRule.package) return null;
    const srcPkg = firstRule.package;
    const srcField = firstRule.field;
    const allSameField = fieldRules.every(([, rules]) => rules.every((r) => !r.field || (r.field === srcField && r.package === srcPkg)));
    if (!allSameField) return null;
    const pkgFields = fieldsByPkg[srcPkg];
    if (!pkgFields) return { needsLoad: srcPkg } as const;
    const fieldDef = pkgFields.find((f) => f.key === srcField);
    if (!fieldDef?.options || fieldDef.options.length === 0) return null;
    const options = fieldDef.options;
    const mapping: Record<string, string[]> = {};
    for (const opt of options) mapping[opt.value] = [];
    for (const [pkg, rules] of Object.entries(psw)) {
      for (const r of rules) {
        if (r.field === srcField && r.package === srcPkg && r.fieldValues) {
          for (const v of r.fieldValues) { if (mapping[v]) mapping[v].push(pkg); }
        }
      }
    }
    return { srcPkg, srcField, fieldLabel: fieldDef.label, options, mapping, selectedPkgs };
  }, [form.meta?.packages, form.meta?.packageShowWhen, fieldsByPkg]);

  React.useEffect(() => {
    if (pkgMappingData && "needsLoad" in pkgMappingData && pkgMappingData.needsLoad) void ensureFieldsLoaded(pkgMappingData.needsLoad);
  }, [pkgMappingData, ensureFieldsLoaded]);

  const handleMappingToggle = React.useCallback((optValue: string, pkg: string, checked: boolean) => {
    setForm((prev) => {
      const selectedPkgs = Array.isArray(prev.meta?.packages) ? (prev.meta!.packages as string[]) : [];
      const psw = { ...((prev.meta?.packageShowWhen ?? {}) as Record<string, (ShowWhenRule & { field?: string; fieldValues?: string[] })[]>) };
      if (!pkgMappingData || "needsLoad" in pkgMappingData) return prev;
      const { srcField, srcPkg } = pkgMappingData;
      let newPkgs = selectedPkgs;
      if (checked && !selectedPkgs.includes(pkg)) newPkgs = [...selectedPkgs, pkg];
      if (checked) {
        if (!psw[pkg]) psw[pkg] = [];
        const existing = psw[pkg].find((r) => (r as any).field === srcField && r.package === srcPkg) as (ShowWhenRule & { field?: string; fieldValues?: string[] }) | undefined;
        if (existing) {
          const fv = existing.fieldValues ?? [];
          if (!fv.includes(optValue)) existing.fieldValues = [...fv, optValue];
        } else {
          (psw[pkg] as any[]).push({ field: srcField, package: srcPkg, fieldValues: [optValue] });
        }
      } else if (psw[pkg]) {
        for (const r of psw[pkg]) {
          const ra = r as ShowWhenRule & { field?: string; fieldValues?: string[] };
          if (ra.field === srcField && ra.package === srcPkg && ra.fieldValues) {
            ra.fieldValues = ra.fieldValues.filter((v) => v !== optValue);
          }
        }
        psw[pkg] = psw[pkg].filter((r) => {
          const ra = r as ShowWhenRule & { field?: string; fieldValues?: string[] };
          return !ra.field || (ra.fieldValues && ra.fieldValues.length > 0);
        });
      }
      return { ...prev, meta: { ...(prev.meta ?? {}), packages: newPkgs, packageShowWhen: psw } as StepRow["meta"] };
    });
  }, [pkgMappingData]);

  async function save() {
    try {
      if (!form.label || !form.value) {
        toast.error("Label and value are required");
        return;
      }
      const embeddedFlow = String(form.meta?.embeddedFlow ?? "").trim();
      const selectedPkgsRaw = Array.isArray(form.meta?.packages) ? (form.meta?.packages as string[]) : [];
      const selectedPkgs = selectedPkgsRaw.filter((p) => packages.some((po) => po.value === p));
      if (!embeddedFlow && selectedPkgs.length === 0) {
        toast.error("Please select at least one package, or use an embedded flow");
        return;
      }
      const payload = buildSavePayload(form);
      if (editing) {
        if (
          editSnapshot.current !== null &&
          deepEqual(editSnapshot.current, formSnapshot(payload as Record<string, unknown>))
        ) {
          toast.info("No changes to save");
          return;
        }
        const res = await fetch(`/api/admin/form-options/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error((errJson as { error?: string }).error ?? "Update failed");
        }
        toast.success("Updated");
      } else {
        const res = await fetch(`/api/admin/form-options`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ groupKey, ...payload }),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error((errJson as { error?: string }).error ?? "Create failed");
        }
        toast.success("Created");
      }
      // Enforce single final step per flow if isFinal is set
      if (form.meta?.isFinal) {
        try {
          const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(groupKey)}`, { cache: "no-store" });
          const all = (await res.json()) as StepRow[];
          const currentKey = form.value;
          const toUnset = (all ?? []).filter((r) => r.meta?.isFinal && r.value !== currentKey);
          for (const r of toUnset) {
            const newMeta = { ...(r.meta ?? {}), isFinal: false };
            await fetch(`/api/admin/form-options/${r.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ meta: newMeta }),
            });
          }
        } catch {
          // ignore; best-effort
        }
      }
      setOpen(false);
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    }
  }

  async function remove(row: StepRow) {
    try {
      const proceed = window.confirm(`Delete step "${row.label}"?`);
      if (!proceed) return;
      const res = await fetch(`/api/admin/form-options/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Deleted");
      await load();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Delete failed";
      toast.error(message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-neutral-500 dark:text-neutral-400">Configure steps for this flow. Each step selects a package and optional categories.</div>
        <Button type="button" size="sm" onClick={startCreate} className="self-start sm:self-auto">
          Add Step
        </Button>
      </div>
      <div className="overflow-x-auto">
      <Table className="min-w-[720px]">
        <TableHeader className="hidden sm:table-header-group">
          <TableRow>
            <TableHead className="p-2 sm:p-4">Step</TableHead>
            <TableHead className="p-2 sm:p-4">Categories</TableHead>
            <TableHead className="p-2 sm:p-4">Sort</TableHead>
            <TableHead className="p-2 sm:p-4">Wizard Step</TableHead>
            <TableHead className="hidden text-right sm:table-cell p-2 sm:p-4">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="p-2 sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{r.label}</span>
                  {r.meta?.isFinal ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-300">
                      Final
                    </span>
                  ) : null}
                  {r.meta?.embeddedFlow ? (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      Embed: {flows.find((f) => f.value === r.meta?.embeddedFlow)?.label ?? r.meta.embeddedFlow}
                    </span>
                  ) : null}
                  {Array.isArray(r.meta?.showWhen) && r.meta!.showWhen.length > 0 ? (
                    <span
                      className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      title={
                        (r.meta!.showWhen as { package: string; category?: string | string[]; requiresSelectedRecord?: boolean }[])
                          .map((rule) => {
                            if (rule.requiresSelectedRecord) return "Requires selected record";
                            const pkgLabel = packages.find((p) => p.value === rule.package)?.label ?? rule.package;
                            const cats = Array.isArray(rule.category) ? rule.category : rule.category ? [rule.category] : [];
                            const catLabels = cats.map((c) => (categoriesByPkg[rule.package] ?? []).find((o) => o.value === c)?.label ?? c);
                            return `${pkgLabel} = ${catLabels.join(" or ")}`;
                          })
                          .join(" AND ")
                      }
                    >
                      When: {(r.meta!.showWhen as { package: string; category?: string | string[]; requiresSelectedRecord?: boolean }[])
                        .map((rule) => {
                          if (rule.requiresSelectedRecord) return "record selected";
                          const pkgLabel = packages.find((p) => p.value === rule.package)?.label ?? rule.package;
                          const cats = Array.isArray(rule.category) ? rule.category : rule.category ? [rule.category] : [];
                          const catLabels = cats.map((c) => (categoriesByPkg[rule.package] ?? []).find((o) => o.value === c)?.label ?? c);
                          return `${pkgLabel} = ${catLabels.join("/")}`;
                        })
                        .join(", ")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-neutral-500 sm:hidden">
                  <span className="font-mono">{r.value}</span>
                  <span className="px-2">•</span>
                  <span>Sort {r.sortOrder}</span>
                </div>
              </TableCell>
              <TableCell className="p-2 sm:p-4">
                {(() => {
                  const map = (r.meta?.packageCategories ?? {}) as Record<string, string[]>;
                  const csvMap = (r.meta?.categoryStepVisibility ?? {}) as Record<string, string[]>;
                  const showWhenMap = (r.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>;
                  const pkgs = ((r.meta?.packages ?? []) as string[]).filter((p) =>
                    packages.some((po) => po.value === p),
                  );
                  if (!pkgs || pkgs.length === 0) return "all";
                  const hasMappings = Object.values(csvMap).some((s) => s.length > 0);
                  return (
                    <div className="space-y-1">
                      {pkgs.map((p) => {
                        const cs = Array.isArray(map[p]) ? map[p] : [];
                        const options = categoriesByPkg[p] ?? [];
                        const labels = cs
                          .map((val) => options.find((o) => o.value === val)?.label ?? val)
                          .filter(Boolean) as string[];
                        const pkgLabel = packages.find((po) => po.value === p)?.label ?? p;
                        const swRules = showWhenMap[p] ?? [];
                        const hasCondition = swRules.length > 0 && swRules.some((rule) => rule.package);
                        return (
                          <div key={p} className="text-xs">
                            <span className="font-medium">{pkgLabel}</span>
                            <span className="text-neutral-500 dark:text-neutral-400">: {labels.length > 0 ? labels.join(", ") : "all"}</span>
                            {hasCondition ? (
                              <div className="mt-0.5">
                                {swRules.filter((rule) => rule.package).map((rule, ri) => {
                                  const depPkgLabel = packages.find((po) => po.value === rule.package)?.label ?? rule.package;
                                  const depCats = Array.isArray(rule.category) ? rule.category : (rule.category ? [rule.category] : []);
                                  const depCatOptions = categoriesByPkg[rule.package] ?? [];
                                  const depCatLabels = depCats.map((cv) => depCatOptions.find((o) => o.value === cv)?.label ?? cv);
                                  return (
                                    <span key={ri} className="inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 mr-1">
                                      when {depPkgLabel} = {depCatLabels.join(" / ") || "any"}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {hasMappings ? (
                        <div className="mt-1 space-y-0.5">
                          {Object.entries(csvMap)
                            .filter(([, steps]) => steps.length > 0)
                            .map(([catVal, stepVals]) => {
                              const allCats = pkgs.flatMap((p) => categoriesByPkg[p] ?? []);
                              const catLabel = allCats.find((c) => c.value === catVal)?.label ?? catVal;
                              const stepLabels = stepVals
                                .map((sv) => rows.find((rr) => rr.value === sv)?.label ?? sv)
                                .join(", ");
                              return (
                                <span key={catVal} className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 mr-1">
                                  {catLabel} → {stepLabels}
                                </span>
                              );
                            })}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </TableCell>
              <TableCell className="p-2 sm:p-4">{r.sortOrder}</TableCell>
              <TableCell className="p-2 sm:p-4">
                {(() => {
                  if (r.meta?.embeddedFlow) {
                    const lbl = String(r.meta.embeddedFlowLabel ?? r.meta.wizardStepLabel ?? "").trim();
                    return (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        Auto{lbl ? ` — ${lbl}` : ""}<br />
                        <span className="text-[10px]">(uses Sort Order)</span>
                      </span>
                    );
                  }
                  const n = Number(r.meta?.wizardStep ?? 0);
                  const label = String((r.meta?.wizardStepLabel ?? "") || "").trim();
                  if (!(Number.isFinite(n) && n > 0)) return "-";
                  return label ? `${n} — ${label}` : n;
                })()}
              </TableCell>
              <TableCell className="hidden text-right sm:table-cell p-2 sm:p-4">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r)}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-neutral-500 dark:text-neutral-400">
                No steps defined.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Step" : "Add Step"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Step Label</Label>
              <Input value={form.label ?? ""} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Step Key</Label>
              <Input value={form.value ?? ""} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
            </div>
            <div className="grid gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={!!form.meta?.embeddedFlow}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? (flows.find((fl) => fl.value !== flow)?.value ?? flows[0]?.value ?? "")
                      : "";
                    setForm((f) => ({
                      ...f,
                      meta: {
                        ...(f.meta ?? {}),
                        embeddedFlow: next,
                        embeddedFlowLabel: f.meta?.embeddedFlowLabel ?? "",
                      } as StepRow["meta"],
                    }));
                  }}
                />
                Embed another flow (e.g. Create Client)
              </label>
              {form.meta?.embeddedFlow ? (
                <>
                  <div className="grid gap-1">
                    <Label className="text-xs">Flow to embed</Label>
                    <select
                      className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                      value={form.meta.embeddedFlow}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          meta: { ...(f.meta ?? {}), embeddedFlow: e.target.value } as StepRow["meta"],
                        }))
                      }
                    >
                      <option value="">-- Select flow --</option>
                      {flows
                        .filter((fl) => fl.value !== flow)
                        .map((fl) => (
                          <option key={fl.value} value={fl.value}>
                            {fl.label}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Label override (optional)</Label>
                    <Input
                      placeholder="e.g. Client Information"
                      value={String(form.meta?.embeddedFlowLabel ?? "")}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          meta: { ...(f.meta ?? {}), embeddedFlowLabel: e.target.value } as StepRow["meta"],
                        }))
                      }
                    />
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                      Shown as the step title in this flow. Leave empty to use the embedded flow&apos;s default.
                    </p>
                  </div>
                </>
              ) : null}
            </div>
            <div className="grid gap-1">
              <Label>Record Picker Flow Override <span className="text-xs text-neutral-400">(optional)</span></Label>
              <select
                className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                value={String(form.meta?.recordPickerFlow ?? "")}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    meta: { ...(f.meta ?? {}), recordPickerFlow: e.target.value || undefined } as StepRow["meta"],
                  }))
                }
              >
                <option value="">Same as current flow</option>
                {flows.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                When set, the &ldquo;Select Existing&rdquo; button will search records from this flow instead of the current one (useful for endorsements).
              </p>
            </div>
            <div className="grid gap-1">
              <Label>Packages {form.meta?.embeddedFlow ? "(ignored when embedding)" : ""}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {packages.map((p) => {
                  const selected = Array.isArray(form.meta?.packages) ? (form.meta!.packages as string[])?.includes(p.value) : false;
                  return (
                    <label key={p.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {
                          const current = Array.isArray(form.meta?.packages) ? [...(form.meta!.packages as string[])] : [];
                          const next = selected ? current.filter((v) => v !== p.value) : [...current, p.value];
                          setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packages: next } as StepRow["meta"] }));
                        }}
                      />
                      {p.label}
                    </label>
                  );
                })}
                {packages.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No packages found. Create packages first.</p> : null}
              </div>
            </div>
            {/* Endorsement-type → Package mapping — opens in a separate dialog */}
            {pkgMappingData && !("needsLoad" in pkgMappingData) && (() => {
              const { fieldLabel, options, mapping } = pkgMappingData;
              const mappedCount = Object.values(mapping).filter((pkgs) => pkgs.length > 0).length;
              return (
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPkgMappingOpen(true)}>
                    Configure Package Visibility by {fieldLabel}
                  </Button>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    {mappedCount}/{options.length} options mapped
                  </span>
                </div>
              );
            })()}
            {/* Categories per selected package */}
            {Array.isArray(form.meta?.packages) && (form.meta!.packages as string[]).length > 0 ? (
              <div className="grid gap-3">
                {(form.meta!.packages as string[]).map((pkg) => {
                  const pkgLabel = packages.find((p) => p.value === pkg)?.label ?? pkg;
                  const cats = categoriesByPkg[pkg] ?? [];
                  const selected = ((form.meta?.packageCategories ?? {}) as Record<string, string[]>)[pkg] ?? [];
                  const showWhenRules = ((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>)[pkg] ?? [];
                  const otherSelectedPkgs = (form.meta!.packages as string[]).filter((p) => p !== pkg);
                  const groupLabelsHidden = ((form.meta?.packageGroupLabelsHidden ?? {}) as Record<string, boolean>)[pkg] ?? false;
                  return (
                    <div key={pkg} className="rounded-md border border-neutral-200 p-3 space-y-3 dark:border-neutral-800">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{pkgLabel}</div>
                        <label className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                          <input
                            type="checkbox"
                            checked={groupLabelsHidden}
                            onChange={(e) => {
                              const map = { ...((form.meta?.packageGroupLabelsHidden ?? {}) as Record<string, boolean>) };
                              map[pkg] = e.target.checked;
                              setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageGroupLabelsHidden: map } as StepRow["meta"] }));
                            }}
                          />
                          Hide group labels in flow
                        </label>
                      </div>
                      <div>
                        <Label className="text-xs">Categories (optional)</Label>
                        <div className="mt-1 space-y-2">
                          {cats.map((c) => {
                            const isChecked = selected.includes(c.value);
                            const catCondKey = `${pkg}__${c.value}`;
                            const catCondRules = ((form.meta?.categoryShowWhen ?? {}) as Record<string, { package: string; category: string | string[] }[]>)[catCondKey] ?? [];
                            const hasCond = catCondRules.length > 0;
                            return (
                              <div key={c.value} className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={isChecked} onChange={() => toggleCategory(pkg, c.value)} />
                                    {c.label}
                                  </label>
                                  {isChecked && (
                                    <button
                                      type="button"
                                      className={`text-[10px] ${hasCond ? "text-amber-600 dark:text-amber-400" : "text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"}`}
                                      onClick={() => {
                                        const map = { ...((form.meta?.categoryShowWhen ?? {}) as Record<string, { package: string; category: string | string[] }[]>) };
                                        if (hasCond) {
                                          delete map[catCondKey];
                                        } else {
                                          map[catCondKey] = [{ package: "", category: [] }];
                                        }
                                        setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), categoryShowWhen: map } as StepRow["meta"] }));
                                      }}
                                    >
                                      {hasCond ? "✕ Remove condition" : "+ Show when…"}
                                    </button>
                                  )}
                                </div>
                                {isChecked && hasCond && catCondRules.map((rule, rIdx) => {
                                  const ruleCats = categoriesByPkg[rule.package] ?? [];
                                  const selCats = Array.isArray(rule.category) ? rule.category : rule.category ? [rule.category] : [];
                                  return (
                                    <div key={rIdx} className="ml-6 flex flex-wrap items-center gap-2 text-xs rounded border border-amber-200 p-2 dark:border-amber-800/50">
                                      <span className="text-neutral-500 dark:text-neutral-400 shrink-0">Show when</span>
                                      <select
                                        className="h-7 rounded border border-neutral-200 bg-white px-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                        value={rule.package}
                                        onChange={(e) => {
                                          const map = { ...((form.meta?.categoryShowWhen ?? {}) as Record<string, { package: string; category: string | string[] }[]>) };
                                          const arr = [...(map[catCondKey] ?? [])];
                                          arr[rIdx] = { ...arr[rIdx], package: e.target.value, category: [] };
                                          map[catCondKey] = arr;
                                          setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), categoryShowWhen: map } as StepRow["meta"] }));
                                          const depPkg = e.target.value;
                                          if (depPkg && !categoriesByPkg[depPkg]) {
                                            void (async () => {
                                              try {
                                                const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${depPkg}_category`)}`, { cache: "no-store" });
                                                if (!res.ok) return;
                                                const data = (await res.json()) as { label: string; value: string }[];
                                                setCategoriesByPkg((prev) => ({ ...prev, [depPkg]: Array.isArray(data) ? data : [] }));
                                              } catch { /* ignore */ }
                                            })();
                                          }
                                        }}
                                      >
                                        <option value="">-- Package --</option>
                                        {packages.filter((p) => p.value !== pkg).map((p) => (
                                          <option key={p.value} value={p.value}>{p.label}</option>
                                        ))}
                                      </select>
                                      {rule.package && ruleCats.length > 0 && (
                                        <>
                                          <span className="text-neutral-400">=</span>
                                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                            {ruleCats.map((rc) => (
                                              <label key={rc.value} className="inline-flex items-center gap-1 text-xs">
                                                <input
                                                  type="checkbox"
                                                  checked={selCats.includes(rc.value)}
                                                  onChange={(e) => {
                                                    const map = { ...((form.meta?.categoryShowWhen ?? {}) as Record<string, { package: string; category: string | string[] }[]>) };
                                                    const arr = [...(map[catCondKey] ?? [])];
                                                    const cur = [...selCats];
                                                    if (e.target.checked) cur.push(rc.value);
                                                    else { const idx = cur.indexOf(rc.value); if (idx >= 0) cur.splice(idx, 1); }
                                                    arr[rIdx] = { ...arr[rIdx], category: cur };
                                                    map[catCondKey] = arr;
                                                    setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), categoryShowWhen: map } as StepRow["meta"] }));
                                                  }}
                                                />
                                                {rc.label}
                                              </label>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                      {rule.package && ruleCats.length === 0 && (
                                        <span className="text-[10px] text-neutral-400 dark:text-neutral-500 italic">
                                          (no categories — will match when any value is selected)
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                          {cats.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No categories for this package.</p> : null}
                        </div>
                      </div>
                      {/* Category → Step Mapping (advanced): map each selected category to other steps that should become visible */}
                      {selected.length > 0 && (() => {
                        const csvMap = (form.meta?.categoryStepVisibility ?? {}) as Record<string, string[]>;
                        const hasAnyMapping = selected.some((cv) => (csvMap[cv]?.length ?? 0) > 0);
                        const otherRows = rows.filter((r) => r.value !== form.value);
                        if (otherRows.length === 0) return null;
                        return (
                          <details className="group" open={hasAnyMapping || undefined}>
                            <summary className="cursor-pointer select-none text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
                              <span className="ml-1">Advanced: control which <strong>other steps</strong> appear based on category selected here</span>
                            </summary>
                            <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400 mb-1">
                              When a category is selected in <em>this</em> step, only the checked steps below will be shown in the wizard. Leave all unchecked to have no effect.
                            </p>
                            <div className="mt-2 space-y-2">
                              {selected.map((catVal) => {
                                const catLabel = cats.find((c) => c.value === catVal)?.label ?? catVal;
                                const mappedSteps = csvMap[catVal] ?? [];
                                return (
                                  <div key={catVal} className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
                                    <div className="mb-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                                      When <span className="text-neutral-900 dark:text-neutral-100">{catLabel}</span> → show steps:
                                    </div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                      {otherRows.map((or) => {
                                        const checked = mappedSteps.includes(or.value);
                                        return (
                                          <label key={or.value} className="inline-flex items-center gap-1 text-xs">
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => {
                                                const map = { ...csvMap };
                                                const cur = [...(map[catVal] ?? [])];
                                                map[catVal] = checked ? cur.filter((v) => v !== or.value) : [...cur, or.value];
                                                setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), categoryStepVisibility: map } as StepRow["meta"] }));
                                              }}
                                            />
                                            {or.label}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        );
                      })()}
                      {(() => {
                        const catCondMap = (form.meta?.categoryShowWhen ?? {}) as Record<string, unknown[]>;
                        const hasCatConds = Object.keys(catCondMap).some((k) => k.startsWith(`${pkg}__`) && (catCondMap[k]?.length ?? 0) > 0);
                        if (hasCatConds) return (
                          <p className="text-[10px] text-neutral-500 dark:text-neutral-400 italic">
                            Package-level condition hidden — per-category &ldquo;Show when&rdquo; conditions above are more precise.
                          </p>
                        );
                        return (
                      <div>
                        <Label className="text-xs">Show only when (cross-package condition)</Label>
                        <p className="text-[10px] text-neutral-500 mb-1">Only show this package when another package&apos;s category or field value matches. Leave empty to always show.</p>
                        {showWhenRules.map((rule, rIdx) => {
                          const ruleCats = categoriesByPkg[rule.package] ?? [];
                          const ruleAny = rule as ShowWhenRule & { field?: string; fieldValues?: string[] };
                          const isFieldMode = !!ruleAny.field;
                          return (
                            <div key={rIdx} className="mb-1 flex items-start gap-2 rounded border border-neutral-200 p-2 dark:border-neutral-700">
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="w-14 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">Package</span>
                                  <select
                                    className="h-7 flex-1 rounded border border-neutral-300 bg-white px-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                                    value={rule.package}
                                    onChange={(e) => {
                                      const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                                      const arr = [...(map[pkg] ?? [])];
                                      arr[rIdx] = { ...arr[rIdx], package: e.target.value, category: [] };
                                      map[pkg] = arr;
                                      setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                                      const depPkg = e.target.value;
                                      if (depPkg && !categoriesByPkg[depPkg]) {
                                        void (async () => {
                                          try {
                                            const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${depPkg}_category`)}`, { cache: "no-store" });
                                            if (!res.ok) return;
                                            const data = (await res.json()) as { label: string; value: string }[];
                                            setCategoriesByPkg((prev) => ({ ...prev, [depPkg]: Array.isArray(data) ? data : [] }));
                                          } catch { /* ignore */ }
                                        })();
                                      }
                                    }}
                                  >
                                    <option value="">-- Select --</option>
                                    {otherSelectedPkgs.map((op) => {
                                      const opLabel = packages.find((p) => p.value === op)?.label ?? op;
                                      return <option key={op} value={op}>{opLabel}</option>;
                                    })}
                                    {packages.filter((p) => !otherSelectedPkgs.includes(p.value) && p.value !== pkg).map((p) => (
                                      <option key={p.value} value={p.value}>{p.label} (other step)</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex items-center gap-2 ml-14">
                                  <label className="inline-flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                                    <input
                                      type="checkbox"
                                      checked={isFieldMode}
                                      onChange={(e) => {
                                        const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                                        const arr = [...(map[pkg] ?? [])];
                                        if (e.target.checked) {
                                          arr[rIdx] = { ...arr[rIdx], category: [], field: "", fieldValues: [] } as any;
                                        } else {
                                          const { field: _f, fieldValues: _fv, ...rest } = arr[rIdx] as any;
                                          arr[rIdx] = rest;
                                        }
                                        map[pkg] = arr;
                                        setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                                      }}
                                    />
                                    Match by field value (instead of category)
                                  </label>
                                </div>
                                {isFieldMode ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="w-14 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">Field</span>
                                      {(() => {
                                        const rulePkg = rule.package || "";
                                        const pkgFields = fieldsByPkg[rulePkg];
                                        if (!pkgFields && rulePkg) void ensureFieldsLoaded(rulePkg);
                                        return pkgFields && pkgFields.length > 0 ? (
                                          <select
                                            className="h-7 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                            value={ruleAny.field ?? ""}
                                            onChange={(e) => {
                                              const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                                              const arr = [...(map[pkg] ?? [])];
                                              arr[rIdx] = { ...arr[rIdx], field: e.target.value, fieldValues: [] } as any;
                                              map[pkg] = arr;
                                              setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                                            }}
                                          >
                                            <option value="">— Select field —</option>
                                            {pkgFields.map((pf) => (
                                              <option key={pf.key} value={pf.key}>{pf.label} ({pf.key})</option>
                                            ))}
                                          </select>
                                        ) : (
                                          <Input
                                            className="h-7 flex-1 text-xs"
                                            placeholder="field key (e.g. coverType)"
                                            value={ruleAny.field ?? ""}
                                            onChange={(e) => {
                                              const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                                              const arr = [...(map[pkg] ?? [])];
                                              arr[rIdx] = { ...arr[rIdx], field: e.target.value } as any;
                                              map[pkg] = arr;
                                              setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                                            }}
                                          />
                                        );
                                      })()}
                                    </div>
                                    <div className="flex items-start gap-2">
                                      <span className="w-14 shrink-0 pt-1 text-[11px] text-neutral-500 dark:text-neutral-400">Values</span>
                                      {(() => {
                                        const rulePkg = rule.package || "";
                                        const pkgFields = fieldsByPkg[rulePkg] ?? [];
                                        const selectedField = pkgFields.find((pf) => pf.key === ruleAny.field);
                                        const fieldOptions = selectedField?.options ?? [];
                                        const selectedVals = ruleAny.fieldValues ?? [];
                                        if (fieldOptions.length > 0) {
                                          return (
                                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                                              {fieldOptions.map((opt) => {
                                                const checked = selectedVals.includes(opt.value);
                                                return (
                                                  <label key={opt.value} className="inline-flex items-center gap-1 text-xs">
                                                    <input
                                                      type="checkbox"
                                                      checked={checked}
                                                      onChange={() => {
                                                        const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                                                        const arr = [...(map[pkg] ?? [])];
                                                        const updated = checked
                                                          ? selectedVals.filter((v) => v !== opt.value)
                                                          : [...selectedVals, opt.value];
                                                        arr[rIdx] = { ...arr[rIdx], fieldValues: updated } as any;
                                                        map[pkg] = arr;
                                                        setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                                                      }}
                                                    />
                                                    {opt.label}
                                                  </label>
                                                );
                                              })}
                                            </div>
                                          );
                                        }
                                        return (
                                          <Input
                                            className="h-7 flex-1 text-xs"
                                            placeholder="comma-separated values"
                                            value={selectedVals.join(", ")}
                                            onChange={(e) => {
                                              const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                                              const arr = [...(map[pkg] ?? [])];
                                              arr[rIdx] = { ...arr[rIdx], fieldValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } as any;
                                              map[pkg] = arr;
                                              setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                                            }}
                                          />
                                        );
                                      })()}
                                    </div>
                                  </div>
                                ) : rule.package && ruleCats.length > 0 ? (
                                  <div className="flex items-start gap-2">
                                    <span className="w-14 shrink-0 pt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">Category</span>
                                    <div className="flex flex-wrap gap-2">
                                      {ruleCats.map((c) => {
                                        const allowed = Array.isArray(rule.category) ? rule.category : (rule.category ? [rule.category] : []);
                                        const checked = (allowed as string[]).includes(c.value);
                                        return (
                                          <label key={c.value} className="inline-flex items-center gap-1 text-xs">
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => {
                                                const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                                                const arr = [...(map[pkg] ?? [])];
                                                const cur = Array.isArray(arr[rIdx].category) ? [...(arr[rIdx].category as string[])] : (arr[rIdx].category ? [arr[rIdx].category as string] : []);
                                                const updated = checked ? cur.filter((v) => v !== c.value) : [...cur, c.value];
                                                arr[rIdx] = { ...arr[rIdx], category: updated };
                                                map[pkg] = arr;
                                                setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                                              }}
                                            />
                                            {c.label}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className="shrink-0 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 text-lg leading-none"
                                onClick={() => {
                                  const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                                  map[pkg] = (map[pkg] ?? []).filter((_, i) => i !== rIdx);
                                  setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                                }}
                              >
                                &times;
                              </button>
                            </div>
                          );
                        })}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="text-xs"
                          onClick={() => {
                            const map = { ...((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>) };
                            map[pkg] = [...(map[pkg] ?? []), { package: "", category: [] }];
                            setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageShowWhen: map } as StepRow["meta"] }));
                          }}
                        >
                          + Add condition
                        </Button>
                      </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {/* ── Step-level show/hide condition ── */}
            <div className="rounded-md border border-neutral-200 p-3 space-y-3 dark:border-neutral-800">
              <div>
                <Label>Show step only when (cross-package condition)</Label>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                  Hide this entire wizard step unless the selected categories match. Leave empty to always show.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={
                    Array.isArray(form.meta?.showWhen) &&
                    (form.meta!.showWhen as { requiresSelectedRecord?: boolean }[]).some(
                      (r) => r.requiresSelectedRecord,
                    )
                  }
                  onChange={(e) => {
                    const existing = Array.isArray(form.meta?.showWhen)
                      ? (form.meta!.showWhen as { package: string; category?: string | string[]; requiresSelectedRecord?: boolean }[])
                      : [];
                    let next: typeof existing;
                    if (e.target.checked) {
                      const already = existing.some((r) => r.requiresSelectedRecord);
                      next = already ? existing : [...existing, { package: "", requiresSelectedRecord: true }];
                    } else {
                      next = existing.filter((r) => !r.requiresSelectedRecord);
                    }
                    setForm((f) => ({
                      ...f,
                      meta: { ...(f.meta ?? {}), showWhen: next.length > 0 ? next : undefined } as StepRow["meta"],
                    }));
                  }}
                />
                Requires selected record (only show after an existing policy/record is chosen)
              </label>
              {(() => {
                const rules = Array.isArray(form.meta?.showWhen)
                  ? (form.meta!.showWhen as { package: string; category?: string | string[] }[])
                  : [];
                return (
                  <div className="space-y-2">
                    {rules.map((rule, rIdx) => {
                      const ruleCats = categoriesByPkg[rule.package] ?? [];
                      const selectedCats = Array.isArray(rule.category)
                        ? rule.category
                        : rule.category
                          ? [rule.category]
                          : [];
                      return (
                        <div
                          key={rIdx}
                          className="rounded border border-neutral-100 p-2 space-y-2 dark:border-neutral-800"
                        >
                          <div className="flex items-center gap-2">
                            <Label className="text-xs shrink-0">Package</Label>
                            <select
                              className="h-8 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-xs dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                              value={rule.package}
                              onChange={(e) => {
                                const next = [...rules];
                                next[rIdx] = { ...next[rIdx], package: e.target.value, category: [] };
                                setForm((f) => ({
                                  ...f,
                                  meta: { ...(f.meta ?? {}), showWhen: next } as StepRow["meta"],
                                }));
                                const depPkg = e.target.value;
                                if (depPkg && !categoriesByPkg[depPkg]) {
                                  void (async () => {
                                    try {
                                      const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${depPkg}_category`)}`, { cache: "no-store" });
                                      if (!res.ok) return;
                                      const data = (await res.json()) as { label: string; value: string }[];
                                      setCategoriesByPkg((prev) => ({ ...prev, [depPkg]: Array.isArray(data) ? data : [] }));
                                    } catch { /* ignore */ }
                                  })();
                                }
                              }}
                            >
                              <option value="">-- Select package --</option>
                              {packages.map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.label} (other step)
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="text-xs text-red-500 hover:text-red-700"
                              onClick={() => {
                                const next = rules.filter((_, i) => i !== rIdx);
                                setForm((f) => ({
                                  ...f,
                                  meta: { ...(f.meta ?? {}), showWhen: next } as StepRow["meta"],
                                }));
                              }}
                            >
                              &times;
                            </button>
                          </div>
                          {rule.package && ruleCats.length > 0 && (
                            <div className="ml-4 space-y-1">
                              <Label className="text-[10px] text-neutral-500">Category</Label>
                              <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {ruleCats.map((cat) => (
                                  <label
                                    key={cat.value}
                                    className="inline-flex items-center gap-1.5 text-xs"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedCats.includes(cat.value)}
                                      onChange={(e) => {
                                        const next = [...rules];
                                        const cur = [...selectedCats];
                                        if (e.target.checked) {
                                          cur.push(cat.value);
                                        } else {
                                          const idx = cur.indexOf(cat.value);
                                          if (idx >= 0) cur.splice(idx, 1);
                                        }
                                        next[rIdx] = { ...next[rIdx], category: cur };
                                        setForm((f) => ({
                                          ...f,
                                          meta: {
                                            ...(f.meta ?? {}),
                                            showWhen: next,
                                          } as StepRow["meta"],
                                        }));
                                      }}
                                    />
                                    {cat.label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {rule.package && ruleCats.length === 0 && (
                            <p className="ml-4 text-[10px] text-neutral-400 dark:text-neutral-500 italic">
                              (no categories — will match when any value is selected)
                            </p>
                          )}
                        </div>
                      );
                    })}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const next = [...rules, { package: "", category: [] as string[] }];
                        setForm((f) => ({
                          ...f,
                          meta: { ...(f.meta ?? {}), showWhen: next } as StepRow["meta"],
                        }));
                      }}
                    >
                      + Add condition
                    </Button>
                  </div>
                );
              })()}
            </div>

            <div className="grid gap-1">
              <Label>Wizard Step Label (optional)</Label>
              {(() => {
                const suggestions = Array.from(
                  new Set(
                    (rows ?? [])
                      .map((r) => String((r.meta?.wizardStepLabel ?? "") || "").trim())
                      .filter((v) => v.length > 0),
                  ),
                );
                return (
                  <>
                    <select
                      className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                      value={
                        suggestions.includes(String(form.meta?.wizardStepLabel ?? ""))
                          ? String(form.meta?.wizardStepLabel ?? "")
                          : ""
                      }
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          meta: { ...(f.meta ?? {}), wizardStepLabel: e.target.value } as StepRow["meta"],
                        }))
                      }
                    >
                      <option value="">-- Choose existing label --</option>
                      {suggestions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2">
                      <Input
                        placeholder="Or enter a custom label"
                        value={String(form.meta?.wizardStepLabel ?? "")}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            meta: { ...(f.meta ?? {}), wizardStepLabel: e.target.value } as StepRow["meta"],
                          }))
                        }
                      />
                    </div>
                  </>
                );
              })()}
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Shown as the title for this wizard step group when applicable.</div>
            </div>
            <div className="grid gap-1">
              <Label>Wizard Step</Label>
              <Input
                type="number"
                value={String(form.meta?.wizardStep ?? 1)}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    meta: { ...(f.meta ?? {}), wizardStep: Number(e.target.value) } as StepRow["meta"],
                  }))
                }
              />
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Determines the wizard step number on the New Policy page.</div>
            </div>
            <div className="grid gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.meta?.isFinal}
                  onChange={(e) => setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), isFinal: e.target.checked } as StepRow["meta"] }))}
                />
                Final step (only one per flow)
              </label>
            </div>
            <div className="grid gap-1">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={String(form.sortOrder ?? 0)}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
              />
            </div>
            <div className="grid gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Package-visibility mapping dialog — rendered as sibling, not nested */}
      {pkgMappingData && !("needsLoad" in pkgMappingData) && (
        <Dialog open={pkgMappingOpen} onOpenChange={setPkgMappingOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Package Visibility by {pkgMappingData.fieldLabel}</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 -mt-2">
              For each option, select which packages to display. Packages not yet in this step will be auto-added.
            </p>
            <div className="space-y-3 mt-2">
              {pkgMappingData.options.map((opt) => {
                const currentPkgs = pkgMappingData.mapping[opt.value] ?? [];
                return (
                  <div key={opt.value} className="rounded-md border border-neutral-200 dark:border-neutral-700 p-3">
                    <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-2">{opt.label}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {packages.filter((p) => p.value !== "ordertype" && p.value !== "premiumRecord").map((p) => {
                        const isChecked = currentPkgs.includes(p.value);
                        return (
                          <label key={p.value} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded px-1 py-0.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleMappingToggle(opt.value, p.value, !isChecked)}
                              className="rounded"
                            />
                            <span className={isChecked ? "font-medium" : "text-neutral-500 dark:text-neutral-400"}>{p.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={() => setPkgMappingOpen(false)}>Done</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}


