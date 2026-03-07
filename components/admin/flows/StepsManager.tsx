"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
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
    categoryStepVisibility?: Record<string, string[]>;
    isFinal?: boolean;
    wizardStep?: number;
    wizardStepLabel?: string;
    /** When set, this step embeds another flow's steps. Packages come from the embedded flow. */
    embeddedFlow?: string;
    /** Label override when embedding (shown instead of embedded flow's default title). */
    embeddedFlowLabel?: string;
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
  const [form, setForm] = React.useState<Partial<StepRow>>({
    label: "",
    value: "",
    sortOrder: 0,
    isActive: true,
    meta: { packages: [], packageCategories: {}, isFinal: false, wizardStep: 1, wizardStepLabel: "" },
  });

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
      setCategoriesByPkg(newMap);
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
      setCategoriesByPkg((prev) => ({ ...newMap, ...prev }));
    }
    if (packages.length > 0) void loadAllCats();
  }, [packages]);
  function startCreate() {
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
    setOpen(true);
  }
  function toggleCategory(pkg: string, value: string) {
    const currentMap = (form.meta?.packageCategories ?? {}) as Record<string, string[]>;
    const current = Array.isArray(currentMap[pkg]) ? [...currentMap[pkg]] : [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    const newMap = { ...currentMap, [pkg]: next };
    setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), packageCategories: newMap } as StepRow["meta"] }));
  }

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
      const pkgCatsRaw = (form.meta?.packageCategories ?? {}) as Record<string, string[]>;
      const pkgCats = Object.fromEntries(Object.entries(pkgCatsRaw).filter(([k]) => selectedPkgs.includes(k)));
      const pkgShowWhenRaw = (form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>;
      const pkgShowWhen = Object.fromEntries(
        Object.entries(pkgShowWhenRaw)
          .filter(([k]) => selectedPkgs.includes(k))
          .map(([k, rules]) => [k, rules.filter((r) => r.package && (Array.isArray(r.category) ? r.category.length > 0 : !!r.category))]),
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
      const embeddedFlowLabel = typeof form.meta?.embeddedFlowLabel === "string" ? form.meta.embeddedFlowLabel.trim() : undefined;
      const payload = {
        label: form.label,
        value: form.value,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: !!form.isActive,
        valueType: "string",
        meta: {
          ...(form.meta ?? {}),
          packages: selectedPkgs,
          packageCategories: pkgCats,
          packageShowWhen: pkgShowWhen,
          categoryStepVisibility,
          wizardStep,
          wizardStepLabel,
          embeddedFlow: embeddedFlow || undefined,
          embeddedFlowLabel: embeddedFlowLabel || undefined,
        },
      };
      if (editing) {
        const res = await fetch(`/api/admin/form-options/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Update failed");
        toast.success("Updated");
      } else {
        const res = await fetch(`/api/admin/form-options`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ groupKey, ...payload }),
        });
        if (!res.ok) throw new Error("Create failed");
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
            {/* Categories per selected package */}
            {Array.isArray(form.meta?.packages) && (form.meta!.packages as string[]).length > 0 ? (
              <div className="grid gap-3">
                {(form.meta!.packages as string[]).map((pkg) => {
                  const pkgLabel = packages.find((p) => p.value === pkg)?.label ?? pkg;
                  const cats = categoriesByPkg[pkg] ?? [];
                  const selected = ((form.meta?.packageCategories ?? {}) as Record<string, string[]>)[pkg] ?? [];
                  const showWhenRules = ((form.meta?.packageShowWhen ?? {}) as Record<string, ShowWhenRule[]>)[pkg] ?? [];
                  const otherSelectedPkgs = (form.meta!.packages as string[]).filter((p) => p !== pkg);
                  return (
                    <div key={pkg} className="rounded-md border border-neutral-200 p-3 space-y-3 dark:border-neutral-800">
                      <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{pkgLabel}</div>
                      <div>
                        <Label className="text-xs">Categories (optional)</Label>
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {cats.map((c) => {
                            const isChecked = selected.includes(c.value);
                            return (
                              <label key={c.value} className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={isChecked} onChange={() => toggleCategory(pkg, c.value)} />
                                {c.label}
                              </label>
                            );
                          })}
                          {cats.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No categories for this package.</p> : null}
                        </div>
                      </div>
                      {/* Category → Step Mapping: map each selected category to steps that should be visible */}
                      {selected.length > 0 ? (
                        <div>
                          <Label className="text-xs">Category → Step Visibility</Label>
                          <p className="text-[10px] text-neutral-500 mb-1">
                            When a category is selected in the wizard, only the mapped steps will be shown. Leave empty to have no effect.
                          </p>
                          <div className="space-y-2">
                            {selected.map((catVal) => {
                              const catLabel = cats.find((c) => c.value === catVal)?.label ?? catVal;
                              const csvMap = (form.meta?.categoryStepVisibility ?? {}) as Record<string, string[]>;
                              const mappedSteps = csvMap[catVal] ?? [];
                              const otherRows = rows.filter((r) => r.value !== form.value);
                              if (otherRows.length === 0) return null;
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
                        </div>
                      ) : null}
                      <div>
                        <Label className="text-xs">Show only when (cross-package condition)</Label>
                        <p className="text-[10px] text-neutral-500 mb-1">Only show this package when another package&apos;s category matches. Leave empty to always show.</p>
                        {showWhenRules.map((rule, rIdx) => {
                          const ruleCats = categoriesByPkg[rule.package] ?? [];
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
                                {rule.package && ruleCats.length > 0 ? (
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
                    </div>
                  );
                })}
              </div>
            ) : null}
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
    </div>
  );
}


