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
import { Plus, Trash2, ArrowLeft, Copy, Pencil, EyeOff, Eye, FlaskConical, Loader2, CheckCircle2, ChevronUp, ChevronDown, Monitor, Layers, Crown } from "lucide-react";
import {
  SortableList,
  SortableHandle,
  useSortableItem,
  reorderItems,
} from "@/components/ui/sortable-list";
import { DocumentTemplateLivePreview } from "./DocumentTemplateLivePreview";
import { SectionApplyToOthersDialog } from "./SectionApplyToOthersDialog";
import { SyncFromMasterDialog } from "./SyncFromMasterDialog";
import { SyncAllTargetsPickerDialog } from "./SyncAllTargetsPickerDialog";
import { RowActionMenu, type RowAction } from "@/components/ui/row-action-menu";
import type {
  DocumentTemplateMeta,
  DocumentTemplateRow,
  TemplateSection,
  TemplateFieldMapping,
} from "@/lib/types/document-template";
import { resolveDocumentTemplateShowOn } from "@/lib/types/document-template";
import {
  mergeSectionsFromMaster,
  BROADCAST_PROPERTIES,
} from "@/lib/document-template-sync";
import { confirmDialog, alertDialog } from "@/components/ui/global-dialogs";
import { FIELD_KEY_HINTS } from "@/lib/types/pdf-template";

const GROUP_KEY = "document_templates";

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

