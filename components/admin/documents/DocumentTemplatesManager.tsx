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
import { Plus, Trash2, ArrowLeft, Copy, Pencil, EyeOff, Eye, FlaskConical, Loader2, CheckCircle2, ChevronUp, ChevronDown, ChevronRight, Monitor, Layers, Crown, Palette, X, Upload, Image as ImageIcon } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { CompactMultiCheck } from "@/components/ui/compact-multi-check";
import {
  SortableList,
  SortableHandle,
  useSortableItem,
  reorderItems,
} from "@/components/ui/sortable-list";
import { DocumentTemplateLivePreview } from "./DocumentTemplateLivePreview";
import { SectionApplyToOthersDialog } from "./SectionApplyToOthersDialog";
import { StyleApplyToOthersDialog } from "./StyleApplyToOthersDialog";
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
  mergeStyleFromMaster,
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
  // Logo-upload progress flag — disables the upload button while the
  // POST is in flight so the admin can't queue duplicate uploads. Stored
  // separately from `saving` because the upload happens in the Style
  // drawer and shouldn't block the main "Save template" button.
  const [uploadingLogo, setUploadingLogo] = React.useState(false);
  const logoFileInputRef = React.useRef<HTMLInputElement | null>(null);
  // Same shape as `uploadingLogo` but for the authorized-signature image.
  // Kept separate so an admin can swap the logo and the sig in parallel
  // without one upload's spinner blocking the other button.
  const [uploadingSig, setUploadingSig] = React.useState(false);
  const sigFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [validating, setValidating] = React.useState(false);
  const [validatePolicyNum, setValidatePolicyNum] = React.useState("");
  const [showPreview, setShowPreview] = React.useState(false);
  // Right-side drawer for template-wide typography / spacing / color knobs.
  // Lives at the editor level (not per-section) so changing it from the
  // drawer is reflected immediately in the live preview / current edit.
  // `layoutStyleOpen` is the public open state; `layoutStyleMounted` is
  // a 1-tick-later flag used purely to drive the slide-in animation, so
  // the panel translates *into* view rather than appearing instantly.
  const [showLayoutStyle, setShowLayoutStyle] = React.useState(false);
  const [layoutStyleMounted, setLayoutStyleMounted] = React.useState(false);
  // Per-section collapse state — keyed by section.id so it survives
  // section reorders. Collapsed sections show only a one-line summary
  // (source + field count) instead of the full settings panel; this is
  // pure UI state, never persisted to the template meta.
  const [collapsedSectionIds, setCollapsedSectionIds] = React.useState<Set<string>>(new Set());
  const toggleSectionCollapsed = React.useCallback((id: string) => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  React.useEffect(() => {
    if (showLayoutStyle) {
      const t = window.setTimeout(() => setLayoutStyleMounted(true), 10);
      return () => window.clearTimeout(t);
    }
    setLayoutStyleMounted(false);
  }, [showLayoutStyle]);
  const [applySectionIdx, setApplySectionIdx] = React.useState<number | null>(null);
  const [showSyncFromMaster, setShowSyncFromMaster] = React.useState(false);
  // Toggles the "Apply this template's style to others" dialog opened from
  // the Style drawer header. Lets the admin push layout/header/footer
  // settings to multiple templates without editing each one's drawer.
  const [showApplyStyleToOthers, setShowApplyStyleToOthers] = React.useState(false);
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
    const loadedMeta = row.meta ?? defaultMeta();
    setMeta(loadedMeta);
    // Collapse all sections by default when loading an existing
    // template — most users want to scan the structure first, then
    // expand only what they need to edit. New sections added later
    // (via "Add Section") stay expanded because their id won't be
    // in this set.
    setCollapsedSectionIds(new Set(loadedMeta.sections.map((s) => s.id)));
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
    // Same default-collapsed behavior as startEdit: copying brings
    // over a populated structure that the user mainly skims, then
    // tweaks selectively.
    setCollapsedSectionIds(new Set(copiedMeta.sections.map((s) => s.id)));
    setOpen(true);
  }

  /**
   * Persists the current edits to the database. Returns `true` when the
   * server confirmed the save (so callers can chain follow-up UI actions
   * like closing a sub-drawer), `false` when validation or the request
   * failed. Errors surface as toasts — callers don't need to re-report.
   */
  /**
   * Upload a chosen image file as the template's header logo.
   *
   * Posts to the shared admin upload endpoint which writes to the same
   * `pdfTemplateFiles` blob store the PDF editor uses, then stamps the
   * returned `storedName` onto `meta.header.logoStoredName`. The image
   * itself is served via `/api/pdf-templates/images/[storedName]`, so
   * the on-screen preview, email and print HTML can all reference it
   * with the same URL — no asset duplication.
   *
   * Errors are surfaced as toasts; the meta isn't mutated on failure
   * so the previous logo (if any) stays intact.
   */
  async function uploadLogo(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (PNG or JPG)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2 MB");
      return;
    }
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/document-template-images", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Upload failed");
      }
      const { storedName } = await res.json();
      setMeta((m) => ({
        ...m,
        header: {
          ...m.header,
          logoStoredName: storedName,
          // Default size + position only when the admin is adding a logo
          // for the first time — preserves any custom values when they
          // swap out an existing logo for a new file.
          logoSize: m.header.logoSize ?? "md",
          logoPosition: m.header.logoPosition ?? "left",
        },
      }));
      toast.success("Logo uploaded");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploadingLogo(false);
      // Clear the input so re-selecting the same file still triggers
      // onChange (browsers swallow the event when the value matches).
      if (logoFileInputRef.current) logoFileInputRef.current.value = "";
    }
  }

  /**
   * Upload an image file to use as the AUTHORIZED signature on this
   * template's footer.  Same storage + endpoint as `uploadLogo` (the
   * shared blob table), just stamped onto a different meta field so the
   * render paths can pick it up. PNG with transparent background gives
   * the best result — the image renders on top of the signature line so
   * a solid-background scan would obscure the line entirely.
   */
  async function uploadAuthorizedSignature(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file (PNG or JPG)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2 MB");
      return;
    }
    setUploadingSig(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/document-template-images", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Upload failed");
      }
      const { storedName } = await res.json();
      setMeta((m) => ({
        ...m,
        footer: {
          ...m.footer,
          authorizedSignatureImage: storedName,
          authorizedSignatureImageHeight:
            m.footer?.authorizedSignatureImageHeight ?? "md",
          // Auto-enable the authorized block when uploading the first
          // sig so the admin doesn't have to also tick the checkbox.
          showAuthorizedSignature: m.footer?.showAuthorizedSignature ?? true,
        },
      }));
      toast.success("Signature uploaded");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploadingSig(false);
      if (sigFileInputRef.current) sigFileInputRef.current.value = "";
    }
  }

  async function save(): Promise<boolean> {
    if (!formLabel.trim() || !formValue.trim()) {
      toast.error("Label and key are required");
      return false;
    }
    const duplicate = rows.find(
      (r) => r.value === formValue.trim() && r.id !== editing?.id,
    );
    if (duplicate) {
      toast.error(`Key "${formValue.trim()}" is already used by "${duplicate.label}"`);
      return false;
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
      // Reflect the just-saved meta locally so subsequent edits stack
      // on top of what the server now holds, AND update the rows list
      // directly so re-opening the editor doesn't load stale API data
      // (Neon serverless connections can return slightly stale reads
      // immediately after a write).
      const savedRow = { ...editing, ...payload, meta: metaToSave };
      setEditing(savedRow);
      setRows((prev) => prev.map((r) => r.id === editing.id ? savedRow : r));
      toast.success("Template updated");
    } else {
        const res = await fetch("/api/admin/form-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        // Switch the editor into edit-mode against the freshly created
        // row so the next Save becomes a PATCH instead of another POST
        // (which would fail on the unique key). The user can keep
        // tweaking + previewing without losing context.
        const created = (await res.json()) as DocumentTemplateRow;
        setEditing(created);
        toast.success("Template created");
      }
      // Refresh the list in the background so the template list reflects
      // the change next time the user closes the editor. We intentionally
      // do NOT call setOpen(false) here — the user often wants to keep
      // editing and verify the result with Live Preview.
      await load();
      return true;
    } catch (err: unknown) {
      toast.error(
        (err as { message?: string })?.message ?? "Save failed",
      );
      return false;
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
    resolve: (result: { ids: number[]; syncStyle: boolean } | null) => void;
  } | null>(null);

  function pickSyncTargets(
    master: DocumentTemplateRow,
    candidates: DocumentTemplateRow[],
  ): Promise<{ ids: number[]; syncStyle: boolean } | null> {
    return new Promise((resolve) => {
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
    const picked = await pickSyncTargets(masterRow, candidates);
    if (!picked || picked.ids.length === 0) return;
    const { ids: selectedIds, syncStyle } = picked;
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

          // Optionally layer style settings on top of the merged meta.
          const finalMeta = syncStyle
            ? mergeStyleFromMaster(merge.meta, masterRow.meta!)
            : merge.meta;

          if (merge.updatedCount === 0 && merge.appendedCount === 0 && !syncStyle) {
            // Nothing to do for this target — skip the network call but still record.
            perTarget.push(result);
            continue;
          }
          const res = await fetch(`/api/admin/form-options/${target.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ meta: finalMeta }),
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

  // Generic per-section patch — used by the SortableFieldsTable's group-header
  // row to update section-level maps that are keyed by group name
  // (`groupColumns`, `fullWidthGroups`). Kept generic instead of two
  // single-purpose helpers so future per-group settings (e.g. per-group
  // audience) can use the same plumbing without growing the prop surface
  // of the table component.
  function patchSection(
    sectionIdx: number,
    patch: Partial<TemplateSection>,
  ) {
    setMeta((m) => ({
      ...m,
      sections: m.sections.map((s, si) =>
        si === sectionIdx ? { ...s, ...patch } : s,
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

          {/* Flow restriction — collapsed-by-default chip picker. */}
          <CompactMultiCheck
            label="Restrict to Flows"
            hint="(optional)"
            options={flows}
            value={meta.flows ?? []}
            onChange={(next) =>
              setMeta((m) => ({ ...m, flows: next.length ? next : undefined }))
            }
            emptyLabel="All flows"
            noOptionsLabel="No flows defined"
          />

          {/* Status visibility — three slots all share the same status
              option list, just write to different meta arrays. Empty
              meaning differs slightly per slot, so emptyLabel reflects
              that ("Always shown" vs "Use default"). */}
          {statusOptions.length > 0 && (
            <CompactMultiCheck
              label="Show When Status"
              hint="(optional - empty = always)"
              description="Default status rule used for both audiences unless overridden below."
              options={statusOptions}
              value={meta.showWhenStatus ?? []}
              onChange={(next) =>
                setMeta((m) => ({
                  ...m,
                  showWhenStatus: next.length ? next : undefined,
                }))
              }
              emptyLabel="Always shown"
            />
          )}

          {statusOptions.length > 0 && (
            <CompactMultiCheck
              label="Show When Status (Client Override)"
              hint="(optional)"
              description="When set, this overrides default status visibility for client documents only."
              options={statusOptions}
              value={meta.showWhenStatusClient ?? []}
              onChange={(next) =>
                setMeta((m) => ({
                  ...m,
                  showWhenStatusClient: next.length ? next : undefined,
                }))
              }
              emptyLabel="Use default rule"
            />
          )}

          {statusOptions.length > 0 && (
            <CompactMultiCheck
              label="Show When Status (Agent Override)"
              hint="(optional)"
              description="When set, this overrides default status visibility for agent documents only."
              options={statusOptions}
              value={meta.showWhenStatusAgent ?? []}
              onChange={(next) =>
                setMeta((m) => ({
                  ...m,
                  showWhenStatusAgent: next.length ? next : undefined,
                }))
              }
              emptyLabel="Use default rule"
            />
          )}

          {/* Insurance Company restriction — adapt {id, name} → {value, label}.
              CompactMultiCheck operates on string values, so we serialize
              the numeric insurer IDs at the boundary and parse them back
              on the way out.  Keeps the component generic while preserving
              `meta.insurerPolicyIds` as `number[]` everywhere else. */}
          {availableInsurers.length > 0 && (
            <CompactMultiCheck
              label="Insurance Company"
              hint="(optional - empty = all companies)"
              description="Restrict this template to policies linked to specific insurance companies."
              options={availableInsurers.map((ins) => ({ value: String(ins.id), label: ins.name }))}
              value={(meta.insurerPolicyIds ?? []).map(String)}
              onChange={(next) => {
                const ids = next
                  .map((v) => Number(v))
                  .filter((n) => Number.isFinite(n));
                setMeta((m) => ({
                  ...m,
                  insurerPolicyIds: ids.length ? ids : undefined,
                }));
              }}
              emptyLabel="All companies"
            />
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

          {/* Header settings (title, subtitle, sizes, colors, toggles)
              now live in the right-side Style drawer, alongside Layout
              and Footer — see the <Drawer> below. */}

          {/* Sections */}
          <fieldset className="rounded-md border border-neutral-200 p-4 dark:border-neutral-700">
            <legend className="px-1 text-sm font-medium">
              Sections &amp; Fields
            </legend>
            <div className="mb-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
              <strong>Tip:</strong> Select ALL fields you might need — fields with no data are <strong>automatically hidden</strong> when the document is generated. 
              For example, you can include <code className="rounded bg-blue-100 px-1 text-xs dark:bg-blue-900/50">make</code>, <code className="rounded bg-blue-100 px-1 text-xs dark:bg-blue-900/50">commake</code>, <code className="rounded bg-blue-100 px-1 text-xs dark:bg-blue-900/50">solomake</code> in one template — only the one with data will appear. No need for separate templates per vehicle type or insured type.
            </div>

            {/* Bulk collapse / expand — handy when a template has many
                sections and you want to scan structure without scroll. */}
            {meta.sections.length > 1 && (
              <div className="mb-2 flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedSectionIds(new Set(meta.sections.map((s) => s.id)))
                  }
                  className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsedSectionIds(new Set())}
                  className="rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Expand all
                </button>
              </div>
            )}

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

                const isCollapsed = collapsedSectionIds.has(section.id);
                const sourceLabel =
                  ALL_SOURCE_OPTIONS.find((o) => o.value === section.source)?.label ?? section.source;

                return (
                  <div key={section.id} className={`rounded-lg border overflow-hidden ${audienceTag.border}`}>
                    {/* Section header bar — the chevron toggles the body
                        below. Border-bottom is dropped while collapsed
                        so the bar reads as a slim single-line summary. */}
                    <div
                      className={`flex items-center gap-2 px-3 py-2 ${isCollapsed ? "" : `border-b ${audienceTag.border}`} ${audienceTag.bg || "bg-neutral-50 dark:bg-neutral-800/50"}`}
                    >
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleSectionCollapsed(section.id)}
                        className="h-6 w-6 shrink-0 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                        aria-label={isCollapsed ? "Expand section" : "Collapse section"}
                        title={isCollapsed ? "Expand section" : "Collapse section"}
                      >
                        {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
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
                      {/* "Applied to N templates" badge — appears after the
                          first successful "Apply section to others" action.
                          The timestamp is formatted as a relative label
                          (Today / Yesterday / Nd ago) so admins can tell at
                          a glance how fresh the sync is. */}
                      {section.lastAppliedAt && section.lastAppliedCount != null && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                          title={`Last applied to ${section.lastAppliedCount} template${section.lastAppliedCount === 1 ? "" : "s"} on ${new Date(section.lastAppliedAt).toLocaleString()}`}
                        >
                          <Layers className="h-3 w-3" />
                          {`→ ${section.lastAppliedCount}`}
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

                    {/* Collapsed summary — clickable to expand. Shows
                        source + field count so the user can scan many
                        sections at a glance without expanding each. */}
                    {isCollapsed && (
                      <button
                        type="button"
                        onClick={() => toggleSectionCollapsed(section.id)}
                        className="w-full text-left px-3 py-1.5 text-[11px] text-neutral-500 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                      >
                        <span className="font-medium">{sourceLabel}</span>
                        {section.source === "package" && section.packageName ? (
                          <span className="text-neutral-400"> · {section.packageName}</span>
                        ) : null}
                        <span className="text-neutral-400">
                          {" · "}
                          {section.fields.length} field{section.fields.length === 1 ? "" : "s"}
                        </span>
                        {section.fields.length > 0 && (
                          <span className="ml-1 text-neutral-400">
                            ({section.fields.slice(0, 3).map((f) => f.label || f.key).join(", ")}
                            {section.fields.length > 3 ? `, +${section.fields.length - 3} more` : ""})
                          </span>
                        )}
                      </button>
                    )}

                    {!isCollapsed && (
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
                              onPatchSection={(patch) => patchSection(sIdx, patch)}
                            />
                          </div>
                        </div>
                      )}
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

          {/* Layout & Style now lives in a right-side drawer triggered
              from the action bar — see the <Drawer> below. Keeping all
              the typography / spacing / color knobs out of the main
              edit form makes for a much shorter, less daunting editor
              while staying one click away. */}

          {/* Footer settings (text + signature lines) live in the
              right-side Style drawer alongside Header and Layout. */}
        </div>

        {/* Live preview drawer — render the unsaved template against a real policy */}
        <DocumentTemplateLivePreview
          open={showPreview}
          onOpenChange={setShowPreview}
          meta={meta}
          templateLabel={formLabel}
          templateValue={formValue}
        />

        {/* Style drawer — slides in from the right and consolidates
            Header + Page Layout + Footer settings into one panel so
            the main editor body can stay focused on Sections & Fields.
            All controls write straight to `meta.header`, `meta.layout`
            and `meta.footer`, identical to the old inline fieldsets. */}
        <Drawer
          open={showLayoutStyle}
          onOpenChange={setShowLayoutStyle}
          side="right"
          overlayClassName={`bg-black/40! transition-opacity duration-300 ${layoutStyleMounted ? "opacity-100" : "opacity-0"}`}
        >
          <DrawerContent
            className={`w-full max-w-md flex flex-col ${layoutStyleMounted ? "translate-x-0" : "translate-x-full"}`}
          >
            <DrawerHeader>
              <div className="flex items-center justify-between">
                <DrawerTitle>
                  <span className="inline-flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    Style
                  </span>
                </DrawerTitle>
                <div className="flex items-center gap-1">
                  {/* "Apply to others" — push this template's style to other
                      templates in one shot. Only meaningful when we're
                      editing an existing template (need an id to exclude
                      from the target list and to avoid pushing to "self"). */}
                  {editing && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowApplyStyleToOthers(true)}
                      className="h-7 gap-1 px-2 text-[11px]"
                      title="Push this template's layout / header / footer style to other templates"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Apply to others...
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowLayoutStyle(false)}
                    className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Header, page layout and footer for this template. Each section can still override its own title size from the section header bar.
              </p>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-6">

                {/* ─── HEADER ───────────────────────────────────── */}
                <section>
                  <h4 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    Header
                  </h4>
                  <div className="grid gap-3">

                    {/* ── Logo ──────────────────────────────────────
                        Optional brand logo shown in the header band.
                        Stored in the shared `pdfTemplateFiles` blob
                        table so it benefits from the same auth + cache
                        rules as PDF-template images. Position/size live
                        on the template meta so the same logo file can be
                        rendered differently per template (e.g. centred
                        big on a quote, small left on an invoice). */}
                    <div className="grid gap-2 rounded-md border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
                      <Label className="text-xs uppercase tracking-wide text-neutral-500">
                        Logo
                      </Label>
                      {meta.header.logoStoredName ? (
                        <div className="flex items-start gap-3">
                          <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-700">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/pdf-templates/images/${meta.header.logoStoredName}`}
                              alt="Template logo"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <div className="flex flex-1 flex-col gap-1.5">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={uploadingLogo}
                                onClick={() => logoFileInputRef.current?.click()}
                              >
                                {uploadingLogo ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Replace
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setMeta((m) => ({
                                    ...m,
                                    header: { ...m.header, logoStoredName: undefined },
                                  }))
                                }
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                Remove
                              </Button>
                            </div>
                            <p className="text-[11px] text-neutral-500">
                              PNG / JPG · max 2 MB · transparent backgrounds work best.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingLogo}
                            onClick={() => logoFileInputRef.current?.click()}
                          >
                            {uploadingLogo ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Upload logo
                          </Button>
                          <p className="text-[11px] text-neutral-500">
                            PNG / JPG · max 2 MB
                          </p>
                        </div>
                      )}
                      <input
                        ref={logoFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadLogo(file);
                        }}
                      />
                      {meta.header.logoStoredName && (
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div className="grid gap-1">
                            <Label>Logo size</Label>
                            <select
                              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                              value={meta.header.logoSize ?? "md"}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  header: {
                                    ...m.header,
                                    logoSize: e.target.value as "sm" | "md" | "lg",
                                  },
                                }))
                              }
                            >
                              <option value="sm">Small (~32px)</option>
                              <option value="md">Medium (~48px, default)</option>
                              <option value="lg">Large (~72px)</option>
                            </select>
                          </div>
                          <div className="grid gap-1">
                            <Label>Logo position</Label>
                            <select
                              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                              value={meta.header.logoPosition ?? "left"}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  header: {
                                    ...m.header,
                                    logoPosition: e.target.value as "left" | "right" | "center",
                                  },
                                }))
                              }
                            >
                              <option value="left">Left of title (default)</option>
                              <option value="right">Right (replaces doc-no slot)</option>
                              <option value="center">Centered above title</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>

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
                      <Label>Title size</Label>
                      <select
                        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1">
                        <Label>Subtitle size</Label>
                        <select
                          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                          value={meta.header.subtitleSize ?? "sm"}
                          onChange={(e) =>
                            setMeta((m) => ({
                              ...m,
                              header: { ...m.header, subtitleSize: e.target.value as "xs" | "sm" | "md" },
                            }))
                          }
                        >
                          <option value="xs">Extra small</option>
                          <option value="sm">Small (default)</option>
                          <option value="md">Medium</option>
                        </select>
                      </div>
                      <div className="grid gap-1">
                        <Label>Subtitle color</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="h-9 w-10 cursor-pointer rounded-md border border-neutral-200 bg-transparent dark:border-neutral-700"
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
                    {/* Document number style — tunes the auto-generated doc
                        number in the top-right (e.g. INV-2025-0001). Falls
                        back to "md" + #1a1a1a (the previous hard-coded look)
                        so existing templates stay visually identical. */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1">
                        <Label>Document number size</Label>
                        <select
                          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                          value={meta.header.documentNumberSize ?? "md"}
                          onChange={(e) =>
                            setMeta((m) => ({
                              ...m,
                              header: {
                                ...m.header,
                                documentNumberSize: e.target.value as "xs" | "sm" | "md" | "lg" | "xl",
                              },
                            }))
                          }
                        >
                          <option value="xs">Extra small</option>
                          <option value="sm">Small</option>
                          <option value="md">Medium (default)</option>
                          <option value="lg">Large</option>
                          <option value="xl">Extra large</option>
                        </select>
                      </div>
                      <div className="grid gap-1">
                        <Label>Document number color</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="h-9 w-10 cursor-pointer rounded-md border border-neutral-200 bg-transparent dark:border-neutral-700"
                            value={meta.header.documentNumberColor ?? "#1a1a1a"}
                            onChange={(e) =>
                              setMeta((m) => ({
                                ...m,
                                header: { ...m.header, documentNumberColor: e.target.value },
                              }))
                            }
                          />
                          <Input
                            className="flex-1 font-mono text-xs"
                            placeholder="#1a1a1a"
                            value={meta.header.documentNumberColor ?? ""}
                            onChange={(e) =>
                              setMeta((m) => ({
                                ...m,
                                header: { ...m.header, documentNumberColor: e.target.value || undefined },
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
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
                        Show date
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
                        Show policy #
                      </label>
                    </div>
                  </div>
                </section>

                {/* ─── PAGE LAYOUT ──────────────────────────────── */}
                <section>
                  <h4 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    Page Layout
                  </h4>
                  <div className="grid gap-4">

                    {/* ── Font sizes ──────────────────────────────── */}
                    <div className="grid gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                        Font sizes
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1">
                          <Label>Section title</Label>
                          <select
                            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
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
                            Override per-section in its own header bar.
                          </p>
                        </div>
                        <div className="grid gap-1">
                          <Label>Group header</Label>
                          <select
                            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                            value={meta.layout?.groupHeaderSize ?? "xs"}
                            onChange={(e) =>
                              setMeta((m) => ({
                                ...m,
                                layout: {
                                  ...m.layout,
                                  groupHeaderSize: e.target.value as "xs" | "sm" | "md",
                                },
                              }))
                            }
                          >
                            <option value="xs">Extra small (default)</option>
                            <option value="sm">Small</option>
                            <option value="md">Medium</option>
                          </select>
                          <p className="text-[11px] text-neutral-500">
                            Sub-headings inside sections (when groups are on).
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-1">
                        <Label>Body text size</Label>
                        <select
                          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                          value={meta.layout?.bodyFontSize ?? "sm"}
                          onChange={(e) =>
                            setMeta((m) => ({
                              ...m,
                              layout: {
                                ...m.layout,
                                bodyFontSize: e.target.value as "xs" | "sm" | "md" | "lg",
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
                          Font size of every field label and value.
                        </p>
                      </div>
                    </div>

                    {/* ── Spacing ─────────────────────────────────── */}
                    <div className="grid gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                        Spacing
                      </p>
                      <div className="grid gap-1">
                        <Label>Section spacing</Label>
                        <select
                          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
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
                          Margin / padding between sections, rows and titles.
                        </p>
                      </div>
                    </div>

                    {/* ── Colors ──────────────────────────────────── */}
                    <div className="grid gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                        Colors
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1">
                          <Label>Field label</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              className="h-9 w-10 cursor-pointer rounded-md border border-neutral-200 bg-transparent dark:border-neutral-700"
                              value={meta.layout?.labelColor ?? "#737373"}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  layout: { ...m.layout, labelColor: e.target.value },
                                }))
                              }
                            />
                            <Input
                              className="flex-1 font-mono text-xs"
                              placeholder="#737373"
                              value={meta.layout?.labelColor ?? ""}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  layout: { ...m.layout, labelColor: e.target.value || undefined },
                                }))
                              }
                            />
                          </div>
                        </div>
                        <div className="grid gap-1">
                          <Label>Field value</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              className="h-9 w-10 cursor-pointer rounded-md border border-neutral-200 bg-transparent dark:border-neutral-700"
                              value={meta.layout?.valueColor ?? "#1a1a1a"}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  layout: { ...m.layout, valueColor: e.target.value },
                                }))
                              }
                            />
                            <Input
                              className="flex-1 font-mono text-xs"
                              placeholder="#1a1a1a"
                              value={meta.layout?.valueColor ?? ""}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  layout: { ...m.layout, valueColor: e.target.value || undefined },
                                }))
                              }
                            />
                          </div>
                        </div>
                        <div className="grid gap-1 col-span-2">
                          <Label>Group header</Label>
                          <div className="flex items-center gap-2 max-w-[50%]">
                            <input
                              type="color"
                              className="h-9 w-10 cursor-pointer rounded-md border border-neutral-200 bg-transparent dark:border-neutral-700"
                              value={meta.layout?.groupHeaderColor ?? "#737373"}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  layout: { ...m.layout, groupHeaderColor: e.target.value },
                                }))
                              }
                            />
                            <Input
                              className="flex-1 font-mono text-xs"
                              placeholder="#737373"
                              value={meta.layout?.groupHeaderColor ?? ""}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  layout: { ...m.layout, groupHeaderColor: e.target.value || undefined },
                                }))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="text-[11px] text-neutral-500">
                        Reset page layout to defaults.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setMeta((m) => ({ ...m, layout: undefined }))}
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                </section>

                {/* ─── FOOTER ───────────────────────────────────── */}
                <section>
                  <h4 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    Footer
                  </h4>
                  <div className="grid gap-4">

                    {/* Footer text + its style knobs */}
                    <div className="grid gap-2">
                      <div className="grid gap-1">
                        <Label>Footer text</Label>
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
                        <p className="text-[11px] text-neutral-500">
                          Renders below the last section, separated by a thin line.
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="grid gap-1">
                          <Label>Size</Label>
                          <select
                            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                            value={meta.footer?.textSize ?? "xs"}
                            onChange={(e) =>
                              setMeta((m) => ({
                                ...m,
                                footer: {
                                  ...m.footer,
                                  textSize: e.target.value as "xs" | "sm" | "md",
                                },
                              }))
                            }
                          >
                            <option value="xs">Extra small (default)</option>
                            <option value="sm">Small</option>
                            <option value="md">Medium</option>
                          </select>
                        </div>
                        <div className="grid gap-1">
                          <Label>Align</Label>
                          <select
                            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                            value={meta.footer?.textAlign ?? "left"}
                            onChange={(e) =>
                              setMeta((m) => ({
                                ...m,
                                footer: {
                                  ...m.footer,
                                  textAlign: e.target.value as "left" | "center" | "right",
                                },
                              }))
                            }
                          >
                            <option value="left">Left (default)</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </div>
                        <div className="grid gap-1">
                          <Label>Color</Label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              className="h-9 w-10 cursor-pointer rounded-md border border-neutral-200 bg-transparent dark:border-neutral-700"
                              value={meta.footer?.textColor ?? "#a3a3a3"}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  footer: { ...m.footer, textColor: e.target.value },
                                }))
                              }
                            />
                            <Input
                              className="flex-1 font-mono text-xs"
                              placeholder="#a3a3a3"
                              value={meta.footer?.textColor ?? ""}
                              onChange={(e) =>
                                setMeta((m) => ({
                                  ...m,
                                  footer: { ...m.footer, textColor: e.target.value || undefined },
                                }))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Signature block — split into two independent controls
                        so a template can include only the company sig (e.g.
                        a receipt that's already executed by the issuer),
                        only the client sig (e.g. a quotation acceptance
                        page), both, or neither.  Reads through the legacy
                        `showSignature` flag via the `currentSig*` locals
                        below so old templates render unchanged until the
                        admin edits them. */}
                    {(() => {
                      // Resolve the effective on/off state of each block,
                      // honoring the legacy `showSignature` umbrella
                      // toggle when the new fields haven't been set.
                      const newFlagsSet =
                        typeof meta.footer?.showAuthorizedSignature === "boolean" ||
                        typeof meta.footer?.showClientSignature === "boolean";
                      const currentSigAuth = newFlagsSet
                        ? !!meta.footer?.showAuthorizedSignature
                        : !!meta.footer?.showSignature;
                      const currentSigClient = newFlagsSet
                        ? !!meta.footer?.showClientSignature
                        : !!meta.footer?.showSignature;
                      // Setting either new flag clears the legacy umbrella
                      // so we don't end up with three flags telling
                      // different stories on the same template.
                      const setSigFlag = (
                        which: "showAuthorizedSignature" | "showClientSignature",
                        value: boolean,
                      ) =>
                        setMeta((m) => ({
                          ...m,
                          footer: {
                            ...m.footer,
                            [which]: value,
                            // Once split, drop the legacy flag.
                            showSignature: undefined,
                            // Mirror the OTHER side from its current
                            // resolved value so toggling one doesn't
                            // accidentally clear the other.
                            ...(which === "showAuthorizedSignature"
                              ? {
                                  showClientSignature:
                                    m.footer?.showClientSignature ?? currentSigClient,
                                }
                              : {
                                  showAuthorizedSignature:
                                    m.footer?.showAuthorizedSignature ?? currentSigAuth,
                                }),
                          },
                        }));

                      return (
                        <div className="grid gap-3">
                          <div className="grid grid-cols-2 gap-3">
                            {/* ── Authorized signature ────────────── */}
                            <div className="rounded-md border border-neutral-200 p-2.5 dark:border-neutral-700">
                              <label className="flex items-center gap-1.5 text-sm font-medium">
                                <input
                                  type="checkbox"
                                  checked={currentSigAuth}
                                  onChange={(e) =>
                                    setSigFlag("showAuthorizedSignature", e.target.checked)
                                  }
                                />
                                Authorized signature
                              </label>
                              {currentSigAuth && (
                                <div className="mt-2 grid gap-2">
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Label</Label>
                                    <Input
                                      value={meta.footer?.signatureLeftLabel ?? ""}
                                      onChange={(e) =>
                                        setMeta((m) => ({
                                          ...m,
                                          footer: {
                                            ...m.footer,
                                            signatureLeftLabel: e.target.value || undefined,
                                          },
                                        }))
                                      }
                                      placeholder="Authorized Signature"
                                    />
                                  </div>
                                  {/* E-signature image — uploaded once per
                                      template, stamped on every render so
                                      the doc arrives pre-signed.  Without
                                      it the line is blank and the company
                                      rep would have to wet-sign a printout. */}
                                  <div className="grid gap-1">
                                    <Label className="text-xs">E-signature image</Label>
                                    {meta.footer?.authorizedSignatureImage ? (
                                      <div className="flex items-start gap-2">
                                        <div className="flex h-12 w-24 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-700">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={`/api/pdf-templates/images/${meta.footer.authorizedSignatureImage}`}
                                            alt="Authorized signature"
                                            className="max-h-full max-w-full object-contain"
                                          />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={uploadingSig}
                                            onClick={() => sigFileInputRef.current?.click()}
                                          >
                                            {uploadingSig ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <Upload className="h-3.5 w-3.5" />
                                            )}
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              setMeta((m) => ({
                                                ...m,
                                                footer: {
                                                  ...m.footer,
                                                  authorizedSignatureImage: undefined,
                                                },
                                              }))
                                            }
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={uploadingSig}
                                        onClick={() => sigFileInputRef.current?.click()}
                                        className="w-fit"
                                      >
                                        {uploadingSig ? (
                                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
                                        )}
                                        Upload signature
                                      </Button>
                                    )}
                                    <input
                                      ref={sigFileInputRef}
                                      type="file"
                                      accept="image/png,image/jpeg"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void uploadAuthorizedSignature(file);
                                      }}
                                    />
                                    {meta.footer?.authorizedSignatureImage && (
                                      <select
                                        className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-900 outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                        value={meta.footer?.authorizedSignatureImageHeight ?? "md"}
                                        onChange={(e) =>
                                          setMeta((m) => ({
                                            ...m,
                                            footer: {
                                              ...m.footer,
                                              authorizedSignatureImageHeight: e.target.value as
                                                | "sm"
                                                | "md"
                                                | "lg",
                                            },
                                          }))
                                        }
                                      >
                                        <option value="sm">Small (~32px)</option>
                                        <option value="md">Medium (~48px)</option>
                                        <option value="lg">Large (~72px)</option>
                                      </select>
                                    )}
                                    <p className="text-[10px] text-neutral-500">
                                      PNG with transparent background works best.
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* ── Client signature ────────────────── */}
                            <div className="rounded-md border border-neutral-200 p-2.5 dark:border-neutral-700">
                              <label className="flex items-center gap-1.5 text-sm font-medium">
                                <input
                                  type="checkbox"
                                  checked={currentSigClient}
                                  onChange={(e) =>
                                    setSigFlag("showClientSignature", e.target.checked)
                                  }
                                />
                                Client signature
                              </label>
                              {currentSigClient && (
                                <div className="mt-2 grid gap-2">
                                  <div className="grid gap-1">
                                    <Label className="text-xs">Label</Label>
                                    <Input
                                      value={meta.footer?.signatureRightLabel ?? ""}
                                      onChange={(e) =>
                                        setMeta((m) => ({
                                          ...m,
                                          footer: {
                                            ...m.footer,
                                            signatureRightLabel: e.target.value || undefined,
                                          },
                                        }))
                                      }
                                      placeholder="Client Signature"
                                    />
                                  </div>
                                  <p className="text-[10px] text-neutral-500">
                                    Renders as a blank line for the client to sign by hand.
                                    {" "}
                                    <span className="text-neutral-400">
                                      (Online e-sign capture is on the roadmap.)
                                    </span>
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Page numbers */}
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={meta.footer?.showPageNumbers ?? false}
                        onChange={(e) =>
                          setMeta((m) => ({
                            ...m,
                            footer: {
                              ...m.footer,
                              showPageNumbers: e.target.checked,
                            },
                          }))
                        }
                      />
                      Show page numbers
                      <span className="text-[11px] text-neutral-500">
                        (visible when printed / saved as PDF)
                      </span>
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="space-y-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
              {/* Make it crystal-clear that the Style drawer changes only
                  live in memory until the template itself is saved.
                  Previously the single "Done" button looked like a save
                  action and admins lost their edits by closing the main
                  editor without realising. */}
              <p className="text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
                Style edits update the preview live but are <strong>not yet saved</strong>.
                Click <strong>Save &amp; Close</strong> to persist to the template, or <strong>Close</strong> to
                keep them in memory and save later from the main editor.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowLayoutStyle(false)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={saving}
                  onClick={async () => {
                    const ok = await save();
                    if (ok) setShowLayoutStyle(false);
                  }}
                >
                  {saving ? "Saving…" : "Save & Close"}
                </Button>
              </div>
            </div>
          </DrawerContent>
        </Drawer>

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
            onApplied={(appliedCount) => {
              // Stamp the badge on the source section so the header bar
              // shows "Applied to N templates" immediately after the dialog
              // closes — no need to re-open or save manually.
              if (applySectionIdx !== null) {
                setMeta((m) => ({
                  ...m,
                  sections: m.sections.map((s, i) =>
                    i === applySectionIdx
                      ? {
                          ...s,
                          lastAppliedAt: new Date().toISOString(),
                          lastAppliedCount: appliedCount,
                        }
                      : s,
                  ),
                }));
              }
              setApplySectionIdx(null);
              void load();
            }}
          />
        )}

        {/* "Apply this template's style to other templates" dialog */}
        {showApplyStyleToOthers && editing && (
          <StyleApplyToOthersDialog
            open={showApplyStyleToOthers}
            onOpenChange={setShowApplyStyleToOthers}
            sourceMeta={meta}
            sourceTemplateId={editing.id}
            sourceTemplateLabel={editing.label}
            allTemplates={rows}
            onApplied={() => {
              setShowApplyStyleToOthers(false);
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
              onClick={() => setShowLayoutStyle(true)}
              className="gap-1.5"
              title="Edit header, page layout and footer for this template"
            >
              <Palette className="h-3.5 w-3.5" />
              Style
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
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "Save" : "Create"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
            title="Close the editor. Unsaved changes will be lost."
          >
            Close
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
        onConfirm={(ids, syncStyle) => {
          if (pickerState) {
            pickerState.resolve({ ids, syncStyle });
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
  /**
   * Patch section-level fields that the per-group header row needs to
   * update (currently `groupColumns` and `fullWidthGroups`). Same shape
   * as React.useState's setter argument so callers can pass partial
   * updates without rebuilding the whole section.
   */
  onPatchSection: (patch: Partial<TemplateSection>) => void;
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
  onPatchSection,
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

  // Reorder one whole group as a contiguous block. The bucketing logic
  // above derives group order from "first appearance in section.fields",
  // so to move a group up/down we re-pack the array group-by-group in the
  // new order. Fields keep their *intra*-group order; only the group
  // blocks swap with the neighbour. Used by the up/down arrows on each
  // group-header row so admins can reorder groups without having to
  // drag individual fields across group boundaries.
  const moveGroup = React.useCallback(
    (groupName: string, dir: -1 | 1) => {
      const fromIdx = grouped.buckets.findIndex((b) => b.name === groupName);
      const toIdx = fromIdx + dir;
      if (fromIdx < 0 || toIdx < 0 || toIdx >= grouped.buckets.length) return;
      const next = [...grouped.buckets];
      [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
      onReorder(next.flatMap((b) => b.items.map((it) => it.field)));
    },
    [grouped.buckets, onReorder],
  );

  // Per-group "Cols" override. Setting `value` to "default" deletes the
  // entry so the section-level `columns` is used (keeps `groupColumns`
  // sparse — only groups that diverge from the default are persisted).
  const setGroupColumns = React.useCallback(
    (groupName: string, value: 1 | 2 | "default") => {
      const next: Record<string, 1 | 2> = { ...(section.groupColumns ?? {}) };
      if (value === "default") {
        delete next[groupName];
      } else {
        next[groupName] = value;
      }
      onPatchSection({
        groupColumns: Object.keys(next).length > 0 ? next : undefined,
      });
    },
    [section.groupColumns, onPatchSection],
  );

  // Toggle a group's "full width" status — i.e. whether it spans both
  // columns in the section's 2-group-blocks-per-row grid. Stored as a
  // sparse list so a fresh template never carries `fullWidthGroups: []`.
  const toggleFullWidthGroup = React.useCallback(
    (groupName: string) => {
      const current = new Set(section.fullWidthGroups ?? []);
      if (current.has(groupName)) {
        current.delete(groupName);
      } else {
        current.add(groupName);
      }
      onPatchSection({
        fullWidthGroups: current.size > 0 ? Array.from(current) : undefined,
      });
    },
    [section.fullWidthGroups, onPatchSection],
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
          {grouped.buckets.map((bucket, bucketIdx) => (
            <React.Fragment key={bucket.name}>
              {grouped.hasGroups && (
                <TableRow className="bg-neutral-50 hover:bg-neutral-50 dark:bg-neutral-800/40 dark:hover:bg-neutral-800/40">
                  <TableCell
                    colSpan={colSpan}
                    className="px-2 py-1.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span>{bucket.name}</span>
                        <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
                          {bucket.items.length} field{bucket.items.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Per-group: fields-per-row override. "Default" =
                            inherit section-level `columns`. Skipped for
                            the synthetic "Other" bucket because that is
                            for fields without a group label and there is
                            no way to refer to it from a saved override
                            (it is purely a render-time bucket). */}
                        {bucket.name !== "Other" && (
                          <label
                            className="flex items-center gap-1 normal-case tracking-normal text-[10px] sm:text-[11px] font-normal text-neutral-500 dark:text-neutral-400"
                            title="Fields per row inside this group. Default uses the section's Columns setting."
                          >
                            Cols:
                            <select
                              className="h-6 rounded border border-neutral-300 bg-white px-1 text-[11px] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                              value={String(section.groupColumns?.[bucket.name] ?? "default")}
                              onChange={(e) =>
                                setGroupColumns(
                                  bucket.name,
                                  e.target.value === "default"
                                    ? "default"
                                    : (Number(e.target.value) as 1 | 2),
                                )
                              }
                            >
                              <option value="default">default</option>
                              <option value="1">1</option>
                              <option value="2">2</option>
                            </select>
                          </label>
                        )}
                        {/* Per-group: full-width toggle. Only meaningful
                            when the section is in 2-group-blocks-per-row
                            mode — otherwise every group is already
                            full-width. We still render the checkbox as
                            disabled in that case (instead of hiding it)
                            so admins can discover the setting and see
                            why it has no effect. */}
                        {bucket.name !== "Other" && (
                          <label
                            className={`flex items-center gap-1 normal-case tracking-normal text-[10px] sm:text-[11px] font-normal ${
                              section.fieldGroupColumns === 2
                                ? "text-neutral-500 dark:text-neutral-400 cursor-pointer"
                                : "text-neutral-400 dark:text-neutral-500 cursor-not-allowed opacity-60"
                            }`}
                            title={
                              section.fieldGroupColumns === 2
                                ? "Force this group to span the full section width, even when other groups are paired 2-per-row."
                                : "Only available when the section's Group columns is set to 2."
                            }
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3"
                              checked={!!section.fullWidthGroups?.includes(bucket.name)}
                              disabled={section.fieldGroupColumns !== 2}
                              onChange={() => toggleFullWidthGroup(bucket.name)}
                            />
                            Full width
                          </label>
                        )}
                        {/* Reorder this whole group (block) up or down.
                            Hidden when there is only one group because
                            there is nothing to swap with. */}
                        {grouped.buckets.length > 1 && (
                          <div className="flex items-center gap-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => moveGroup(bucket.name, -1)}
                              disabled={bucketIdx === 0}
                              className="h-6 w-6"
                              aria-label={`Move group ${bucket.name} up`}
                              title="Move this group up"
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => moveGroup(bucket.name, 1)}
                              disabled={bucketIdx === grouped.buckets.length - 1}
                              className="h-6 w-6"
                              aria-label={`Move group ${bucket.name} down`}
                              title="Move this group down"
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
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
