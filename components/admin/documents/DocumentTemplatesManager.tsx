"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, CheckSquare, Square, ArrowLeft, Copy, Pencil, EyeOff, Eye, FlaskConical, Loader2, CheckCircle2, ChevronUp, ChevronDown } from "lucide-react";
import type {
  DocumentTemplateMeta,
  DocumentTemplateRow,
  TemplateSection,
  TemplateFieldMapping,
} from "@/lib/types/document-template";
import { resolveDocumentTemplateShowOn } from "@/lib/types/document-template";
import { FIELD_KEY_HINTS } from "@/lib/types/pdf-template";

const GROUP_KEY = "document_templates";
const EXTRA_DOCUMENT_FLOWS: { label: string; value: string }[] = [
  { label: "Agents", value: "agent" },
];

const TEMPLATE_TYPES: { value: DocumentTemplateMeta["type"]; label: string }[] =
  [
    { value: "quotation", label: "Quotation" },
    { value: "invoice", label: "Invoice" },
    { value: "receipt", label: "Receipt" },
    { value: "certificate", label: "Certificate" },
    { value: "letter", label: "Letter" },
    { value: "credit_note", label: "Credit Note" },
    { value: "debit_note", label: "Debit Note" },
    { value: "endorsement", label: "Endorsement" },
    { value: "statement", label: "Statement" },
    { value: "custom", label: "Custom" },
  ];

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "insured", label: "Insured Info" },
  { value: "contactinfo", label: "Contact Info" },
  { value: "package", label: "Package (custom)" },
  { value: "policy", label: "Policy Info" },
  { value: "agent", label: "Agent Info" },
  { value: "accounting", label: "Accounting / Premium" },
  { value: "statement", label: "Statement Items" },
  { value: "client", label: "Client Info" },
  { value: "organisation", label: "Organisation" },
  { value: "custom", label: "Custom (manual)" },
];

