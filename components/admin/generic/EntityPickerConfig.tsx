"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Plus } from "lucide-react";
import { usePkgFields } from "@/hooks/use-pkg-fields";

export type EntityPickerMapping = {
  sourceField: string;
  targetField: string;
};

export type EntityPickerConfig = {
  flow: string;
  buttonLabel?: string;
  sourcePackage?: string;
  mappings: EntityPickerMapping[];
};

export function EntityPickerConfigEditor({
  value,
  onChange,
  currentPkg,
  targetFields: targetFieldsOverride,
}: {
  value: EntityPickerConfig | undefined;
  onChange: (next: EntityPickerConfig | undefined) => void;
  currentPkg: string;
  targetFields?: { label: string; value: string }[];
}) {
  const [flows, setFlows] = React.useState<{ label: string; value: string }[]>([]);
  const { pkgFieldsCache, loadPkgFields } = usePkgFields();
  const [sourcePkgs, setSourcePkgs] = React.useState<{ label: string; value: string }[]>([]);
  const [selectedSourcePkg, setSelectedSourcePkg] = React.useState<string>(value?.sourcePackage ?? "");

  React.useEffect(() => {
    async function loadFlows() {
      try {
        const res = await fetch("/api/admin/form-options?groupKey=flows", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        setFlows(Array.isArray(data) ? data : []);
      } catch { /* ignore */ }
    }
    void loadFlows();
  }, []);

  React.useEffect(() => {
    void loadPkgFields(currentPkg);
  }, [currentPkg, loadPkgFields]);

  const selectedFlow = value?.flow;
  React.useEffect(() => {
    if (!selectedFlow) return;
    async function loadFlowPkgs() {
      try {
        const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(`${selectedFlow}_steps`)}`, { cache: "no-store" });
        if (!res.ok) {
          const pkgRes = await fetch("/api/admin/form-options?groupKey=packages", { cache: "no-store" });
          if (!pkgRes.ok) return;
          const pkgData = (await pkgRes.json()) as { label: string; value: string }[];
          setSourcePkgs(Array.isArray(pkgData) ? pkgData : []);
          return;
        }
        const stepsData = (await res.json()) as { meta?: { packages?: string[] } }[];
        const allPkgs = new Set<string>();
        for (const s of Array.isArray(stepsData) ? stepsData : []) {
          for (const p of s.meta?.packages ?? []) allPkgs.add(p);
        }
        if (allPkgs.size === 0) {
          const pkgRes = await fetch("/api/admin/form-options?groupKey=packages", { cache: "no-store" });
          if (!pkgRes.ok) return;
          const pkgData = (await pkgRes.json()) as { label: string; value: string }[];
          setSourcePkgs(Array.isArray(pkgData) ? pkgData : []);
          return;
        }
        const pkgRes = await fetch("/api/admin/form-options?groupKey=packages", { cache: "no-store" });
        const pkgData = pkgRes.ok ? ((await pkgRes.json()) as { label: string; value: string }[]) : [];
        const pkgArr = Array.isArray(pkgData) ? pkgData : [];
        setSourcePkgs(pkgArr.filter((p) => allPkgs.has(p.value)));
      } catch { /* ignore */ }
    }
    void loadFlowPkgs();
  }, [selectedFlow]);

  React.useEffect(() => {
    if (selectedSourcePkg) {
      void loadPkgFields(selectedSourcePkg);
    }
  }, [selectedSourcePkg, loadPkgFields]);

  React.useEffect(() => {
    if (selectedFlow) {
      void loadPkgFields("insured");
    }
  }, [selectedFlow, loadPkgFields]);

  if (!value) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
        <Label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Entity Picker</Label>
        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          Allow users to browse &amp; select an existing record from another flow and auto-fill mapped fields.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => onChange({ flow: "", buttonLabel: "", mappings: [] })}
        >
          <Plus className="mr-1 h-3 w-3" /> Enable Entity Picker
        </Button>
      </div>
    );
  }

  const currentPkgFields = targetFieldsOverride ?? (pkgFieldsCache[currentPkg] ?? []);
  const policyTopLevelFields = [
    { value: "policyNumber", label: "Policy Number" },
    { value: "policyId", label: "Policy ID" },
    { value: "insuredDisplayName", label: "Insured Display Name (auto: company or personal)" },
    { value: "insuredType", label: "Insured Type (company/personal)" },
  ];
  const insuredFields = (pkgFieldsCache["insured"] ?? []).map((f) => ({ value: f.value, label: f.label }));
  const selectedPkgFields = selectedSourcePkg && selectedSourcePkg !== "insured"
    ? (pkgFieldsCache[selectedSourcePkg] ?? []).map((f) => ({ value: f.value, label: f.label }))
    : [];
  const sourceFieldGroups: { group: string; fields: { value: string; label: string }[] }[] = [
    { group: "Policy", fields: policyTopLevelFields },
    ...(insuredFields.length > 0 ? [{ group: "Insured", fields: insuredFields }] : []),
    ...(selectedPkgFields.length > 0 ? [{ group: sourcePkgs.find((p) => p.value === selectedSourcePkg)?.label ?? selectedSourcePkg, fields: selectedPkgFields }] : []),
  ];
  const hasSourceOptions = sourceFieldGroups.some((g) => g.fields.length > 0);

  return (
    <div className="space-y-3 rounded-md border border-neutral-300 p-3 dark:border-neutral-700">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Entity Picker</Label>
        <Button
          type="button"
          size="iconCompact"
          variant="ghost"
          onClick={() => onChange(undefined)}
          aria-label="Remove entity picker"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-xs">Source Flow</Label>
          <select
            className="h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            value={value.flow}
            onChange={(e) => {
              setSelectedSourcePkg("");
              onChange({ ...value, flow: e.target.value, sourcePackage: "", mappings: [] });
            }}
          >
            <option value="">-- Select flow --</option>
            {flows.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Button Label</Label>
          <Input
            className="h-8 text-xs"
            placeholder='e.g. "Select Existing Collaborator"'
            value={value.buttonLabel ?? ""}
            onChange={(e) => onChange({ ...value, buttonLabel: e.target.value })}
          />
        </div>
      </div>

      {value.flow && (
        <div className="space-y-2">
          <Label className="text-xs font-medium">Field Mappings</Label>
          <div className="space-y-1">
            <Label className="text-[10px] text-neutral-400">Source Package (for mapping)</Label>
            <select
              className="h-8 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
              value={selectedSourcePkg}
              onChange={(e) => {
                setSelectedSourcePkg(e.target.value);
                onChange({ ...value, sourcePackage: e.target.value });
              }}
            >
              <option value="">-- Select source package --</option>
              {sourcePkgs.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {value.mappings.map((m, idx) => (
            <div key={idx} className="flex items-end gap-1">
              <div className="flex-1 space-y-0.5">
                <Label className="text-[10px] text-neutral-400">Source field</Label>
                {hasSourceOptions ? (
                  <select
                    className="h-7 w-full rounded border border-neutral-200 bg-white px-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={m.sourceField}
                    onChange={(e) => {
                      const next = [...value.mappings];
                      next[idx] = { ...next[idx], sourceField: e.target.value };
                      onChange({ ...value, mappings: next });
                    }}
                  >
                    <option value="">-- field --</option>
                    {sourceFieldGroups.map((g) =>
                      g.fields.length > 0 ? (
                        <optgroup key={g.group} label={g.group}>
                          {g.fields.map((f) => (
                            <option key={`${g.group}_${f.value}`} value={f.value}>{f.label} ({f.value})</option>
                          ))}
                        </optgroup>
                      ) : null
                    )}
                  </select>
                ) : (
                  <Input
                    className="h-7 text-[11px]"
                    value={m.sourceField}
                    placeholder="field key"
                    onChange={(e) => {
                      const next = [...value.mappings];
                      next[idx] = { ...next[idx], sourceField: e.target.value };
                      onChange({ ...value, mappings: next });
                    }}
                  />
                )}
              </div>
              <span className="mb-1 text-xs text-neutral-400">&rarr;</span>
              <div className="flex-1 space-y-0.5">
                <Label className="text-[10px] text-neutral-400">Target field</Label>
                {currentPkgFields.length > 0 ? (
                  <select
                    className="h-7 w-full rounded border border-neutral-200 bg-white px-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={m.targetField}
                    onChange={(e) => {
                      const next = [...value.mappings];
                      next[idx] = { ...next[idx], targetField: e.target.value };
                      onChange({ ...value, mappings: next });
                    }}
                  >
                    <option value="">-- field --</option>
                    {currentPkgFields.map((f) => (
                      <option key={f.value} value={f.value}>{f.label} ({f.value})</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="h-7 text-[11px]"
                    value={m.targetField}
                    placeholder="field key"
                    onChange={(e) => {
                      const next = [...value.mappings];
                      next[idx] = { ...next[idx], targetField: e.target.value };
                      onChange({ ...value, mappings: next });
                    }}
                  />
                )}
              </div>
              <Button
                type="button"
                size="iconCompact"
                variant="ghost"
                className="mb-0.5"
                onClick={() => {
                  const next = value.mappings.filter((_, i) => i !== idx);
                  onChange({ ...value, mappings: next });
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() =>
              onChange({
                ...value,
                mappings: [...value.mappings, { sourceField: "", targetField: "" }],
              })
            }
          >
            <Plus className="mr-1 h-3 w-3" /> Add Mapping
          </Button>
        </div>
      )}
    </div>
  );
}