const ALL_SOURCE_OPTIONS: { value: string; label: string; forTypes?: string[] }[] = [
  { value: "insured", label: "Insured Info" },
  { value: "contactinfo", label: "Contact Info" },
  { value: "package", label: "Package (custom)" },
  { value: "policy", label: "Policy Info" },
  { value: "agent", label: "Agent Info" },
  { value: "accounting", label: "Premium" },
  { value: "statement", label: "Statement Data", forTypes: ["statement"] },
  { value: "client", label: "Client Info" },
  { value: "organisation", label: "Insurance Company" },
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
  const [pkgFieldsCache, setPkgFieldsCache] = React.useState<Record<string, { key: string; label: string; group?: string }[]>>({});
  const [saving, setSaving] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [validatePolicyNum, setValidatePolicyNum] = React.useState("");
  const [showPreview, setShowPreview] = React.useState(false);
  const [applySectionIdx, setApplySectionIdx] = React.useState<number | null>(null);
  const [showSyncFromMaster, setShowSyncFromMaster] = React.useState(false);
  const [validationResult, setValidationResult] = React.useState<{
    policyNumber: string;
    totalFields: number;
    okCount: number;
    optionalCount: number;
    results: {
      id: string;
      source: string;
      fieldKey: string;
      resolved: unknown;
      /** Final string the document will print (option-mapped + formatted). */
      display?: string;
      status: "ok" | "optional";
    }[];
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
          format: f.format,
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
      if (data.okCount === data.totalFields) toast.success(msg); else toast.info(msg);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  const loadingPkgs = React.useRef<Set<string>>(new Set());
  const loadPkgFields = React.useCallback(async (pkg: string) => {
    if (loadingPkgs.current.has(pkg)) return;
    loadingPkgs.current.add(pkg);
    try {
      const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}&all=true`, { cache: "no-store" });
      if (!res.ok) {
        loadingPkgs.current.delete(pkg);
        return;
      }
      const data = (await res.json()) as {
        label: string;
        value: string;
        isActive?: boolean;
        meta?: { group?: string | string[] | null } | null;
      }[];
      setPkgFieldsCache((prev) => ({
        ...prev,
        [pkg]: Array.isArray(data)
          ? data
              .filter((f) => f.isActive !== false)
              .map((f) => {
                // meta.group is set in the Package Fields editor and may be a
                // string or string[] (a field can belong to multiple groups
                // for show-when logic). For document-template grouping each
                // field lives in exactly one bucket, so collapse arrays to
                // the first non-empty entry. Empty / missing => no group.
                const raw = f.meta?.group;
                let group: string | undefined;
                if (Array.isArray(raw)) {
                  const first = raw.map((g) => String(g ?? "").trim()).find(Boolean);
                  group = first || undefined;
                } else if (typeof raw === "string" && raw.trim()) {
                  group = raw.trim();
                }
                return { key: f.value, label: f.label, group };
              })
          : [],
      }));
    } catch {
      loadingPkgs.current.delete(pkg);
    }
  }, []);

  function getFieldsForSource(source: string, packageName?: string): { key: string; label: string; group?: string }[] {
    if (source === "package" && packageName) {
      return pkgFieldsCache[packageName] ?? [];
    }
    const LABEL_OVERRIDES: Record<string, string> = {
      activeTotal: "Total Due",
      paidIndividuallyTotal: "Client Paid Directly",
      commissionTotal: "Commission",
      outstandingTotal: "Outstanding",
      creditToAgent: "Credit to Agent",
      agentPaidTotal: "Agent Paid",
      totalAmountCents: "Total Amount",
      paidAmountCents: "Paid Amount",
      policyPremiumTotal: "Policy Premium Total",
      endorsementPremiumTotal: "Endorsement Premium Total",
      creditTotal: "Credit Total",
      itemCount: "Item Count",
      activeItemCount: "Active Item Count",
      paidIndividuallyItemCount: "Client Paid Item Count",
      itemDescriptions: "Item Descriptions",
      itemAmounts: "Item Amounts",
      itemStatuses: "Item Statuses",
      itemPaymentBadges: "Payment Badges",
    };
    const hints = (FIELD_KEY_HINTS as Record<string, string[]>)[source] ?? [];
    const base: { key: string; label: string; group?: string }[] = hints.map((k) => ({
      key: k,
      label: LABEL_OVERRIDES[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim(),
    }));

    const dynamicSourceMap: Record<string, string> = {
      accounting: "premiumRecord",
      insured: "insured",
      contactinfo: "contactinfo",
    };
    const dynamicPkg = dynamicSourceMap[source];
    if (dynamicPkg) {
      const dynFields = pkgFieldsCache[dynamicPkg] ?? [];
      const merged = [...base, ...dynFields];
      return merged.filter((field, idx, arr) => arr.findIndex((f) => f.key === field.key) === idx);
    }

    if (source === "statement") {
      const infoKeys = new Set(["statementNumber", "statementDate", "statementStatus", "entityName", "entityType", "currency"]);
      const policyEndoKeys = new Set(["policyPremiumTotal", "endorsementPremiumTotal", "creditTotal", "commissionTotal", "creditToAgent"]);
      const countKeys = new Set(["itemCount", "activeItemCount", "paidIndividuallyItemCount"]);
      const listKeys = new Set(["itemDescriptions", "itemAmounts", "itemStatuses", "itemPaymentBadges"]);
      for (const f of base) {
        if (infoKeys.has(f.key)) f.group = "Statement Info";
        else if (policyEndoKeys.has(f.key)) f.group = "Policy vs Endorsement Totals";
        else if (countKeys.has(f.key) || listKeys.has(f.key)) f.group = "Line Item Counts & Lists";
        else f.group = "Amount Totals";
      }
      const premFields = pkgFieldsCache["premiumRecord"] ?? [];
      for (const pf of premFields) {
        base.push({ key: `item_${pf.key}`, label: `${pf.label}`, group: "Line Item Premium Breakdown" });
      }
    }

    if (source === "policy") {
      // Policy Info exposes ONLY the real columns of the `policies` table
      // plus the `documentTracking` JSON column. Everything else lives in a
      // package snapshot (e.g. effectiveDate / expiryDate are in the
      // `policyinfo` package). Group them so the distinction is visible.
      const documentKeys = new Set([
        "documentNumber", "documentStatus", "documentSentTo", "documentSentAt",
      ]);
      for (const f of base) {
        if (documentKeys.has(f.key)) f.group = "Document Tracking";
        else f.group = "Policy Record";
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
    setFlows(
      (flowRes as { label: string; value: string }[]).map((f) => ({
        label: f.label,
        value: f.value,
      })),
    );
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
  }, [loadPkgFields]);

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
    const duplicate = rows.find(
      (r) => r.value === formValue.trim() && r.id !== editing?.id,
    );
    if (duplicate) {
      toast.error(`Key "${formValue.trim()}" is already used by "${duplicate.label}"`);
      return;
    }
    setSaving(true);
    // Re-snapshot each field's `group` from the latest package definitions
    // (when those definitions are loaded in this session). Saves done before
    // we added group support thus auto-upgrade as soon as the user opens
    // the template, and a field whose package group has been removed will
    // also have its stale group cleared.
    const metaToSave: typeof meta = {
      ...meta,
      sections: meta.sections.map((s) => {
        const af = getFieldsForSource(s.source, s.packageName);
        if (af.length === 0) return s;
        const groupOf = new Map(af.map((f) => [f.key, f.group ?? null] as const));
        return {
          ...s,
          fields: s.fields.map((f) => {
            if (!groupOf.has(f.key)) return f;
            const next = groupOf.get(f.key) || undefined;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { group: _drop, ...rest } = f;
            return next ? { ...rest, group: next } : rest;
          }),
        };
      }),
    };
    const payload = {
      groupKey: GROUP_KEY,
      label: formLabel.trim(),
      value: formValue.trim(),
      sortOrder: formSort,
      isActive: true,
      valueType: "json",
      meta: metaToSave,
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
    } finally {
      setSaving(false);
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

  async function setMaster(row: DocumentTemplateRow) {
    const isAlreadyMaster = !!row.meta?.isMaster;
    if (!row.meta) {
      toast.error("Template has no metadata yet — open Edit and save first");
      return;
    }
    try {
      if (isAlreadyMaster) {
        // === UNSET branch ===
        // The row we clicked IS the master, so PATCH IT to drop the flag.
        // The previous code only ever PATCHed "the other master row", which
        // doesn't exist in the unset case, so the request never fired.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { isMaster: _drop, ...unsetMeta } = row.meta;
        const res = await fetch(`/api/admin/form-options/${row.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meta: unsetMeta }),
        });
        if (!res.ok) throw new Error(`Failed (HTTP ${res.status})`);
        toast.success(`"${row.label}" is no longer the Master`);
      } else {
        // === SET branch ===
        // First demote any other row that currently holds the flag, then
        // promote this one. Run sequentially so we never have two masters.
        const currentMaster = rows.find(
          (r) => r.id !== row.id && r.meta?.isMaster,
        );
        if (currentMaster?.meta) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { isMaster: _drop, ...unsetMeta } = currentMaster.meta;
          const unsetRes = await fetch(`/api/admin/form-options/${currentMaster.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ meta: unsetMeta }),
          });
          if (!unsetRes.ok) {
            throw new Error(`Failed to clear current master (HTTP ${unsetRes.status})`);
          }
        }
        const newMeta = { ...row.meta, isMaster: true };
        const res = await fetch(`/api/admin/form-options/${row.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meta: newMeta }),
        });
        if (!res.ok) throw new Error(`Failed (HTTP ${res.status})`);
        toast.success(`"${row.label}" is now the Master template`);
      }
      await load();
    } catch (err) {
      toast.error((err as Error)?.message ?? "Failed to update master");
    }
  }

  /**
   * Broadcast the master's section configuration to every other ACTIVE
   * template. For each target:
   *   - Matched sections receive: fields, columns, layout, audience
   *     (NOT title — preserves each template's own wording).
   *   - Master sections that don't exist in the target are appended.
   *   - Header, type, flows, and all other per-document settings are untouched.
   *
   * Inactive templates are skipped on purpose so a deprecated/draft template
   * doesn't get silently revived or rewritten.
   *
   * Document types in `EXCLUDE_TYPES_FROM_BROADCAST` are also skipped because
   * their section structure has nothing in common with the typical
   * policy-style templates a master tends to define. Specifically:
   *   - "statement"   — statements use the dedicated `statement` source plus
   *                     line-item totals; pulling sections from a quotation
   *                     master would clobber their structure with irrelevant
   *                     policy fields.
   * Skipped templates show up in the results dialog with reason "skipped:
   * type=<name>" so the admin can see they were intentionally left alone.
   */
  const EXCLUDE_TYPES_FROM_BROADCAST: ReadonlySet<NonNullable<DocumentTemplateMeta["type"]>> =
    React.useMemo(() => new Set<NonNullable<DocumentTemplateMeta["type"]>>(["statement"]), []);

  // Type-code -> human label map for the picker's per-row badge.
  // Built once from TEMPLATE_TYPES so adding a new type in one place updates both.
  const TYPE_LABELS: Record<string, string> = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of TEMPLATE_TYPES) {
      if (t.value) map[t.value] = t.label;
    }
    return map;
  }, []);

  // Picker state for "Sync All from Master". Uses a stored Promise resolver
  // so the async syncAllFromMaster() flow can `await` the user's selection
  // exactly like a confirmDialog. Cleared on resolve.
  const [pickerState, setPickerState] = React.useState<{
    master: DocumentTemplateRow;
    candidates: DocumentTemplateRow[];
    resolve: (ids: number[] | null) => void;
  } | null>(null);

  function pickSyncTargets(
    master: DocumentTemplateRow,
    candidates: DocumentTemplateRow[],
  ): Promise<number[] | null> {
    return new Promise<number[] | null>((resolve) => {
      setPickerState({ master, candidates, resolve });
    });
  }

  const [syncingAll, setSyncingAll] = React.useState(false);
  async function syncAllFromMaster(masterRow: DocumentTemplateRow) {
    if (!masterRow.meta) return;
    const candidates = rows.filter((r) => r.id !== masterRow.id && r.isActive && r.meta);
    const skippedByType = candidates.filter(
      (r) => r.meta?.type && EXCLUDE_TYPES_FROM_BROADCAST.has(r.meta.type),
    );
    const compatibleCount = candidates.length - skippedByType.length;
    if (compatibleCount === 0) {
      toast.info(
        skippedByType.length > 0
          ? `No syncable templates (skipped ${skippedByType.length} by type)`
          : "No other active templates to sync",
      );
      return;
    }

    // Open picker and let the admin choose which compatible templates to hit.
    const selectedIds = await pickSyncTargets(masterRow, candidates);
    if (!selectedIds || selectedIds.length === 0) return;
    const selectedSet = new Set(selectedIds);
    const targets = candidates.filter((c) => selectedSet.has(c.id));
    if (targets.length === 0) return;
    // Compatible templates the user explicitly deselected — surfaced in the
    // results dialog so it's clear they were intentionally left alone.
    const skippedByUser = candidates.filter(
      (c) =>
        !selectedSet.has(c.id) &&
        (!c.meta?.type || !EXCLUDE_TYPES_FROM_BROADCAST.has(c.meta.type)),
    );

    setSyncingAll(true);
    type PerTargetResult = {
      label: string;
      updated: { masterTitle: string; targetTitle: string; reason: string }[];
      appended: { masterTitle: string; reason: "no-match" | "collision" }[];
      untouched: string[];
      saved: boolean;
      error?: string;
    };
    const perTarget: PerTargetResult[] = [];

    try {
      // Run sequentially to avoid hammering the API and to keep error handling simple.
      for (const target of targets) {
        const result: PerTargetResult = {
          label: target.label,
          updated: [],
          appended: [],
          untouched: [],
          saved: false,
        };
        try {
          const merge = mergeSectionsFromMaster(
            target.meta!,
            masterRow.meta!,
            { properties: BROADCAST_PROPERTIES, appendNewSections: true },
          );
          result.updated = merge.updated;
          result.appended = merge.appended;
          result.untouched = merge.untouchedTargetTitles;
          if (merge.updatedCount === 0 && merge.appendedCount === 0) {
            // Nothing to do for this target — skip the network call but still record.
            perTarget.push(result);
            continue;
          }
          const res = await fetch(`/api/admin/form-options/${target.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ meta: merge.meta }),
          });
          if (!res.ok) {
            result.error = `HTTP ${res.status}`;
          } else {
            result.saved = true;
          }
        } catch (err) {
          result.error = (err as Error)?.message ?? "request failed";
        }
        perTarget.push(result);
      }

      const savedCount = perTarget.filter((r) => r.saved).length;
      const noChangeCount = perTarget.filter(
        (r) => !r.error && !r.saved && r.updated.length === 0 && r.appended.length === 0,
      ).length;
      const failedCount = perTarget.filter((r) => r.error).length;
      const updatedTotal = perTarget.reduce((s, r) => s + r.updated.length, 0);
      const appendedTotal = perTarget.reduce((s, r) => s + r.appended.length, 0);

      // Toast: short summary.
      if (failedCount === 0) {
        toast.success(
          `Synced ${savedCount}/${targets.length} templates · ` +
            `${updatedTotal} updated · ${appendedTotal} appended` +
            (noChangeCount > 0 ? ` · ${noChangeCount} unchanged` : ""),
        );
      } else {
        toast.error(`${failedCount} failed · see results dialog for details`);
      }

      // Detailed results dialog so the admin can SEE exactly what happened
      // per template and understand why anything they expected didn't change.
      await alertDialog({
        title: `Sync from "${masterRow.label}" — results`,
        confirmLabel: "Close",
        description: (
          <div className="space-y-3">
            <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
              <div className="font-semibold">
                {savedCount}/{targets.length} templates saved
                {failedCount > 0 ? ` · ${failedCount} failed` : ""}
                {noChangeCount > 0 ? ` · ${noChangeCount} unchanged` : ""}
              </div>
              <div className="mt-0.5 text-neutral-500 dark:text-neutral-400">
                {updatedTotal} sections updated · {appendedTotal} appended
              </div>
              {skippedByType.length > 0 && (
                <div className="mt-1 text-amber-700 dark:text-amber-400">
                  Skipped {skippedByType.length} by incompatible type:{" "}
                  {skippedByType.map((r) => `${r.label} [${r.meta?.type}]`).join(", ")}
                </div>
              )}
              {skippedByUser.length > 0 && (
                <div className="mt-1 text-neutral-500 dark:text-neutral-400">
                  Deselected {skippedByUser.length} by you:{" "}
                  {skippedByUser.map((r) => r.label).join(", ")}
                </div>
              )}
            </div>

            <ul className="max-h-[55vh] overflow-y-auto divide-y divide-neutral-100 rounded-md border border-neutral-200 text-xs dark:divide-neutral-800 dark:border-neutral-700">
              {perTarget.map((r) => {
                const noChange = r.updated.length === 0 && r.appended.length === 0;
                return (
                  <li key={r.label} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                        {r.label}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide">
                        {r.error ? (
                          <span className="text-red-600 dark:text-red-400">FAILED — {r.error}</span>
                        ) : r.saved ? (
                          <span className="text-green-600 dark:text-green-400">saved</span>
                        ) : noChange ? (
                          <span className="text-neutral-500">no change</span>
                        ) : (
                          <span className="text-neutral-500">not saved</span>
                        )}
                      </span>
                    </div>

                    {r.updated.length > 0 && (
                      <div className="mt-1">
                        <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                          Updated ({r.updated.length})
                        </div>
                        <ul className="mt-0.5 space-y-0.5">
                          {r.updated.map((u, i) => (
                            <li key={i} className="text-neutral-700 dark:text-neutral-300">
                              <span className="font-mono">{u.masterTitle}</span>
                              <span className="mx-1 text-neutral-400">→</span>
                              <span className="font-mono">{u.targetTitle}</span>
                              <span className="ml-1 text-[10px] text-neutral-500">
                                ({u.reason})
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {r.appended.length > 0 && (
                      <div className="mt-1">
                        <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                          Appended ({r.appended.length})
                        </div>
                        <ul className="mt-0.5 space-y-0.5">
                          {r.appended.map((a, i) => (
                            <li key={i} className="text-blue-700 dark:text-blue-300">
                              <span className="font-mono">{a.masterTitle}</span>
                              <span className="ml-1 text-[10px] text-neutral-500">
                                (
                                {a.reason === "collision"
                                  ? "another master section already claimed the match"
                                  : "no matching section in target"}
                                )
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {r.untouched.length > 0 && (
                      <div className="mt-1 text-[10px] text-neutral-500">
                        Untouched in target: {r.untouched.join(", ")}
                      </div>
                    )}

                    {noChange && !r.error && (
                      <div className="mt-1 text-[10px] text-neutral-500">
                        Master had no overlapping sections to apply here.
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ),
      });

      await load();
    } finally {
      setSyncingAll(false);
    }
  }

  async function remove(row: DocumentTemplateRow) {
    const ok = await confirmDialog({
      title: `Delete template "${row.label}"?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
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
    setMeta((m) => ({ ...m, sections: reorderItems(m.sections, idx, idx + dir) }));
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
      sections: m.sections.map((s, si) =>
        si === sectionIdx
          ? { ...s, fields: reorderItems(s.fields, fieldIdx, fieldIdx + dir) }
          : s,
      ),
    }));
  }

  // Drop handler for drag-to-sort fields within a section. Receives the
  // fully reordered array from the SortableList hook and commits it.
  function reorderFields(sectionIdx: number, nextFields: TemplateFieldMapping[]) {
    setMeta((m) => ({
      ...m,
      sections: m.sections.map((s, si) =>
        si === sectionIdx ? { ...s, fields: nextFields } : s,
      ),
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

          {/* Document Audience */}
          <div className="grid gap-1">
            <Label>Document Audience</Label>
            <select
              className="h-9 w-full sm:w-64 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              value={meta.enableAgentCopy ? "both" : meta.isAgentTemplate ? "agent" : "client"}
              onChange={(e) => {
                const v = e.target.value;
                setMeta((m) => ({
                  ...m,
                  enableAgentCopy: v === "both",
                  isAgentTemplate: v === "agent",
                }));
              }}
            >
              <option value="client">Client Only</option>
              <option value="both">Client + Agent</option>
              <option value="agent">Agent Only</option>
            </select>
            <p className="text-xs text-neutral-400">
              {meta.enableAgentCopy
                ? "Generates both Client and Agent copies. Agent copy document number gets (A) suffix."
                : meta.isAgentTemplate
                  ? "This template only generates the Agent copy. Document number gets (A) suffix."
                  : "This template only generates the Client copy."}
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
                  <Label>Title Size</Label>
                  <select
                    className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={meta.header.titleSize ?? "lg"}
                    onChange={(e) =>
                      setMeta((m) => ({
                        ...m,
                        header: { ...m.header, titleSize: e.target.value as "sm" | "md" | "lg" | "xl" },
                      }))
                    }
                  >
                    <option value="sm">Small</option>
                    <option value="md">Medium</option>
                    <option value="lg">Large (default)</option>
                    <option value="xl">Extra Large</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
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
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label>Subtitle Size</Label>
                    <select
                      className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                      value={meta.header.subtitleSize ?? "sm"}
                      onChange={(e) =>
                        setMeta((m) => ({
                          ...m,
                          header: { ...m.header, subtitleSize: e.target.value as "xs" | "sm" | "md" },
                        }))
                      }
                    >
                      <option value="xs">Extra Small</option>
                      <option value="sm">Small (default)</option>
                      <option value="md">Medium</option>
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <Label>Subtitle Color</Label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        className="h-10 w-10 cursor-pointer rounded border border-neutral-300 bg-white p-0.5 dark:border-neutral-700"
                        value={meta.header.subtitleColor ?? "#737373"}
                        onChange={(e) =>
                          setMeta((m) => ({
                            ...m,
                            header: { ...m.header, subtitleColor: e.target.value },
                          }))
                        }
                      />
                      <Input
                        className="flex-1 font-mono text-xs"
                        placeholder="#737373"
                        value={meta.header.subtitleColor ?? ""}
                        onChange={(e) =>
                          setMeta((m) => ({
                            ...m,
                            header: { ...m.header, subtitleColor: e.target.value || undefined },
                          }))
                        }
                      />
                    </div>
                  </div>
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

            <div className="space-y-4">
              {meta.sections.map((section, sIdx) => {
                const availableFields = getFieldsForSource(section.source, section.packageName);
                const dynamicPkgForSource: Record<string, string> = { accounting: "premiumRecord", statement: "premiumRecord", insured: "insured", contactinfo: "contactinfo" };
                const dynPkg = dynamicPkgForSource[section.source];
                const needsLoad = (section.source === "package" && section.packageName && !pkgFieldsCache[section.packageName])
                  || (dynPkg && !pkgFieldsCache[dynPkg]);
                if (section.source === "package" && needsLoad && section.packageName) void loadPkgFields(section.packageName);
                if (dynPkg && !pkgFieldsCache[dynPkg]) void loadPkgFields(dynPkg);

                const selectedKeys = new Set(section.fields.map((f) => f.key));
                const allSelected = availableFields.length > 0 && availableFields.every((f) => selectedKeys.has(f.key));
                const fieldLabelMap = new Map(availableFields.map((f) => [f.key, f.label]));

                const toggleField = (fieldDef: { key: string; label: string; group?: string }, checked: boolean) => {
                  if (checked) {
                    // Snapshot the field's group from availableFields so the
                    // renderer can show group sub-headers without having to
                    // fetch package metadata at document-render time.
                    setMeta((m) => ({
                      ...m,
                      sections: m.sections.map((s, i) =>
                        i === sIdx
                          ? {
                              ...s,
                              fields: [
                                ...s.fields,
                                {
                                  key: fieldDef.key,
                                  label: fieldDef.label,
                                  format: "text",
                                  ...(fieldDef.group ? { group: fieldDef.group } : {}),
                                },
                              ],
                            }
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
                        ? {
                            ...s,
                            fields: [
                              ...s.fields,
                              ...toAdd.map((f) => ({
                                key: f.key,
                                label: f.label,
                                format: "text" as const,
                                ...(f.group ? { group: f.group } : {}),
                              })),
                            ],
                          }
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

                const fillMissingLabels = () => {
                  setMeta((m) => ({
                    ...m,
                    sections: m.sections.map((s, i) =>
                      i === sIdx
                        ? {
                            ...s,
                            fields: s.fields.map((f) =>
                              !f.label && fieldLabelMap.has(f.key)
                                ? { ...f, label: fieldLabelMap.get(f.key)! }
                                : f,
                            ),
                          }
                        : s,
                    ),
                  }));
                };

                const hasMissingLabels = section.fields.some((f) => !f.label && fieldLabelMap.has(f.key));

                const audienceTag = section.audience === "client"
                  ? { border: "border-blue-400 dark:border-blue-600", bg: "bg-blue-50 dark:bg-blue-950/20", tag: "Client Only", tagColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" }
                  : section.audience === "agent"
                    ? { border: "border-amber-400 dark:border-amber-600", bg: "bg-amber-50 dark:bg-amber-950/20", tag: "Agent Only", tagColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" }
                    : { border: "border-neutral-200 dark:border-neutral-700", bg: "", tag: "", tagColor: "" };

                return (
                  <div key={section.id} className={`rounded-lg border overflow-hidden ${audienceTag.border}`}>
                    {/* Section header bar */}
                    <div className={`flex items-center gap-2 px-3 py-2 border-b ${audienceTag.border} ${audienceTag.bg || "bg-neutral-50 dark:bg-neutral-800/50"}`}>
                      <span className="text-xs font-bold text-neutral-400 w-5 text-center shrink-0">{sIdx + 1}</span>
                      <Input
                        className="h-8 flex-1 text-sm font-medium bg-transparent border-0 shadow-none focus-visible:ring-0 px-1"
                        placeholder="Section title (e.g. Vehicle Details)"
                        value={section.title}
                        onChange={(e) => updateSection(sIdx, { title: e.target.value })}
                      />
                      {/* Per-section title size — overrides the template-wide
                          default set under Layout at the bottom of the editor.
                          "Default" leaves it falling back to that template-wide
                          value, so most sections never need touching this. */}
                      <select
                        className="h-7 shrink-0 rounded-md border border-neutral-300 bg-white px-1.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                        value={section.titleSize ?? ""}
                        onChange={(e) =>
                          updateSection(sIdx, {
                            titleSize: e.target.value
                              ? (e.target.value as "xs" | "sm" | "md" | "lg")
                              : undefined,
                          })
                        }
                        title="Title font size for this section (overrides template default)"
                      >
                        <option value="">Size: default</option>
                        <option value="xs">Size: extra small</option>
                        <option value="sm">Size: small</option>
                        <option value="md">Size: medium</option>
                        <option value="lg">Size: large</option>
                      </select>
                      {audienceTag.tag && (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${audienceTag.tagColor}`}>
                          {audienceTag.tag}
                        </span>
                      )}
                      <div className="shrink-0 flex items-center gap-0.5 ml-auto">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setApplySectionIdx(sIdx)}
                          className="h-7 w-7 text-neutral-500 hover:text-neutral-700"
                          aria-label="Apply this section to other templates"
                          title="Apply this section's settings to other templates"
                        >
                          <Layers className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => moveSection(sIdx, -1)} className="h-7 w-7" disabled={sIdx === 0} aria-label="Move up">
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => moveSection(sIdx, 1)} className="h-7 w-7" disabled={sIdx === meta.sections.length - 1} aria-label="Move down">
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => removeSection(sIdx)} className="h-7 w-7 text-red-500 hover:text-red-600" aria-label="Remove section">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="p-3 sm:p-4 space-y-4">
                      {/* Settings */}
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <Label className="text-[11px] sm:text-xs text-neutral-500 shrink-0">Source</Label>
                          <select
                            className="h-9 w-full sm:w-auto rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                            value={section.source}
                            onChange={(e) => updateSection(sIdx, { source: e.target.value as TemplateSection["source"], fields: [] })}
                          >
                            {ALL_SOURCE_OPTIONS
                              .filter((s) => !s.forTypes || s.forTypes.includes(meta.type))
                              .map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        </div>
                        {section.source === "package" && (
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                            <Label className="text-[11px] sm:text-xs text-neutral-500 shrink-0">Package</Label>
                            <select
                              className="h-9 w-full sm:w-auto rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                              value={section.packageName ?? ""}
                              onChange={(e) => {
                                updateSection(sIdx, { packageName: e.target.value, fields: [] });
                                if (e.target.value) void loadPkgFields(e.target.value);
                              }}
                            >
                              <option value="">Pick package...</option>
                              {packages.map((p) => (
                                <option key={p.value} value={p.value}>{p.label}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <Label className="text-[11px] sm:text-xs text-neutral-500 shrink-0">Audience</Label>
                          <select
                            className="h-9 w-full sm:w-auto rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                            value={section.audience ?? "all"}
                            onChange={(e) => updateSection(sIdx, { audience: e.target.value as TemplateSection["audience"] })}
                          >
                            <option value="all">All (Client &amp; Agent)</option>
                            <option value="client">Client Only</option>
                            <option value="agent">Agent Only</option>
                          </select>
                        </div>
                        {section.source === "statement" && (
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                            <Label className="text-[11px] sm:text-xs text-neutral-500 shrink-0">Layout</Label>
                            <select
                              className="h-9 w-full sm:w-auto rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                              value={section.layout ?? "default"}
                              onChange={(e) => updateSection(sIdx, { layout: e.target.value as TemplateSection["layout"] })}
                            >
                              <option value="default">Label–Value pairs</option>
                              <option value="table">Table grid</option>
                            </select>
                          </div>
                        )}
                        {/* Columns selector — hidden for table/statement layouts where it
                            doesn't apply, and for the special "totals" / "line_items" sections. */}
                        {section.layout !== "table" &&
                          section.id !== "totals" &&
                          section.id !== "line_items" && (
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                              <Label className="text-[11px] sm:text-xs text-neutral-500 shrink-0">Columns</Label>
                              <select
                                className="h-9 w-full sm:w-auto rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                value={String(section.columns ?? 1)}
                                onChange={(e) =>
                                  updateSection(sIdx, {
                                    columns: (Number(e.target.value) === 2 ? 2 : 1) as 1 | 2,
                                  })
                                }
                                title="How many label/value pairs to fit per row. Use 2 for short fields like vehicle info to save space."
                              >
                                <option value="1">1 per row</option>
                                <option value="2">2 per row</option>
                              </select>
                            </div>
                          )}
                        {/* Group headers — always shown so the option is
                            discoverable, but only meaningful when at least
                            one field actually has a group (set via the
                            Package Fields editor's "Group Assignment").
                            Hidden for table layout where rows aren't paired
                            with labels. */}
                        {section.layout !== "table" &&
                          section.id !== "totals" &&
                          section.id !== "line_items" && (() => {
                            const hasAnyGroup =
                              availableFields.some((f) => f.group) ||
                              section.fields.some((f) => f.group);
                            return (
                              <>
                                <label
                                  className={`flex items-center gap-2 text-[11px] sm:text-xs select-none ${hasAnyGroup ? "cursor-pointer text-neutral-600 dark:text-neutral-300" : "cursor-help text-neutral-400 dark:text-neutral-500"}`}
                                  title={
                                    hasAnyGroup
                                      ? "Show sub-headings (e.g. 'Section 1 Excess', 'Section 2 Excess') above each field group in the rendered document"
                                      : "No field in this section has a group assigned yet. Set meta.group on package fields in Admin → Policy Settings → Packages → [package] → Fields to enable sub-headings."
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!section.showFieldGroupHeaders}
                                    onChange={(e) =>
                                      updateSection(sIdx, {
                                        showFieldGroupHeaders: e.target.checked,
                                      })
                                    }
                                    className="h-3.5 w-3.5 rounded accent-blue-500"
                                  />
                                  <span>
                                    Show group headers in output
                                    {!hasAnyGroup && (
                                      <span className="ml-1 italic">
                                        (no groups set)
                                      </span>
                                    )}
                                  </span>
                                </label>
                                {/* Group columns — only relevant when group
                                    headers are turned on. Lets the admin pack
                                    two group blocks side-by-side to save
                                    vertical space (analogous to the per-row
                                    "Columns" setting for fields). */}
                                {section.showFieldGroupHeaders && hasAnyGroup && (
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                                    <Label className="text-[11px] sm:text-xs text-neutral-500 shrink-0">Group columns</Label>
                                    <select
                                      className="h-9 w-full sm:w-auto rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                      value={String(section.fieldGroupColumns ?? 1)}
                                      onChange={(e) =>
                                        updateSection(sIdx, {
                                          fieldGroupColumns: (Number(e.target.value) === 2 ? 2 : 1) as 1 | 2,
                                        })
                                      }
                                      title="How many group blocks to fit per row. 2-per-row is good for sections with many small groups (e.g. excesses, premium splits)."
                                    >
                                      <option value="1">1 per row</option>
                                      <option value="2">2 per row</option>
                                    </select>
                                  </div>
                                )}
                                {/* Per-group visibility — every distinct group
                                    used by SELECTED fields gets its own
                                    checkbox so the admin can hide individual
                                    headers (the fields still render, only the
                                    sub-heading disappears). Default = visible
                                    so the page reflects the current behaviour
                                    until the admin explicitly hides one. */}
                                {section.showFieldGroupHeaders && hasAnyGroup && (() => {
                                  const groupNames = Array.from(
                                    new Set(
                                      section.fields
                                        .map((f) => (f.group ?? "").trim())
                                        .filter((g): g is string => !!g),
                                    ),
                                  );
                                  if (groupNames.length === 0) return null;
                                  const hidden = new Set(section.hiddenGroupHeaders ?? []);
                                  const toggleGroup = (name: string, show: boolean) => {
                                    const next = new Set(hidden);
                                    if (show) next.delete(name);
                                    else next.add(name);
                                    updateSection(sIdx, {
                                      hiddenGroupHeaders: next.size === 0 ? undefined : Array.from(next),
                                    });
                                  };
                                  return (
                                    <div className="flex flex-col gap-1 w-full">
                                      <Label className="text-[11px] sm:text-xs text-neutral-500">
                                        Visible group headers
                                      </Label>
                                      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                                        {groupNames.map((name) => {
                                          const visible = !hidden.has(name);
                                          return (
                                            <label
                                              key={name}
                                              className="flex items-center gap-1.5 text-[11px] cursor-pointer text-neutral-600 dark:text-neutral-300"
                                              title={visible ? `Hide "${name}" sub-heading in output` : `Show "${name}" sub-heading in output`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={visible}
                                                onChange={(e) => toggleGroup(name, e.target.checked)}
                                                className="h-3.5 w-3.5 rounded accent-blue-500"
                                              />
                                              <span className="uppercase tracking-wide">{name}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </>
                            );
                          })()}
                      </div>

                      {/* Policy source context note */}
                      {section.source === "policy" && (
                        <div className="text-[11px] sm:text-xs rounded-md border px-3 py-2 border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                          <strong>Policy Info</strong> only exposes fields that are <strong>actually columns on the policy record</strong>:
                          <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/50">policyNumber</code>,
                          <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/50">createdAt</code>,
                          <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/50">flowKey</code>, plus document-tracking fields.
                          Other common fields live in <strong>Package</strong> sources — for example
                          <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/50">effectiveDate</code> /
                          <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900/50">expiryDate</code> are in the <strong>policyinfo</strong> package,
                          and endorsement fields are in the endorsement package.
                        </div>
                      )}

                      {/* Premium context note */}
                      {section.source === "accounting" && (
                        <div className="text-[11px] sm:text-xs rounded-md border px-3 py-2 border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
                          {meta.type === "endorsement" ? (
                            <>
                              <strong>Endorsement template:</strong> These premium fields read from the <strong>endorsement&apos;s own premium record</strong> (e.g. Gross Premium, Net Premium, Agent Premium, Client Premium of the endorsement).
                              The same field keys are used for all template types — the values change based on which policy/endorsement the document is generated for.
                            </>
                          ) : meta.type === "statement" ? (
                            <>
                              <strong>Statement template:</strong> For premium totals across all items, use the <strong>Statement Data</strong> source instead (it has Policy Premium Total and Endorsement Premium Total).
                              This Premium source reads from the <strong>parent policy&apos;s</strong> premium record only.
                            </>
                          ) : (
                            <>
                              <strong>Template type: {meta.type || "—"}</strong> — These premium fields read from the <strong>policy&apos;s own premium record</strong>.
                              The same field keys are used for all template types.
                              For an endorsement template, these same fields will read the endorsement&apos;s premium values instead.
                            </>
                          )}
                        </div>
                      )}

                      {/* Available fields picker */}
                      {availableFields.length > 0 ? (
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                              Available Fields
                            </span>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={allSelected ? deselectAll : selectAll}
                            >
                              {allSelected ? "Deselect All" : "Select All"}
                            </Button>
                            <span className="text-[11px] sm:text-xs text-neutral-400">
                              {selectedKeys.size}/{availableFields.length}
                            </span>
                          </div>
                          {(() => {
                            const hasGroups = availableFields.some((f) => f.group);
                            if (hasGroups) {
                              const groups: { name: string; fields: typeof availableFields }[] = [];
                              const groupMap = new Map<string, typeof availableFields>();
                              for (const fd of availableFields) {
                                const g = fd.group || "Other";
                                if (!groupMap.has(g)) {
                                  const arr: typeof availableFields = [];
                                  groupMap.set(g, arr);
                                  groups.push({ name: g, fields: arr });
                                }
                                groupMap.get(g)!.push(fd);
                              }
                              const groupDescriptions: Record<string, string> = {
                                "Statement Info": "Statement number, date, status, who it belongs to",
                                "Amount Totals": "Total due, paid, outstanding amounts across all items",
                                "Policy vs Endorsement Totals": "Separated totals — use these to show policy premium vs endorsement premium",
                                "Line Item Counts & Lists": "How many items, their descriptions and amounts",
                                "Line Item Premium Breakdown": "Premium detail per line item — each line could be a policy or endorsement",
                              };
                              return (
                                <div className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 max-h-[360px] overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-700">
                                  {groups.map((g) => (
                                    <div key={g.name} className="p-2 sm:p-3">
                                      <div className="mb-1.5">
                                        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                                          {g.name}
                                        </div>
                                        {groupDescriptions[g.name] && (
                                          <div className="text-[10px] sm:text-[11px] text-neutral-400 dark:text-neutral-500">
                                            {groupDescriptions[g.name]}
                                          </div>
                                        )}
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5">
                                        {g.fields.map((fd) => {
                                          const isChecked = selectedKeys.has(fd.key);
                                          return (
                                            <label key={fd.key} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 text-xs sm:text-[13px] hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                                              <input type="checkbox" checked={isChecked} onChange={(e) => toggleField(fd, e.target.checked)} className="h-4 w-4 shrink-0 rounded accent-blue-500" />
                                              <span className="min-w-0">
                                                <span className={isChecked ? "font-medium text-blue-700 dark:text-blue-300" : "text-neutral-700 dark:text-neutral-300"}>
                                                  {fd.label || fd.key}
                                                </span>
                                                <span className="ml-1.5 text-[10px] font-mono text-neutral-400">{fd.key}</span>
                                              </span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            }
                            return (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2 sm:p-3 max-h-[220px] overflow-y-auto">
                                {availableFields.map((fd) => {
                                  const isChecked = selectedKeys.has(fd.key);
                                  return (
                                    <label key={fd.key} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 text-xs sm:text-[13px] hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                                      <input type="checkbox" checked={isChecked} onChange={(e) => toggleField(fd, e.target.checked)} className="h-4 w-4 shrink-0 rounded accent-blue-500" />
                                      <span className={isChecked ? "font-medium text-blue-700 dark:text-blue-300" : "text-neutral-700 dark:text-neutral-300"}>
                                        {fd.label || fd.key}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      ) : section.source === "package" && !section.packageName ? (
                        <p className="text-sm text-neutral-400 py-2">Select a package first</p>
                      ) : needsLoad ? (
                        <div className="flex items-center gap-2 py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                          <span className="text-sm text-neutral-400">Loading fields...</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 py-2">
                          <p className="text-sm text-neutral-400">No predefined fields.</p>
                          <Button size="sm" variant="ghost" className="gap-1" onClick={() => addField(sIdx)}>
                            <Plus className="h-3.5 w-3.5" /> Add Manually
                          </Button>
                        </div>
                      )}

                      {/* Selected fields table */}
                      {section.fields.length > 0 && (
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                              Selected Fields ({section.fields.length})
                            </span>
                            {hasMissingLabels && (
                              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={fillMissingLabels}>
                                Auto-fill Labels
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="gap-1 ml-auto" onClick={() => addField(sIdx)}>
                              <Plus className="h-3.5 w-3.5 sm:hidden lg:inline" />
                              <span className="hidden sm:inline">Add Custom</span>
                            </Button>
                          </div>
                          <div className="overflow-x-auto">
                            <SortableFieldsTable
                              section={section}
                              validationResult={validationResult}
                              fieldLabelMap={fieldLabelMap}
                              fieldGroupMap={
                                new Map(
                                  availableFields
                                    .filter((f) => f.group)
                                    .map((f) => [f.key, f.group as string]),
                                )
                              }
                              onUpdate={(fIdx, patch) => updateField(sIdx, fIdx, patch)}
                              onMove={(fIdx, dir) => moveField(sIdx, fIdx, dir)}
                              onRemove={(fIdx) => removeField(sIdx, fIdx)}
                              onReorder={(nextFields) => reorderFields(sIdx, nextFields)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
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

          {/* Layout — template-wide section title size & section spacing.
              Kept here (template-level rather than per-section) so the
              whole document feels visually consistent and the section
              editor doesn't get cluttered with tiny knobs. */}
          <fieldset className="rounded-md border border-neutral-200 p-4 dark:border-neutral-700">
            <legend className="px-1 text-sm font-medium">Layout</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>Section title size</Label>
                <select
                  className="w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700"
                  value={meta.layout?.sectionTitleSize ?? "sm"}
                  onChange={(e) =>
                    setMeta((m) => ({
                      ...m,
                      layout: {
                        ...m.layout,
                        sectionTitleSize: e.target.value as "xs" | "sm" | "md" | "lg",
                      },
                    }))
                  }
                >
                  <option value="xs">Extra small</option>
                  <option value="sm">Small (default)</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                </select>
                <p className="text-[11px] text-neutral-500">
                  Controls the font size of every section title in the rendered output.
                </p>
              </div>
              <div className="grid gap-1">
                <Label>Section spacing</Label>
                <select
                  className="w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700"
                  value={meta.layout?.sectionSpacing ?? "normal"}
                  onChange={(e) =>
                    setMeta((m) => ({
                      ...m,
                      layout: {
                        ...m.layout,
                        sectionSpacing: e.target.value as "compact" | "normal" | "loose",
                      },
                    }))
                  }
                >
                  <option value="compact">Compact (best A4 fit)</option>
                  <option value="normal">Normal (default)</option>
                  <option value="loose">Loose</option>
                </select>
                <p className="text-[11px] text-neutral-500">
                  Vertical gap between sections. Use Compact when you need the document to fit on one A4 page.
                </p>
              </div>
            </div>
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

        {/* Live preview drawer — render the unsaved template against a real policy */}
        <DocumentTemplateLivePreview
          open={showPreview}
          onOpenChange={setShowPreview}
          meta={meta}
          templateLabel={formLabel}
          templateValue={formValue}
        />

        {/* Sync from Master dialog */}
        {showSyncFromMaster && (() => {
          const masterTemplate = rows.find((r) => r.meta?.isMaster && r.id !== editing?.id);
          if (!masterTemplate?.meta) return null;
          return (
            <SyncFromMasterDialog
              open={showSyncFromMaster}
              onOpenChange={setShowSyncFromMaster}
              masterMeta={masterTemplate.meta}
              currentMeta={meta}
              onSync={(updatedMeta) => {
                setMeta(updatedMeta);
                setShowSyncFromMaster(false);
              }}
            />
          );
        })()}

        {/* "Apply this section to other templates" dialog */}
        {applySectionIdx !== null && meta.sections[applySectionIdx] && (
          <SectionApplyToOthersDialog
            open={applySectionIdx !== null}
            onOpenChange={(o) => {
              if (!o) setApplySectionIdx(null);
            }}
            sourceSection={meta.sections[applySectionIdx]}
            sourceTemplateId={editing?.id ?? null}
            allTemplates={rows}
            onApplied={() => {
              setApplySectionIdx(null);
              void load();
            }}
          />
        )}

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
          <div className="mr-auto flex flex-wrap items-center gap-2">
            {/* Sync from Master — only shown when a master exists and this is not the master */}
            {(() => {
              const masterTemplate = rows.find((r) => r.meta?.isMaster && r.id !== editing?.id);
              if (!masterTemplate) return null;
              return (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSyncFromMaster(true)}
                  className="gap-1.5 border-yellow-300 text-yellow-700 hover:bg-yellow-50 dark:border-yellow-700 dark:text-yellow-400 dark:hover:bg-yellow-950/30"
                  title={`Pull section settings from the Master template: "${masterTemplate.label}"`}
                >
                  <Crown className="h-3.5 w-3.5" />
                  Sync from Master
                </Button>
              );
            })()}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(true)}
              className="gap-1.5"
              title="Render this template against a real policy to see how it will look"
            >
              <Monitor className="h-3.5 w-3.5" />
              Live Preview
            </Button>
          </div>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">{r.label}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
                    {r.value}
                  </div>
                  {(r.meta?.isMaster ||
                    !r.isActive ||
                    r.meta?.enableAgentCopy ||
                    (r.meta?.isAgentTemplate && !r.meta?.enableAgentCopy) ||
                    r.meta?.accountingLineKey) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {r.meta?.isMaster && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                          <Crown className="h-2.5 w-2.5" />
                          MASTER
                        </span>
                      )}
                      {!r.isActive && (
                        <span className="inline-flex items-center rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                          INACTIVE
                        </span>
                      )}
                      {r.meta?.enableAgentCopy && (
                        <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          CLIENT + AGENT
                        </span>
                      )}
                      {r.meta?.isAgentTemplate && !r.meta?.enableAgentCopy && (
                        <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          AGENT ONLY
                        </span>
                      )}
                      {r.meta?.accountingLineKey && (
                        <span className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                          Line: {r.meta.accountingLineKey}
                        </span>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell capitalize">
                  {r.meta?.type ?? "—"}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {r.meta?.sections?.length ?? 0}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <RowActionMenu
                      align="end"
                      actions={(() => {
                        const isMaster = !!r.meta?.isMaster;
                        const acts: RowAction[] = [
                          {
                            label: isMaster ? "Unset Master" : "Set Master",
                            icon: <Crown className="h-4 w-4" />,
                            onClick: () => setMaster(r),
                          },
                        ];
                        if (isMaster) {
                          acts.push({
                            label: syncingAll ? "Syncing…" : "Sync All from Master",
                            icon: <Layers className="h-4 w-4" />,
                            onClick: () => syncAllFromMaster(r),
                            loading: syncingAll,
                            disabled: syncingAll,
                          });
                        }
                        acts.push(
                          {
                            label: "Edit",
                            icon: <Pencil className="h-4 w-4" />,
                            onClick: () => startEdit(r),
                          },
                          {
                            label: r.isActive ? "Disable" : "Enable",
                            icon: r.isActive
                              ? <EyeOff className="h-4 w-4" />
                              : <Eye className="h-4 w-4" />,
                            onClick: () => toggleActive(r),
                          },
                          {
                            label: "Delete",
                            icon: <Trash2 className="h-4 w-4" />,
                            onClick: () => remove(r),
                            variant: "destructive",
                          },
                        );
                        return acts;
                      })()}
                    />
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

      {/*
        Picker for "Sync All from Master". Always mounted in the table view
        so syncAllFromMaster() can `await` the user's selection. Resolves with
        the selected target ids, or null on cancel.
      */}
      <SyncAllTargetsPickerDialog
        open={pickerState !== null}
        master={pickerState?.master ?? null}
        candidates={pickerState?.candidates ?? []}
        excludedTypes={EXCLUDE_TYPES_FROM_BROADCAST}
        typeLabels={TYPE_LABELS}
        onCancel={() => {
          if (pickerState) {
            pickerState.resolve(null);
            setPickerState(null);
          }
        }}
        onConfirm={(ids) => {
          if (pickerState) {
            pickerState.resolve(ids);
            setPickerState(null);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableFieldsTable
// ---------------------------------------------------------------------------
//
// Per-section drag-to-sort fields table. Extracted because hooks (useSortable
// from dnd-kit) cannot be called inside the parent's `sections.map(...)`
// callback. Each section gets its own SortableFieldsTable instance with its
// own dnd context.
//
// API surface intentionally mirrors what the inline JSX used to receive,
// minus the section index — the parent binds it into each callback so this
// component stays unaware of its position in the larger sections array.
//   - section            : the TemplateSection being edited
//   - validationResult   : the optional "Validate against policy" result set
//   - fieldLabelMap      : key -> resolved label fallback for placeholders
//   - onUpdate/onMove/   : per-row callbacks; same shape as the original
//     onRemove             updateField/moveField/removeField, already bound
//                          to this section by the parent.
//   - onReorder          : drop handler; receives the fully reordered fields
//                          array and commits it via setMeta in the parent.
// ---------------------------------------------------------------------------

type ValidationItem = {
  id: string;
  source: string;
  fieldKey: string;
  resolved: unknown;
  display?: string;
  status: "ok" | "optional";
};

type ValidationResultShape = {
  policyNumber: string;
  totalFields: number;
  okCount: number;
  optionalCount: number;
  results: ValidationItem[];
};

type SortableFieldsTableProps = {
  section: TemplateSection;
  validationResult: ValidationResultShape | null;
  fieldLabelMap: Map<string, string>;
  /**
   * Lookup of fieldKey -> group label (e.g. "Section 1 Excess"). Built by the
   * parent from the section's `availableFields` so the Selected Fields table
   * can render the same group buckets as the Available Fields picker above.
   * Pass an empty Map to render a flat (ungrouped) list.
   */
  fieldGroupMap: Map<string, string>;
  onUpdate: (fieldIdx: number, patch: Partial<TemplateFieldMapping>) => void;
  onMove: (fieldIdx: number, dir: -1 | 1) => void;
  onRemove: (fieldIdx: number) => void;
  onReorder: (nextFields: TemplateFieldMapping[]) => void;
};

function SortableFieldsTable({
  section,
  validationResult,
  fieldLabelMap,
  fieldGroupMap,
  onUpdate,
  onMove,
  onRemove,
  onReorder,
}: SortableFieldsTableProps) {
  // Bucket the selected fields by their group. Group order = first appearance
  // in the array; field order within a group = array order of just-those
  // fields. Fields whose key has no matching group (custom-added, legacy)
  // fall into the "Other" bucket.
  //
  // We also produce a `flat` list — the visual top-to-bottom order — and
  // hand THAT to dnd-kit's SortableList so drag indices line up with what
  // the user sees. Each entry remembers its `origIdx` in section.fields so
  // per-row callbacks (onUpdate/onMove/onRemove) keep operating on the real
  // underlying array.
  const grouped = React.useMemo(() => {
    type Item = { field: TemplateFieldMapping; origIdx: number };
    const buckets: { name: string; items: Item[] }[] = [];
    const indexByName = new Map<string, number>();
    let anyGroup = false;
    section.fields.forEach((field, origIdx) => {
      const g = fieldGroupMap.get(field.key);
      if (g) anyGroup = true;
      const name = g || "Other";
      let bucketIdx = indexByName.get(name);
      if (bucketIdx === undefined) {
        bucketIdx = buckets.length;
        indexByName.set(name, bucketIdx);
        buckets.push({ name, items: [] });
      }
      buckets[bucketIdx].items.push({ field, origIdx });
    });
    const flat: Item[] = buckets.flatMap((b) => b.items);
    return { buckets, flat, hasGroups: anyGroup };
  }, [section.fields, fieldGroupMap]);

  // Stable dnd id per visual row. Includes the original array index so two
  // fields with the same key (legacy bug, easy to hit while typing) still
  // get unique ids during a drag gesture.
  const fieldIds = React.useMemo(
    () =>
      grouped.flat.map(
        (it) => `${it.field.key || "field"}::${it.origIdx}`,
      ),
    [grouped.flat],
  );

  const handleReorder = React.useCallback(
    (nextFlat: { field: TemplateFieldMapping; origIdx: number }[]) => {
      // Drop the bucketing metadata and persist just the new field order.
      onReorder(nextFlat.map((it) => it.field));
    },
    [onReorder],
  );

  // Column count for the group-header row's colSpan. Mobile hides the
  // "Format" column via CSS but it still counts toward colSpan, so this
  // stays correct across breakpoints.
  const colSpan = validationResult ? 7 : 5;

  // SortableList wraps the ENTIRE <Table>, not just <TableBody>. dnd-kit's
  // DndContext renders hidden accessibility divs as siblings of its children
  // (for screen reader announcements), and <table> can only contain table
  // section elements (<thead>, <tbody>, etc.) — putting any <div> inside
  // <table> is an HTML hydration error. SortableContext underneath is
  // React-context-only and does not render DOM, so it's safe wrapping
  // <thead> + <tbody>.
  return (
    <SortableList
      items={grouped.flat}
      getId={(_, i) => fieldIds[i]}
      onReorder={handleReorder}
    >
      <Table>
        <TableHeader>
          <TableRow>
            {/* drag handle column — always present so the table layout is
                stable whether or not validation results are shown */}
            <TableHead className="w-7" />
            {validationResult && <TableHead className="w-7" />}
            <TableHead className="w-[120px] sm:w-[140px]">Key</TableHead>
            <TableHead>Label</TableHead>
            {validationResult && (
              <TableHead className="w-[180px] sm:w-[220px]">Preview</TableHead>
            )}
            <TableHead className="hidden sm:table-cell w-[90px]">Format</TableHead>
            <TableHead className="w-[72px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped.buckets.map((bucket) => (
            <React.Fragment key={bucket.name}>
              {grouped.hasGroups && (
                <TableRow className="bg-neutral-50 hover:bg-neutral-50 dark:bg-neutral-800/40 dark:hover:bg-neutral-800/40">
                  <TableCell
                    colSpan={colSpan}
                    className="px-2 py-1.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
                  >
                    <span>{bucket.name}</span>
                    <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
                      {bucket.items.length} field{bucket.items.length !== 1 ? "s" : ""}
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {bucket.items.map((it) => {
                const id = `${it.field.key || "field"}::${it.origIdx}`;
                return (
                  <FieldRow
                    key={id}
                    id={id}
                    field={it.field}
                    fieldIdx={it.origIdx}
                    section={section}
                    validationResult={validationResult}
                    fieldLabelMap={fieldLabelMap}
                    onUpdate={onUpdate}
                    onMove={onMove}
                    onRemove={onRemove}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </SortableList>
  );
}

type FieldRowProps = {
  id: string;
  field: TemplateFieldMapping;
  fieldIdx: number;
  section: TemplateSection;
  validationResult: ValidationResultShape | null;
  fieldLabelMap: Map<string, string>;
  onUpdate: (fieldIdx: number, patch: Partial<TemplateFieldMapping>) => void;
  onMove: (fieldIdx: number, dir: -1 | 1) => void;
  onRemove: (fieldIdx: number) => void;
};

function FieldRow({
  id,
  field,
  fieldIdx: fIdx,
  section,
  validationResult,
  fieldLabelMap,
  onUpdate,
  onMove,
  onRemove,
}: FieldRowProps) {
  const { attach, style, handleProps, rowClassName } = useSortableItem(id);
  const vr = validationResult?.results.find(
    (r) => r.id === `${section.id}-${fIdx}`,
  );
  const resolvedLabel = field.label || fieldLabelMap.get(field.key) || "";

  return (
    <TableRow ref={attach} style={style} className={rowClassName}>
      <TableCell className="px-1 py-0.5 align-middle">
        <SortableHandle size="sm" {...handleProps} />
      </TableCell>
      {validationResult && (
        <TableCell className="px-1 py-1 text-center">
          <span
            title={
              vr?.status === "ok"
                ? `Raw: ${JSON.stringify(vr.resolved)}\nDisplay: ${vr.display ?? ""}`
                : "Empty for this policy"
            }
          >
            {vr?.status === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline" />
            ) : vr ? (
              <span className="inline-block h-2 w-2 rounded-full bg-blue-400 dark:bg-blue-500" />
            ) : null}
          </span>
        </TableCell>
      )}
      <TableCell className="px-1 py-0.5">
        <Input
          className="h-7 text-xs font-mono"
          value={field.key}
          onChange={(e) => onUpdate(fIdx, { key: e.target.value })}
          placeholder="fieldKey"
        />
      </TableCell>
      <TableCell className="px-1 py-0.5">
        <Input
          className={`h-7 text-xs ${!field.label ? "text-neutral-400 italic" : ""}`}
          value={field.label}
          onChange={(e) => onUpdate(fIdx, { label: e.target.value })}
          placeholder={resolvedLabel || "Enter label..."}
        />
      </TableCell>
      {validationResult && (() => {
        const raw = vr?.resolved;
        const display = vr?.display ?? "";
        const rawStr = raw === null || raw === undefined ? "" : String(raw);
        // Highlight when raw differs from display — that's where the
        // admin's stored "value" was mapped to a friendlier "label".
        const mapped = vr?.status === "ok" && rawStr !== display && display !== "";
        return (
          <TableCell className="px-1 py-0.5">
            {vr?.status === "ok" ? (
              <div className="flex flex-col gap-0.5 text-xs leading-tight">
                <span className={mapped ? "font-medium text-green-700 dark:text-green-400" : ""}>
                  {display || <span className="text-neutral-400 italic">(empty after format)</span>}
                </span>
                {mapped && (
                  <span className="text-[10px] font-mono text-neutral-400 dark:text-neutral-500" title="Raw stored value">
                    raw: {rawStr}
                  </span>
                )}
              </div>
            ) : vr ? (
              <span className="text-xs italic text-neutral-400">no data</span>
            ) : null}
          </TableCell>
        );
      })()}
      <TableCell className="hidden sm:table-cell px-1 py-0.5">
        <select
          className="h-7 w-full rounded-md border border-neutral-300 bg-white px-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          value={field.format ?? "text"}
          onChange={(e) =>
            onUpdate(fIdx, { format: e.target.value as TemplateFieldMapping["format"] })
          }
        >
          {FORMAT_OPTIONS.map((fo) => (
            <option key={fo.value} value={fo.value}>
              {fo.label}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell className="px-1 py-0.5 text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onMove(fIdx, -1)}
            disabled={fIdx === 0}
            className="h-6 w-6"
            aria-label="Move up"
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onMove(fIdx, 1)}
            disabled={fIdx === section.fields.length - 1}
            className="h-6 w-6"
            aria-label="Move down"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onRemove(fIdx)}
            className="h-6 w-6 text-red-500"
            aria-label="Remove"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