const FORMAT_OPTIONS: {
  value: NonNullable<TemplateFieldMapping["format"]>;
  label: string;
}[] = [
  { value: "text", label: "Text" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes/No" },
  { value: "number", label: "Number" },
];

function newSection(): TemplateSection {
  return {
    id: crypto.randomUUID(),
    title: "",
    source: "policy",
    fields: [],
  };
}

function newField(): TemplateFieldMapping {
  return { key: "", label: "", format: "text" };
}

function defaultMeta(): DocumentTemplateMeta {
  return {
    type: "quotation",
    flows: [],
    header: {
      title: "Quotation",
      subtitle: "",
      showDate: true,
      showPolicyNumber: true,
    },
    sections: [newSection()],
    footer: { text: "", showSignature: false },
  };
}

export default function DocumentTemplatesManager() {
  const [rows, setRows] = React.useState<DocumentTemplateRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<DocumentTemplateRow | null>(
    null,
  );

  const [formLabel, setFormLabel] = React.useState("");
  const [formValue, setFormValue] = React.useState("");
  const [formSort, setFormSort] = React.useState(0);
  const [meta, setMeta] = React.useState<DocumentTemplateMeta>(defaultMeta());

  const [packages, setPackages] = React.useState<
    { label: string; value: string }[]
  >([]);
  const [flows, setFlows] = React.useState<
    { label: string; value: string }[]
  >([]);
  const [statusOptions, setStatusOptions] = React.useState<{ label: string; value: string }[]>([]);
  const [availableInsurers, setAvailableInsurers] = React.useState<{ id: number; name: string }[]>([]);
  const [pkgFieldsCache, setPkgFieldsCache] = React.useState<Record<string, { key: string; label: string }[]>>({});
  const [validating, setValidating] = React.useState(false);
  const [validatePolicyNum, setValidatePolicyNum] = React.useState("");
  const [validationResult, setValidationResult] = React.useState<{
    policyNumber: string;
    totalFields: number;
    okCount: number;
    optionalCount: number;
    results: { id: string; source: string; fieldKey: string; resolved: unknown; status: "ok" | "optional" }[];
  } | null>(null);

  async function validateFields() {
    const allFields = meta.sections.flatMap((s) =>
      s.fields
        .filter((f) => f.key)
        .map((f, i) => ({
          id: `${s.id}-${i}`,
          source: s.source,
          fieldKey: f.key,
          packageName: s.packageName,
        })),
    );
    if (allFields.length === 0) {
      toast.error("No fields to validate — add fields first");
      return;
    }
    setValidating(true);
    setValidationResult(null);
    try {
      const payload: Record<string, unknown> = { fields: allFields, templateType: "document" };
      if (validatePolicyNum.trim()) {
        payload.policyNumber = validatePolicyNum.trim();
      }
      const res = await fetch("/api/admin/validate-template-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Validation failed");
      const data = await res.json();
      setValidationResult(data);
      const msg = data.okCount === data.totalFields
        ? `All ${data.totalFields} fields resolved against ${data.policyNumber}`
        : `${data.okCount}/${data.totalFields} fields resolved against ${data.policyNumber}`;
      data.okCount === data.totalFields ? toast.success(msg) : toast.info(msg);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  const loadPkgFields = React.useCallback(async (pkg: string) => {
    if (pkgFieldsCache[pkg]) return;
    try {
      const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}&all=true`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { label: string; value: string; isActive?: boolean }[];
      setPkgFieldsCache((prev) => ({
        ...prev,
        [pkg]: Array.isArray(data)
          ? data.filter((f) => f.isActive !== false).map((f) => ({ key: f.value, label: f.label }))
          : [],
      }));
    } catch { /* ignore */ }
  }, [pkgFieldsCache]);

  function getFieldsForSource(source: string, packageName?: string): { key: string; label: string }[] {
    if (source === "package" && packageName) {
      return pkgFieldsCache[packageName] ?? [];
    }
    const hints = (FIELD_KEY_HINTS as Record<string, string[]>)[source] ?? [];
    const base = hints.map((k) => ({
      key: k,
      label: k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim(),
    }));
    if (source === "accounting") {
      const merged = [...base, ...(pkgFieldsCache["premiumRecord"] ?? [])];
      return merged.filter((field, idx, arr) => arr.findIndex((f) => f.key === field.key) === idx);
    }
    if (base.length === 0) return [];
    if (source === "statement") {
      const premFields = pkgFieldsCache["premiumRecord"] ?? [];
      for (const pf of premFields) {
        base.push({ key: `item_${pf.key}`, label: `Item ${pf.label}` });
      }
    }
    return base;
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/form-options?groupKey=${GROUP_KEY}&all=true`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setRows([]);
        return;
      }
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  }

  async function loadLookups() {
    const [pkgRes, flowRes, statusRes, orgRes] = await Promise.all([
      fetch("/api/form-options?groupKey=packages", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/form-options?groupKey=flows", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/form-options?groupKey=policy_statuses", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/admin/organisations", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]);
    setPackages(
      (pkgRes as { label: string; value: string }[]).map((p) => ({
        label: p.label,
        value: p.value,
      })),
    );
    const flowOptions = [
      ...(flowRes as { label: string; value: string }[]).map((f) => ({
        label: f.label,
        value: f.value,
      })),
      ...EXTRA_DOCUMENT_FLOWS,
    ];
    const dedupedFlowOptions = flowOptions.filter(
      (f, i, arr) => arr.findIndex((x) => x.value.toLowerCase() === f.value.toLowerCase()) === i,
    );
    setFlows(dedupedFlowOptions);
    setStatusOptions(
      Array.isArray(statusRes) ? (statusRes as { label: string; value: string }[]).map((s) => ({ label: s.label, value: s.value })) : [],
    );
    setAvailableInsurers(
      Array.isArray(orgRes) ? (orgRes as { id: number; name: string }[]) : [],
    );
  }

  React.useEffect(() => {
    void load();
    void loadLookups();
    void loadPkgFields("premiumRecord");
  }, []);

  function startCreate() {
    setEditing(null);
    setFormLabel("");
    setFormValue("");
    setFormSort(0);
    setMeta(defaultMeta());
    setValidationResult(null);
    setOpen(true);
  }

  function startEdit(row: DocumentTemplateRow) {
    setEditing(row);
    setFormLabel(row.label);
    setFormValue(row.value);
    setFormSort(row.sortOrder);
    setMeta(row.meta ?? defaultMeta());
    setValidationResult(null);
    setOpen(true);
  }

  function startCopy(row: DocumentTemplateRow) {
    const existingKeys = new Set(rows.map((r) => r.value));
    let copyKey = `${row.value}_copy`;
    let counter = 2;
    while (existingKeys.has(copyKey)) {
      copyKey = `${row.value}_copy${counter}`;
      counter++;
    }

    const sourceMeta = row.meta ?? defaultMeta();
    const copiedMeta: DocumentTemplateMeta = {
      ...sourceMeta,
      sections: sourceMeta.sections.map((s) => ({
        ...s,
        id: crypto.randomUUID(),
        fields: s.fields.map((f) => ({ ...f })),
      })),
      header: { ...sourceMeta.header },
      footer: sourceMeta.footer ? { ...sourceMeta.footer } : undefined,
    };

    setEditing(null);
    setFormLabel(`${row.label} (Copy)`);
    setFormValue(copyKey);
    setFormSort(row.sortOrder + 1);
    setMeta(copiedMeta);
    setOpen(true);
  }

  async function save() {
    if (!formLabel.trim() || !formValue.trim()) {
      toast.error("Label and key are required");
      return;
    }
    const payload = {
      groupKey: GROUP_KEY,
      label: formLabel.trim(),
      value: formValue.trim(),
      sortOrder: formSort,
      isActive: true,
      valueType: "json",
      meta,
    };
    try {
      if (editing) {
        const res = await fetch(`/api/admin/form-options/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Template updated");
      } else {
        const res = await fetch("/api/admin/form-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Template created");
      }
      setOpen(false);
      await load();
    } catch (err: unknown) {
      toast.error(
        (err as { message?: string })?.message ?? "Save failed",
      );
    }
  }

  async function toggleActive(row: DocumentTemplateRow) {
    try {
      const res = await fetch(`/api/admin/form-options/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) throw new Error("Failed");
      await load();
    } catch {
      toast.error("Update failed");
    }
  }

  async function remove(row: DocumentTemplateRow) {
    if (!window.confirm(`Delete template "${row.label}"?`)) return;
    try {
      const res = await fetch(`/api/admin/form-options/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Deleted");
      await load();
    } catch (err: unknown) {
      toast.error(
        (err as { message?: string })?.message ?? "Delete failed",
      );
    }
  }

  function updateSection(idx: number, patch: Partial<TemplateSection>) {
    setMeta((m) => ({
      ...m,
      sections: m.sections.map((s, i) =>
        i === idx ? { ...s, ...patch } : s,
      ),
    }));
  }

  function removeSection(idx: number) {
    setMeta((m) => ({
      ...m,
      sections: m.sections.filter((_, i) => i !== idx),
    }));
  }

  function moveSection(idx: number, dir: -1 | 1) {
    setMeta((m) => {
      const to = idx + dir;
      if (to < 0 || to >= m.sections.length) return m;
      const next = [...m.sections];
      const [moved] = next.splice(idx, 1);
      next.splice(to, 0, moved);
      return { ...m, sections: next };
    });
  }

  function addField(sectionIdx: number) {
    setMeta((m) => ({
      ...m,
      sections: m.sections.map((s, i) =>
        i === sectionIdx ? { ...s, fields: [...s.fields, newField()] } : s,
      ),
    }));
  }

  function updateField(
    sectionIdx: number,
    fieldIdx: number,
    patch: Partial<TemplateFieldMapping>,
  ) {
    setMeta((m) => ({
      ...m,
      sections: m.sections.map((s, si) =>
        si === sectionIdx
          ? {
              ...s,
              fields: s.fields.map((f, fi) =>
                fi === fieldIdx ? { ...f, ...patch } : f,
              ),
            }
          : s,
      ),
    }));
  }

  function removeField(sectionIdx: number, fieldIdx: number) {
    setMeta((m) => ({
      ...m,
      sections: m.sections.map((s, si) =>
        si === sectionIdx
          ? { ...s, fields: s.fields.filter((_, fi) => fi !== fieldIdx) }
          : s,
      ),
    }));
  }

  function moveField(sectionIdx: number, fieldIdx: number, dir: -1 | 1) {
    setMeta((m) => ({
      ...m,
      sections: m.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        const to = fieldIdx + dir;
        if (to < 0 || to >= s.fields.length) return s;
        const nextFields = [...s.fields];
        const [moved] = nextFields.splice(fieldIdx, 1);
        nextFields.splice(to, 0, moved);
        return { ...s, fields: nextFields };
      }),
    }));
  }

  const [seeding, setSeeding] = React.useState(false);
  const [copyDropdownOpen, setCopyDropdownOpen] = React.useState(false);

  async function seedExamples() {
    setSeeding(true);
    try {
      const res = await fetch("/api/dev/seed-document-templates", {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      toast.success(
        (json.results as string[]).join("; ") || "Examples loaded",
      );
      await load();
    } catch (err: unknown) {
      toast.error(
        (err as { message?: string })?.message ?? "Failed to seed examples",
      );
    } finally {
      setSeeding(false);
    }
  }

  if (open) {
    return (
      <div className="space-y-6">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Templates
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>
              {editing ? "Save" : "Create"}
            </Button>
          </div>
        </div>

        <h2 className="text-lg font-semibold">
          {editing ? "Edit Template" : "Create Template"}
        </h2>

        <div className="grid gap-6">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="grid gap-1">
              <Label>Template Name</Label>
              <Input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="Motor Quotation"
              />
            </div>
            <div className="grid gap-1">
              <Label>Key</Label>
              <Input
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder="motor_quotation"
              />
            </div>
            <div className="grid gap-1">
              <Label>Type</Label>
              <select
                className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                value={meta.type}
                onChange={(e) =>
                  setMeta((m) => ({
                    ...m,
                    type: e.target.value as DocumentTemplateMeta["type"],
                  }))
                }
              >
                {TEMPLATE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={String(formSort)}
                onChange={(e) => setFormSort(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Flow restriction */}
          <div className="grid gap-1">
            <Label>
              Restrict to Flows{" "}
              <span className="text-xs text-neutral-400">(optional)</span>
            </Label>
            <div className="flex flex-wrap gap-3">
              {flows.map((f) => (
                <label
                  key={f.value}
                  className="flex items-center gap-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={meta.flows?.includes(f.value) ?? false}
                    onChange={(e) =>
                      setMeta((m) => ({
                        ...m,
                        flows: e.target.checked
                          ? [...(m.flows ?? []), f.value]
                          : (m.flows ?? []).filter((v) => v !== f.value),
                      }))
                    }
                  />
                  {f.label}
                </label>
              ))}
              {flows.length === 0 && (
                <span className="text-xs text-neutral-400">
                  No flows defined
                </span>
              )}
            </div>
          </div>

          {/* Show When Status */}
          {statusOptions.length > 0 && (
            <div className="grid gap-1">
              <Label>
                Show When Status{" "}
                <span className="text-xs text-neutral-400">(optional - empty = always)</span>
              </Label>
              <div className="flex flex-wrap gap-3">
                {statusOptions.map((s) => (
                  <label key={s.value} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={meta.showWhenStatus?.includes(s.value) ?? false}
                      onChange={(e) =>
                        setMeta((m) => ({
                          ...m,
                          showWhenStatus: e.target.checked
                            ? [...(m.showWhenStatus ?? []), s.value]
                            : (m.showWhenStatus ?? []).filter((v) => v !== s.value),
                        }))
                      }
                    />
                    {s.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-neutral-400">
                Default status rule used for both audiences unless overridden below.
              </p>
            </div>
          )}

          {statusOptions.length > 0 && (
            <div className="grid gap-1">
              <Label>
                Show When Status (Client Override){" "}
                <span className="text-xs text-neutral-400">(optional)</span>
              </Label>
              <div className="flex flex-wrap gap-3">
                {statusOptions.map((s) => (
                  <label key={`client-${s.value}`} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={meta.showWhenStatusClient?.includes(s.value) ?? false}
                      onChange={(e) =>
                        setMeta((m) => ({
                          ...m,
                          showWhenStatusClient: e.target.checked
                            ? [...(m.showWhenStatusClient ?? []), s.value]
                            : (m.showWhenStatusClient ?? []).filter((v) => v !== s.value),
                        }))
                      }
                    />
                    {s.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-neutral-400">
                When set, this overrides default status visibility for client documents only.
              </p>
            </div>
          )}

          {statusOptions.length > 0 && (
            <div className="grid gap-1">
              <Label>
                Show When Status (Agent Override){" "}
                <span className="text-xs text-neutral-400">(optional)</span>
              </Label>
              <div className="flex flex-wrap gap-3">
                {statusOptions.map((s) => (
                  <label key={`agent-${s.value}`} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={meta.showWhenStatusAgent?.includes(s.value) ?? false}
                      onChange={(e) =>
                        setMeta((m) => ({
                          ...m,
                          showWhenStatusAgent: e.target.checked
                            ? [...(m.showWhenStatusAgent ?? []), s.value]
                            : (m.showWhenStatusAgent ?? []).filter((v) => v !== s.value),
                        }))
                      }
                    />
                    {s.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-neutral-400">
                When set, this overrides default status visibility for agent documents only.
              </p>
            </div>
          )}

          {/* Insurance Company restriction */}
          {availableInsurers.length > 0 && (
            <div className="grid gap-1">
              <Label>
                Insurance Company{" "}
                <span className="text-xs text-neutral-400">(optional - empty = all companies)</span>
              </Label>
              <p className="text-xs text-neutral-400 mb-1">
                Restrict this template to policies linked to specific insurance companies.
              </p>
              <div className="flex flex-wrap gap-3">
                {availableInsurers.map((ins) => (
                  <label key={ins.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={meta.insurerPolicyIds?.includes(ins.id) ?? false}
                      onChange={(e) =>
                        setMeta((m) => ({
                          ...m,
                          insurerPolicyIds: e.target.checked
                            ? [...(m.insurerPolicyIds ?? []), ins.id]
                            : (m.insurerPolicyIds ?? []).filter((id) => id !== ins.id),
                        }))
                      }
                    />
                    {ins.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Document Prefix & Number */}
          <div className="grid gap-1">
            <Label>
              Document Number Prefix{" "}
              <span className="text-xs text-neutral-400">(e.g. QUO, INV, REC)</span>
            </Label>
            <Input
              value={meta.documentPrefix ?? ""}
              onChange={(e) => setMeta((m) => ({ ...m, documentPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))}
              placeholder="e.g. QUO"
              className="w-40"
              maxLength={10}
            />
            <p className="text-xs text-neutral-400">
              When set, a unique document number (e.g. QUO-2026-3847) is automatically assigned when the document is first sent.
            </p>
          </div>

          {/* Document Set Group */}
          {meta.documentPrefix && (
            <div className="grid gap-1">
              <Label>
                Document Set Group{" "}
                <span className="text-xs text-neutral-400">(optional)</span>
              </Label>
              <Input
                value={meta.documentSetGroup ?? ""}
                onChange={(e) => setMeta((m) => ({ ...m, documentSetGroup: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") || undefined }))}
                placeholder="e.g. main"
                className="w-40"
                maxLength={20}
              />
              <p className="text-xs text-neutral-400">
                Templates with the <strong>same group name</strong> share the same random number (e.g. QUO-2026-<strong>3847</strong>, INV-2026-<strong>3847</strong>, REC-2026-<strong>3847</strong>).
                Leave empty for independent numbering (e.g. credit notes).
              </p>
            </div>
          )}

          {/* Agent Template */}
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={meta.isAgentTemplate ?? false}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, isAgentTemplate: e.target.checked }))
                }
              />
              <span className="font-medium">Agent Template</span>
            </label>
            <p className="text-xs text-neutral-400 ml-6">
              Mark this as an agent copy. Document numbers will automatically have <strong>(A)</strong> appended (e.g. INV-2026-3847(A)).
              Use this for agent-facing versions with agent-specific premium fields (Agent Premium, Agent Commission, etc.).
              For statement documents, create a separate client billing template and a separate agent settlement template.
            </p>
          </div>

          {/* Placement */}
          <div className="grid gap-1">
            <Label>Show On</Label>
            {(() => {
              const placements = resolveDocumentTemplateShowOn(meta);
              const hasPolicy = placements.includes("policy");
              const hasAgent = placements.includes("agent");
              const togglePlacement = (placement: "policy" | "agent", checked: boolean) => {
                const current = new Set(resolveDocumentTemplateShowOn(meta));
                if (checked) current.add(placement);
                else current.delete(placement);
                const next = [...current];
                setMeta((m) => ({
                  ...m,
                  showOn: next.length > 0 ? next : ["policy"],
                }));
              };
              return (
                <div className="ml-1 space-y-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hasPolicy}
                      onChange={(e) => togglePlacement("policy", e.target.checked)}
                    />
                    <span>Policy Details</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hasAgent}
                      onChange={(e) => togglePlacement("agent", e.target.checked)}
                    />
                    <span>Agent Details</span>
                  </label>
                </div>
              );
            })()}
            <p className="text-xs text-neutral-400">
              Controls where this template is listed. Existing templates remain backward-compatible:
              agent statements default to Agent Details, others default to Policy Details.
            </p>
          </div>

          {/* Requires Statement (Payment Schedule) */}
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={meta.requiresStatement ?? false}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, requiresStatement: e.target.checked }))
                }
              />
              <span className="font-medium">Requires Statement</span>
            </label>
            <p className="text-xs text-neutral-400 ml-6">
              When enabled, this document will only display for audiences (client/agent) that are assigned to a Payment Schedule with an active statement.
              If no statement exists for the audience, the document sections and footer will be hidden.
              This is audience-specific, so a client statement and an agent statement should usually be separate templates.
            </p>
          </div>

          {/* Accounting Line Key */}
          <div className="grid gap-1">
            <Label>Cover Type (Accounting Line Key)</Label>
            <Input
              value={meta.accountingLineKey ?? ""}
              onChange={(e) =>
                setMeta((m) => ({ ...m, accountingLineKey: e.target.value.trim() || undefined }))
              }
              placeholder="e.g. tpo, od"
              className="max-w-xs"
            />
            <p className="text-xs text-neutral-400">
              <strong>Used for multi-cover policies</strong> (e.g. TPO + Own Damage).
              When a policy has multiple cover types, each cover type gets its own set of documents
              (quotation, invoice, debit note, receipt, etc.).
              Set this to the premium line key that this template belongs to
              (e.g. &ldquo;tpo&rdquo; or &ldquo;od&rdquo;).
            </p>
            <p className="text-xs text-neutral-400">
              <strong>Leave empty</strong> if this template applies to all policies regardless of cover type
              (e.g. single-cover policies, or shared documents like covernote/full policy).
            </p>
          </div>

          {/* Requires Confirmation */}
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={meta.requiresConfirmation !== undefined ? meta.requiresConfirmation : meta.type === "quotation"}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, requiresConfirmation: e.target.checked }))
                }
              />
              <span className="font-medium">Requires Confirmation</span>
            </label>
            <p className="text-xs text-neutral-400 ml-6">
              When enabled, a &ldquo;Confirm Received&rdquo; button appears after the document is sent.
              Typically used for quotations that need client acceptance. Invoices and receipts usually don&apos;t need this.
            </p>
          </div>

          {/* Header */}
          <fieldset className="rounded-md border border-neutral-200 p-4 dark:border-neutral-700">
            <legend className="px-1 text-sm font-medium">Header</legend>
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1">
                  <Label>Title</Label>
                  <Input
                    value={meta.header.title}
                    onChange={(e) =>
                      setMeta((m) => ({
                        ...m,
                        header: { ...m.header, title: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Subtitle</Label>
                  <Input
                    value={meta.header.subtitle ?? ""}
                    onChange={(e) =>
                      setMeta((m) => ({
                        ...m,
                        header: { ...m.header, subtitle: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={meta.header.showDate !== false}
                    onChange={(e) =>
                      setMeta((m) => ({
                        ...m,
                        header: { ...m.header, showDate: e.target.checked },
                      }))
                    }
                  />
                  Show Date
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={meta.header.showPolicyNumber !== false}
                    onChange={(e) =>
                      setMeta((m) => ({
                        ...m,
                        header: {
                          ...m.header,
                          showPolicyNumber: e.target.checked,
                        },
                      }))
                    }
                  />
                  Show Policy #
                </label>
              </div>
            </div>
          </fieldset>

          {/* Sections */}
          <fieldset className="rounded-md border border-neutral-200 p-4 dark:border-neutral-700">
            <legend className="px-1 text-sm font-medium">
              Sections &amp; Fields
            </legend>
            <div className="mb-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
              <strong>Tip:</strong> Select ALL fields you might need — fields with no data are <strong>automatically hidden</strong> when the document is generated. 
              For example, you can include <code className="rounded bg-blue-100 px-1 text-xs dark:bg-blue-900/50">make</code>, <code className="rounded bg-blue-100 px-1 text-xs dark:bg-blue-900/50">commake</code>, <code className="rounded bg-blue-100 px-1 text-xs dark:bg-blue-900/50">solomake</code> in one template — only the one with data will appear. No need for separate templates per vehicle type or insured type.
            </div>

            <div className="space-y-5">
              {meta.sections.map((section, sIdx) => {
                const availableFields = getFieldsForSource(section.source, section.packageName);
                const needsLoad = (section.source === "package" && section.packageName && !pkgFieldsCache[section.packageName])
                  || ((section.source === "accounting" || section.source === "statement") && !pkgFieldsCache["premiumRecord"]);
                if (section.source === "package" && needsLoad && section.packageName) void loadPkgFields(section.packageName);
                if ((section.source === "accounting" || section.source === "statement") && !pkgFieldsCache["premiumRecord"]) void loadPkgFields("premiumRecord");

                const selectedKeys = new Set(section.fields.map((f) => f.key));
                const allSelected = availableFields.length > 0 && availableFields.every((f) => selectedKeys.has(f.key));

                const toggleField = (fieldDef: { key: string; label: string }, checked: boolean) => {
                  if (checked) {
                    setMeta((m) => ({
                      ...m,
                      sections: m.sections.map((s, i) =>
                        i === sIdx
                          ? { ...s, fields: [...s.fields, { key: fieldDef.key, label: fieldDef.label, format: "text" }] }
                          : s,
                      ),
                    }));
                  } else {
                    removeField(sIdx, section.fields.findIndex((f) => f.key === fieldDef.key));
                  }
                };

                const selectAll = () => {
                  const existing = new Set(section.fields.map((f) => f.key));
                  const toAdd = availableFields.filter((f) => !existing.has(f.key));
                  setMeta((m) => ({
                    ...m,
                    sections: m.sections.map((s, i) =>
                      i === sIdx
                        ? { ...s, fields: [...s.fields, ...toAdd.map((f) => ({ key: f.key, label: f.label, format: "text" as const }))] }
                        : s,
                    ),
                  }));
                };

                const deselectAll = () => {
                  setMeta((m) => ({
                    ...m,
                    sections: m.sections.map((s, i) =>
                      i === sIdx ? { ...s, fields: [] } : s,
                    ),
                  }));
                };

                const audienceColor = section.audience === "client"
                  ? "border-blue-300 dark:border-blue-700"
                  : section.audience === "agent"
                    ? "border-amber-300 dark:border-amber-700"
                    : "border-neutral-200 dark:border-neutral-700";

                return (
                  <div
                    key={section.id}
                    className={`rounded-lg border p-4 ${audienceColor}`}
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Input
                        className="h-9 min-w-[220px] flex-1 text-sm"
                        placeholder="Section title"
                        value={section.title}
                        onChange={(e) =>
                          updateSection(sIdx, { title: e.target.value })
                        }
                      />
                      <select
                        className="h-9 min-w-[120px] rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                        value={section.source}
                        onChange={(e) => {
                          updateSection(sIdx, {
                            source: e.target.value as TemplateSection["source"],
                            fields: [],
                          });
                        }}
                      >
                        {SOURCE_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="h-9 min-w-[110px] rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                        value={section.audience ?? "all"}
                        onChange={(e) =>
                          updateSection(sIdx, {
                            audience: e.target.value as TemplateSection["audience"],
                          })
                        }
                        title="Audience"
                      >
                        <option value="all">All</option>
                        <option value="client">Client Only</option>
                        <option value="agent">Agent Only</option>
                      </select>
                      {section.source === "package" && (
                        <select
                          className="h-9 min-w-[160px] rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                          value={section.packageName ?? ""}
                          onChange={(e) => {
                            updateSection(sIdx, {
                              packageName: e.target.value,
                              fields: [],
                            });
                            if (e.target.value) void loadPkgFields(e.target.value);
                          }}
                        >
                          <option value="">Pick package...</option>
                          {packages.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => moveSection(sIdx, -1)}
                        className="h-9 w-9 shrink-0"
                        aria-label="Move section up"
                        disabled={sIdx === 0}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => moveSection(sIdx, 1)}
                        className="h-9 w-9 shrink-0"
                        aria-label="Move section down"
                        disabled={sIdx === meta.sections.length - 1}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeSection(sIdx)}
                        className="h-9 w-9 shrink-0 text-red-500"
                        aria-label="Remove section"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Field picker */}
                    {availableFields.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={allSelected ? deselectAll : selectAll}
                            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {allSelected ? (
                              <><Square className="h-4 w-4" /> Deselect All</>
                            ) : (
                              <><CheckSquare className="h-4 w-4" /> Select All</>
                            )}
                          </button>
                          <span className="text-sm text-neutral-400">
                            {selectedKeys.size}/{availableFields.length} selected
                          </span>
                        </div>
                        {(() => {
                          const groups: { label: string; fields: { key: string; label: string }[] }[] = [];
                          const labelMap = new Map<string, { key: string; label: string }[]>();
                          for (const fd of availableFields) {
                            const norm = fd.label.toLowerCase().trim();
                            if (!labelMap.has(norm)) {
                              labelMap.set(norm, []);
                              groups.push({ label: fd.label, fields: labelMap.get(norm)! });
                            }
                            labelMap.get(norm)!.push(fd);
                          }
                          return (
                            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
                              {groups.map((g) => {
                                const isMulti = g.fields.length > 1;
                                if (!isMulti) {
                                  const fd = g.fields[0];
                                  const isChecked = selectedKeys.has(fd.key);
                                  return (
                                    <label key={fd.key} className={`flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 py-2 transition-colors ${isChecked ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30" : "border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-600 dark:hover:border-neutral-500 dark:hover:bg-neutral-800/50"}`}>
                                      <input type="checkbox" checked={isChecked} onChange={(e) => toggleField(fd, e.target.checked)} className="h-4 w-4 shrink-0" />
                                      <span className="min-w-0">
                                        <span className={`block text-sm font-semibold leading-tight ${isChecked ? "text-blue-900 dark:text-blue-200" : "text-neutral-600 dark:text-neutral-400"}`}>{fd.label}</span>
                                        <span className="block text-[10px] leading-tight text-neutral-400 font-mono">{fd.key}</span>
                                      </span>
                                    </label>
                                  );
                                }
                                const anyChecked = g.fields.some((fd) => selectedKeys.has(fd.key));
                                return (
                                  <div key={g.label} className={`rounded-md border-2 p-2 transition-colors ${anyChecked ? "border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/20" : "border-neutral-300 dark:border-neutral-600"}`}>
                                    <div className="mb-1.5 text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{g.label}</div>
                                    <div className="space-y-1">
                                      {g.fields.map((fd) => {
                                        const isChecked = selectedKeys.has(fd.key);
                                        return (
                                          <label key={fd.key} className={`flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1 transition-colors ${isChecked ? "bg-blue-100 dark:bg-blue-900/40" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/50"}`}>
                                            <input type="checkbox" checked={isChecked} onChange={(e) => toggleField(fd, e.target.checked)} className="h-4 w-4 shrink-0" />
                                            <span className={`text-sm font-mono ${isChecked ? "font-semibold text-blue-900 dark:text-blue-200" : "text-neutral-500 dark:text-neutral-400"}`}>{fd.key}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* Selected fields - editable labels */}
                        {section.fields.length > 0 && (
                          <div className="mt-3 rounded-md border border-neutral-200 dark:border-neutral-700 overflow-x-auto">
                            <div className="min-w-[680px] flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-400">
                              {validationResult && <span className="w-5" />}
                              <span className="w-32">Field Key</span>
                              <span className="flex-1">Display Label (editable)</span>
                              <span className="w-20">Format</span>
                              <span className="w-24 text-center">Actions</span>
                            </div>
                            {section.fields.map((field, fIdx) => {
                              const vr = validationResult?.results.find((r) => r.id === `${section.id}-${fIdx}`);
                              return (
                              <div key={field.key} className="min-w-[680px] flex items-center gap-2 border-b border-neutral-100 px-3 py-1 last:border-b-0 dark:border-neutral-800">
                                {validationResult && (
                                  <span className="w-5 shrink-0 flex items-center justify-center" title={
                                    vr?.status === "ok" ? `Resolved: ${String(vr.resolved)}` : "Empty for this policy"
                                  }>
                                    {vr?.status === "ok" ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                    ) : vr ? (
                                      <span className="h-2.5 w-2.5 rounded-full bg-blue-400 dark:bg-blue-500" />
                                    ) : null}
                                  </span>
                                )}
                                <span className="w-32 shrink-0 text-xs font-mono text-neutral-400">{field.key}</span>
                                <Input
                                  className="h-7 flex-1 text-sm"
                                  value={field.label}
                                  onChange={(e) => updateField(sIdx, fIdx, { label: e.target.value })}
                                />
                                <select
                                  className="h-7 w-20 shrink-0 rounded border border-neutral-300 bg-white px-1 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                  value={field.format ?? "text"}
                                  onChange={(e) =>
                                    updateField(sIdx, fIdx, {
                                      format: e.target.value as TemplateFieldMapping["format"],
                                    })
                                  }
                                >
                                  {FORMAT_OPTIONS.map((fo) => (
                                    <option key={fo.value} value={fo.value}>{fo.label}</option>
                                  ))}
                                </select>
                                <div className="w-24 shrink-0 flex items-center justify-end gap-1">
                                  <Button
                                    size="iconCompact"
                                    variant="ghost"
                                    onClick={() => moveField(sIdx, fIdx, -1)}
                                    className="h-6 w-6 shrink-0"
                                    disabled={fIdx === 0}
                                    aria-label="Move field up"
                                  >
                                    <ChevronUp className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="iconCompact"
                                    variant="ghost"
                                    onClick={() => moveField(sIdx, fIdx, 1)}
                                    className="h-6 w-6 shrink-0"
                                    disabled={fIdx === section.fields.length - 1}
                                    aria-label="Move field down"
                                  >
                                    <ChevronDown className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="iconCompact"
                                    variant="ghost"
                                    onClick={() => removeField(sIdx, fIdx)}
                                    className="h-6 w-6 shrink-0 text-red-500"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : section.source === "package" && !section.packageName ? (
                      <p className="text-sm text-neutral-400 py-2">Select a package first</p>
                    ) : needsLoad ? (
                      <p className="text-sm text-neutral-400 py-2">Loading fields...</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm text-neutral-400">No predefined fields. Add manually:</p>
                        {section.fields.map((field, fIdx) => (
                          <div key={fIdx} className="flex items-center gap-2">
                            <Input
                              className="h-8 flex-1 text-sm"
                              placeholder="Field key"
                              value={field.key}
                              onChange={(e) => updateField(sIdx, fIdx, { key: e.target.value })}
                            />
                            <Input
                              className="h-8 flex-1 text-sm"
                              placeholder="Display label"
                              value={field.label}
                              onChange={(e) => updateField(sIdx, fIdx, { label: e.target.value })}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => moveField(sIdx, fIdx, -1)}
                              className="h-8 w-8 shrink-0"
                              disabled={fIdx === 0}
                              aria-label="Move field up"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => moveField(sIdx, fIdx, 1)}
                              className="h-8 w-8 shrink-0"
                              disabled={fIdx === section.fields.length - 1}
                              aria-label="Move field down"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => removeField(sIdx, fIdx)}
                              className="h-8 w-8 shrink-0 text-red-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => addField(sIdx)}>
                          <Plus className="h-4 w-4" /> Add Field
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              size="sm"
              variant="outline"
              className="mt-4 gap-1"
              onClick={() =>
                setMeta((m) => ({
                  ...m,
                  sections: [...m.sections, newSection()],
                }))
              }
            >
              <Plus className="h-4 w-4" /> Add Section
            </Button>
          </fieldset>

          {/* Footer */}
          <fieldset className="rounded-md border border-neutral-200 p-4 dark:border-neutral-700">
            <legend className="px-1 text-sm font-medium">Footer</legend>
            <div className="grid gap-3">
              <div className="grid gap-1">
                <Label>Footer Text</Label>
                <Input
                  value={meta.footer?.text ?? ""}
                  onChange={(e) =>
                    setMeta((m) => ({
                      ...m,
                      footer: { ...m.footer, text: e.target.value },
                    }))
                  }
                  placeholder="Terms and conditions apply..."
                />
              </div>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={meta.footer?.showSignature ?? false}
                  onChange={(e) =>
                    setMeta((m) => ({
                      ...m,
                      footer: {
                        ...m.footer,
                        showSignature: e.target.checked,
                      },
                    }))
                  }
                />
                Show Signature Lines
              </label>
            </div>
          </fieldset>
        </div>

        {/* Validation result */}
        {validationResult && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              Tested against <strong>{validationResult.policyNumber}</strong>
              {" — "}<span className="font-medium">{validationResult.okCount} resolved</span>
              {validationResult.optionalCount > 0 && (
                <span className="text-blue-600 dark:text-blue-400">, {validationResult.optionalCount} empty for this policy</span>
              )}
            </span>
          </div>
        )}

        {/* Bottom save bar */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <div className="mr-auto flex items-center gap-2">
            <Input
              placeholder="Policy number (optional)"
              value={validatePolicyNum}
              onChange={(e) => setValidatePolicyNum(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && validateFields()}
              className="h-8 w-48 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={validateFields}
              disabled={validating}
              className="gap-1.5"
            >
              {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Validate
            </Button>
          </div>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>
            {editing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-500 dark:text-neutral-400">
          {rows.length} template{rows.length !== 1 ? "s" : ""}
        </div>
        <div className="flex items-center gap-2">
          {rows.length === 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={seedExamples}
              disabled={seeding}
            >
              {seeding ? "Loading..." : "Load Examples"}
            </Button>
          )}
          {rows.length > 0 && (
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCopyDropdownOpen((v) => !v)}
              >
                <Copy className="h-4 w-4 sm:hidden lg:inline" />
                <span className="hidden sm:inline">Copy Template</span>
              </Button>
              {copyDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCopyDropdownOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                    {rows.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setCopyDropdownOpen(false);
                          startCopy(r);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <span className="min-w-0 truncate font-medium">{r.label}</span>
                        <span className="shrink-0 text-xs text-neutral-400 font-mono">{r.meta?.type ?? ""}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Create Template</span>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden sm:table-cell">Sections</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isActive ? "" : "opacity-50"}>
                <TableCell>
                  <div className="font-medium">
                    {r.label}
                    {r.meta?.isAgentTemplate && (
                      <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        AGENT
                      </span>
                    )}
                    {r.meta?.accountingLineKey && (
                      <span className="ml-2 inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                        Line: {r.meta.accountingLineKey}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
                    {r.value}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell capitalize">
                  {r.meta?.type ?? "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {r.meta?.sections?.length ?? 0}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => startEdit(r)}
                    >
                      <Pencil className="h-4 w-4 sm:hidden lg:inline" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={r.isActive ? "outline" : "default"}
                      onClick={() => toggleActive(r)}
                    >
                      {r.isActive ? (
                        <>
                          <EyeOff className="h-4 w-4 sm:hidden lg:inline" />
                          <span className="hidden sm:inline">Disable</span>
                        </>
                      ) : (
                        <>
                          <Eye className="h-4 w-4 sm:hidden lg:inline" />
                          <span className="hidden sm:inline">Enable</span>
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => remove(r)}
                    >
                      <Trash2 className="h-4 w-4 sm:hidden lg:inline" />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400"
                >
                  No templates yet. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
