"use client";

import * as React from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronDown, ChevronRight,
  Plus, Trash2, Save, Crosshair, Copy,
  FolderPlus, Pencil, Check, X,
  FileText, ImagePlus, Eye, EyeOff, Search, Loader2,
  Type, Square, CheckSquare, Settings2, FlaskConical, CheckCircle2,
  CircleDot, TextCursorInput,
} from "lucide-react";
import type {
  PdfTemplateRow, PdfTemplateMeta, PdfFieldMapping, PdfTemplateSection,
  PdfImageMapping, PdfDrawing, PdfCheckbox, PdfRadioGroup, PdfRadioOption,
  PdfTextInput,
} from "@/lib/types/pdf-template";
import {
  DATA_SOURCE_OPTIONS, FIELD_KEY_HINTS, FORMAT_OPTIONS,
  SECTION_COLORS, DEFAULT_REPEATABLE_SLOTS,
} from "@/lib/types/pdf-template";
import { buildByLabelKey, slugifyLabel } from "@/lib/field-resolver";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const DEFAULT_FONT_SIZE = 10;

type SectionField = {
  label: string;
  fieldKey: string;
  format?: PdfFieldMapping["format"];
  defaultOn?: boolean;
  trueValue?: string;
  falseValue?: string;
  matchValue?: string;
  /**
   * Admin-configured category restrictions for this field (e.g. ["car"]).
   * Display-only — shown as badges in the section picker so admins can
   * pick a category-specific variant when needed. Does not affect how
   * the resolver fetches values.
   */
  categories?: string[];
  /**
   * Marks this entry as a synthetic by-label aggregator. The resolver
   * recognises the `__byLabel__<slug>` field key and auto-picks the
   * right snapshot value based on the policy's selected category, so
   * one PDF placement (e.g. "Make") works across vehicle types.
   */
  synthetic?: boolean;
};
type OptionRow = { label?: unknown; value?: unknown; valueType?: unknown; meta?: unknown };
type RepeatableChildSpec = {
  label: string;
  value: string;
  inputType?: string;
};
type DynamicAdminField = {
  label: string;
  value: string;
  valueType?: string;
  categories?: string[];
  /**
   * True when this entry was synthesised from a cascading second-level
   * field nested inside a parent's `meta.options[].children` (e.g. the
   * "Model" dropdown that appears under each Make option). Such entries
   * are only useful as part of an Auto by-label group — admins can't
   * meaningfully place a single per-option variant — so we skip them
   * from the "More fields" list when the group has no other variants.
   */
  isChildOption?: boolean;
  /**
   * Set when this admin field is `inputType: "repeatable"` (e.g. "Drivers",
   * "Beneficiaries"). Carries the child sub-field schema so the editor can
   * expand the parent into N indexed slots ("Driver 1 — First Name", etc.)
   * with deterministic snapshot keys (`drivers__r0__firstName`).
   */
  repeatableChildren?: RepeatableChildSpec[];
  /**
   * Singular item label admins set on the repeatable parent (e.g. "Driver")
   * — used to build the per-slot picker label "Driver 1 — First Name".
   * Falls back to the parent's `label` when missing.
   */
  repeatableItemLabel?: string;
};
type OrganisationRow = { id?: unknown; name?: unknown };

type SectionTemplate = {
  name: string;
  source: PdfFieldMapping["source"];
  /** For source = "package", the package key (e.g. "vehicleinfo"). */
  packageName?: string;
  color: string;
  fields: SectionField[];
  lineKey?: string;
};

/**
 * Synthetic / computed fields per source — these are produced by the
 * field-resolver and do NOT live in form_options. They are merged into
 * the dynamic field list so admins can pick them in the Add Section
 * dialog without configuring them.
 *
 * Keep in sync with `lib/field-resolver.ts`:
 *  - resolveInsured: `displayName`, `primaryId`, `age`
 *  - resolveContact: `fullAddress`
 *  - resolveOrganisation: `fullAddress`
 */
const SYNTHETIC_FIELDS_BY_SOURCE: Record<string, SectionField[]> = {
  insured: [
    // `synthetic: true` shows the green "Auto" badge in the picker —
    // these computed fields auto-pick the right value based on the
    // policy's insured type (personal vs company), exactly like the
    // by-label aggregators built for admin-configured packages.
    { label: "Display Name", fieldKey: "displayName", defaultOn: true, synthetic: true },
    { label: "Primary ID", fieldKey: "primaryId", defaultOn: true, synthetic: true },
    // "Age" auto-routes between insured-with-license (insured snapshot)
    // and Driver 1 (`driver.moreDriver[0]`) — same conditional logic
    // the user described for the driver table on motor proposal forms.
    // Resolves a stored `age`, an admin-configured formula, or finally
    // a hard-coded YEARS_BETWEEN(TODAY, {dob}) so it works out-of-the-
    // box without any extra config.
    { label: "Age", fieldKey: "age", format: "number", defaultOn: true, synthetic: true },
  ],
  contactinfo: [
    { label: "Full Address", fieldKey: "fullAddress", defaultOn: true, synthetic: true },
  ],
  organisation: [
    { label: "Full Address", fieldKey: "fullAddress", defaultOn: true, synthetic: true },
  ],
};

/**
 * Admin field keys whose value is already covered by a synthetic field
 * for the same source. Matching is fuzzy (lowercase + alphanumerics
 * only) so admins can name keys `last_name`, `lastName`, `LastName`,
 * etc. and we still recognise them.
 *
 * Fields recognised here are kept in the picker (so templates needing
 * separate boxes — e.g. proposal forms with split last/first name —
 * still work), but are tucked under the "More fields" divider so the
 * smarter synthetic field is the obvious default.
 *
 * Keep in sync with the synthetic computed fields above.
 */
const HANDLED_FIELD_KEYS_BY_SOURCE: Record<string, Set<string>> = {
  insured: new Set([
    // Handled by `displayName` (resolves to person OR company name)
    "lastname", "firstname", "fullname", "name",
    "companyname", "fullcompanyname",
    // Handled by `primaryId` (resolves to ID OR BR number)
    "idnumber", "id", "hkid", "hkidnumber",
    "brnumber", "br", "businessregistration", "businessregistrationnumber",
    "cinumber", "ci",
    // Handled by `age` (auto-routes insured-with-license OR Driver 1)
    "age",
  ]),
  contactinfo: new Set([
    // Handled by `fullAddress`
    "address", "fulladdress",
    "flatnumber", "floornumber", "blocknumber", "blockname",
    "streetnumber", "streetname",
    "propertyname", "districtname", "area",
  ]),
  organisation: new Set([
    "address", "fulladdress",
    "flatnumber", "floornumber", "blocknumber", "blockname",
    "streetnumber", "streetname",
    "propertyname", "districtname", "area",
  ]),
};

function normalizeFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatForValueType(valueType?: string): PdfFieldMapping["format"] | undefined {
  const t = valueType?.toLowerCase().trim();
  if (!t) return undefined;
  if (["boolean", "bool", "checkbox", "switch", "yesno", "yes_no"].includes(t)) return "boolean";
  if (["date", "datetime"].includes(t)) return "date";
  if (["number", "integer", "decimal"].includes(t)) return "number";
  if (["currency", "money", "amount"].includes(t)) return "currency";
  return undefined;
}

/**
 * Stable color mapping for well-known packages. Other packages get a
 * deterministic fallback color from PACKAGE_FALLBACK_COLORS.
 */
const PACKAGE_COLOR_MAP: Record<string, string> = {
  insured: "#3b82f6",
  contactinfo: "#10b981",
  vehicleinfo: "#f97316",
  policyinfo: "#a855f7",
  endorsement: "#0891b2",
};

const PACKAGE_FALLBACK_COLORS = [
  "#3b82f6", "#10b981", "#f97316", "#a855f7", "#0891b2", "#84cc16",
  "#eab308", "#14b8a6", "#6366f1", "#d946ef",
];

function colorForPackage(pkgKey: string): string {
  if (PACKAGE_COLOR_MAP[pkgKey]) return PACKAGE_COLOR_MAP[pkgKey];
  let hash = 0;
  for (let i = 0; i < pkgKey.length; i++) {
    hash = ((hash << 5) - hash + pkgKey.charCodeAt(i)) | 0;
  }
  return PACKAGE_FALLBACK_COLORS[Math.abs(hash) % PACKAGE_FALLBACK_COLORS.length];
}

/**
 * Built-in section templates for sources that are NOT loaded from
 * form_options (policy / accounting / agent / client / organisation).
 * Package-based templates (insured, contactinfo, vehicleinfo, …) are
 * built dynamically from `/api/form-options?groupKey=packages`.
 */
const BUILT_IN_SECTION_TEMPLATES: SectionTemplate[] = [
  {
    name: "Policy",
    source: "policy",
    color: "#f59e0b",
    fields: [
      { label: "Policy Number", fieldKey: "policyNumber", defaultOn: true },
      { label: "Created Date", fieldKey: "createdAt", format: "date", defaultOn: true },
    ],
  },
  {
    name: "Accounting",
    source: "accounting",
    color: "#ef4444",
    fields: [
      { label: "Gross Premium", fieldKey: "grossPremium", format: "currency", defaultOn: true },
      { label: "Net Premium", fieldKey: "netPremium", format: "currency", defaultOn: true },
      { label: "Client Premium", fieldKey: "clientPremium", format: "currency", defaultOn: true },
      { label: "Agent Commission", fieldKey: "agentCommission", format: "currency", defaultOn: true },
      { label: "Credit Premium", fieldKey: "creditPremium", format: "currency" },
      { label: "IA Levy", fieldKey: "levy", format: "currency" },
      { label: "Stamp Duty", fieldKey: "stampDuty", format: "currency" },
      { label: "Discount", fieldKey: "discount", format: "currency" },
      { label: "Commission Rate", fieldKey: "commissionRate" },
      { label: "Currency", fieldKey: "currency" },
      { label: "Margin", fieldKey: "margin" },
      { label: "Line Label", fieldKey: "lineLabel" },
      { label: "Insurer Name", fieldKey: "insurerName" },
      { label: "Insurer Contact Name", fieldKey: "insurerContactName" },
      { label: "Insurer Contact Email", fieldKey: "insurerContactEmail" },
      { label: "Insurer Contact Phone", fieldKey: "insurerContactPhone" },
      { label: "Insurer Address", fieldKey: "insurerAddress" },
      { label: "Collaborator Name", fieldKey: "collaboratorName" },
    ],
  },
  {
    name: "Total Premium",
    source: "accounting",
    color: "#dc2626",
    lineKey: "total",
    fields: [
      { label: "Total Gross Premium", fieldKey: "grossPremium", format: "currency", defaultOn: true },
      { label: "Total Net Premium", fieldKey: "netPremium", format: "currency", defaultOn: true },
      { label: "Total Client Premium", fieldKey: "clientPremium", format: "currency", defaultOn: true },
      { label: "Total Agent Commission", fieldKey: "agentCommission", format: "currency", defaultOn: true },
      { label: "Total Levy", fieldKey: "levy", format: "currency" },
      { label: "Total Stamp Duty", fieldKey: "stampDuty", format: "currency" },
      { label: "Total Discount", fieldKey: "discount", format: "currency" },
      { label: "Total Margin", fieldKey: "margin", format: "currency", defaultOn: true },
    ],
  },
  {
    name: "Agent",
    source: "agent",
    color: "#8b5cf6",
    fields: [
      { label: "Agent Name", fieldKey: "name", defaultOn: true },
      { label: "Agent Email", fieldKey: "email", defaultOn: true },
      { label: "User Number", fieldKey: "userNumber", defaultOn: true },
    ],
  },
  {
    name: "Client",
    source: "client",
    color: "#ec4899",
    fields: [
      { label: "Client Number", fieldKey: "clientNumber", defaultOn: true },
      { label: "Display Name", fieldKey: "displayName", defaultOn: true, synthetic: true },
      { label: "Primary ID", fieldKey: "primaryId", defaultOn: true, synthetic: true },
      { label: "Category", fieldKey: "category" },
      { label: "Contact Phone", fieldKey: "contactPhone", defaultOn: true },
    ],
  },
  {
    name: "Organisation / Insurer",
    source: "organisation",
    color: "#06b6d4",
    fields: [
      { label: "Company Name", fieldKey: "name", defaultOn: true },
      { label: "Contact Name", fieldKey: "contactName", defaultOn: true },
      { label: "Contact Email", fieldKey: "contactEmail", defaultOn: true },
      { label: "Contact Phone", fieldKey: "contactPhone", defaultOn: true },
      { label: "Full Address", fieldKey: "fullAddress", defaultOn: true, synthetic: true },
    ],
  },
];

/**
 * Build a dynamic section template for an admin-configured package. The
 * resulting template merges synthetic computed fields (e.g. displayName)
 * with the admin-configured fields from `${pkg}_fields`. If the package
 * has no admin fields configured, only synthetic fields are returned.
 *
 * Same-label variants (e.g. "Make" defined three times scoped to `car`,
 * `motorcycle`, `truck`) are collapsed into ONE synthetic by-label
 * entry — analogous to how `displayName` resolves personal vs company
 * insured. The placed mapping uses a `__byLabel__<slug>` key that the
 * field-resolver auto-routes to the right variant based on the policy's
 * category, while the raw category-specific variants are kept under
 * "More fields" so admins can still pick a single category if they want
 * a category-locked placement.
 */
function buildPackageSectionTemplate(
  pkg: { label: string; value: string },
  adminFields: DynamicAdminField[],
  slotCount: number = DEFAULT_REPEATABLE_SLOTS,
): SectionTemplate {
  const synthetic = SYNTHETIC_FIELDS_BY_SOURCE[pkg.value] ?? [];
  const syntheticKeys = new Set(synthetic.map((f) => f.fieldKey.toLowerCase()));
  const handledKeys = HANDLED_FIELD_KEYS_BY_SOURCE[pkg.value] ?? new Set<string>();

  // Pull repeatable parents out of the regular pipeline. They expand
  // into one entry per (slot × child) so admins can place "Driver 2 —
  // First Name" individually on the PDF.
  const repeatableParents: DynamicAdminField[] = [];
  const nonRepeatable: DynamicAdminField[] = [];
  for (const f of adminFields) {
    if (f.repeatableChildren && f.repeatableChildren.length > 0) {
      repeatableParents.push(f);
    } else {
      nonRepeatable.push(f);
    }
  }

  const filteredAdminFields = nonRepeatable.filter(
    (f) => f.value && !syntheticKeys.has(f.value.toLowerCase()),
  );

  // Group admin fields by a slugified label so case / spacing / punctuation
  // differences (e.g. "Body Type" vs "Body type") still collapse into one
  // by-label entry. Same-label fields with different category restrictions
  // become a single auto-resolving entry.
  const groupsBySlug = new Map<string, DynamicAdminField[]>();
  const groupDisplayLabel = new Map<string, string>();
  const slugOrder: string[] = [];
  for (const f of filteredAdminFields) {
    const lbl = f.label || f.value;
    const slug = slugifyLabel(lbl);
    if (!groupsBySlug.has(slug)) {
      groupsBySlug.set(slug, []);
      groupDisplayLabel.set(slug, lbl);
      slugOrder.push(slug);
    }
    groupsBySlug.get(slug)!.push(f);
  }

  const adminSectionFields: SectionField[] = [];
  for (const slug of slugOrder) {
    const lbl = groupDisplayLabel.get(slug) ?? "";
    const variants = groupsBySlug.get(slug) ?? [];
    const directVariants = variants.filter((v) => !v.isChildOption);
    const hasChildVariant = variants.some((v) => v.isChildOption);
    const hasCategoryRestriction = variants.some(
      (v) => Array.isArray(v.categories) && v.categories.length > 0,
    );

    // Promote ONE smart "by-label" entry when:
    //  • the group includes a cascading second-level child (e.g. the
    //    "Model" dropdown nested under each Make option) — its real
    //    snapshot key depends on which parent option was picked, so the
    //    by-label path is the only way to render it; OR
    //  • there are 2+ direct variants and at least one is category-
    //    scoped (e.g. "Make" defined for car / motorcycle / truck).
    // Plain duplicates with no category scope fall through to the
    // regular behavior so a misconfiguration stays visible.
    const needsAuto =
      hasChildVariant
      || (directVariants.length >= 2 && hasCategoryRestriction);

    if (needsAuto) {
      // Prefer a direct (top-level) variant's valueType for the Auto
      // entry's format — child cascading inputs are usually `select`
      // (which formats as raw text) so they would mask a sensible
      // number/date format inherited from a same-label top-level field.
      const formatSeed = directVariants[0] ?? variants[0];
      const fmt = formatForValueType(formatSeed?.valueType);
      adminSectionFields.push({
        label: lbl,
        fieldKey: buildByLabelKey(lbl),
        format: fmt,
        trueValue: fmt === "boolean" ? "✓" : undefined,
        falseValue: fmt === "boolean" ? "" : undefined,
        defaultOn: true,
        synthetic: true,
      });
      // Only DIRECT (top-level) variants are listed under "More fields"
      // — child-option variants have synthetic placeholder keys that
      // can't resolve on their own, so they would be dead placements.
      for (const f of directVariants) {
        const vfmt = formatForValueType(f.valueType);
        adminSectionFields.push({
          label: f.label || f.value,
          fieldKey: f.value,
          format: vfmt,
          trueValue: vfmt === "boolean" ? "✓" : undefined,
          falseValue: vfmt === "boolean" ? "" : undefined,
          categories: f.categories,
          // Tucked under "More fields"; admins reach for a specific
          // variant only when they want a category-locked placement.
          defaultOn: false,
        });
      }
      continue;
    }

    // No Auto entry for this group — emit each direct variant as-is.
    // Child-only groups can't reach this branch (`needsAuto` is true
    // whenever any child variant exists), so every variant here has a
    // real snapshot key.
    for (const f of directVariants) {
      const fmt = formatForValueType(f.valueType);
      adminSectionFields.push({
        label: f.label || f.value,
        fieldKey: f.value,
        format: fmt,
        trueValue: fmt === "boolean" ? "✓" : undefined,
        falseValue: fmt === "boolean" ? "" : undefined,
        categories: f.categories,
        // Admin fields whose value is already covered by a synthetic
        // entity-level field are tucked under "More fields"; everything
        // else stays promoted as a default-on suggestion.
        defaultOn: !handledKeys.has(normalizeFieldKey(f.value)),
      });
    }
  }

  // Repeatable parents → one entry per (slot × child sub-field).
  // Snapshot key contract: `${parentKey}__r${idx}__${childKey}` (resolved
  // by `resolvePackage` in `lib/field-resolver.ts`, returns "" when the
  // row is missing so unfilled slots render blank on the PDF).
  const repeatableSectionFields: SectionField[] = [];
  const safeSlotCount = Math.max(1, Math.min(20, Math.floor(slotCount) || DEFAULT_REPEATABLE_SLOTS));
  for (const parent of repeatableParents) {
    const parentValue = parent.value;
    const itemLabel = parent.repeatableItemLabel?.trim() || parent.label?.trim() || parentValue;
    const children = parent.repeatableChildren ?? [];
    for (let i = 0; i < safeSlotCount; i++) {
      for (const child of children) {
        const childValue = child.value.trim();
        if (!childValue) continue;
        const childLabel = child.label?.trim() || childValue;
        const fmt = formatForValueType(child.inputType);
        repeatableSectionFields.push({
          label: `${itemLabel} ${i + 1} — ${childLabel}`,
          fieldKey: `${parentValue}__r${i}__${childValue}`,
          format: fmt,
          trueValue: fmt === "boolean" ? "✓" : undefined,
          falseValue: fmt === "boolean" ? "" : undefined,
          categories: parent.categories,
          // Tuck repeatable-row entries under "More fields" by default
          // — most templates only need one or two of the slots, so we
          // don't want to pre-tick all 4 × N entries on every section.
          defaultOn: false,
        });
      }
    }
  }

  const fields: SectionField[] = [
    ...synthetic,
    ...adminSectionFields,
    ...repeatableSectionFields,
  ];

  const source: PdfFieldMapping["source"] =
    pkg.value === "insured" ? "insured"
      : pkg.value === "contactinfo" ? "contactinfo"
        : "package";

  return {
    name: pkg.label || pkg.value,
    source,
    packageName: source === "package" ? pkg.value : undefined,
    color: colorForPackage(pkg.value),
    fields,
  };
}

/**
 * Single row in the "Add Section" / "Edit Section" picker. Shows the
 * field label, an "Auto" hint for synthetic by-label aggregators, and
 * category badges for category-scoped variants. Both the default and
 * "More fields" lists share this row so the visual treatment stays
 * consistent.
 */
function SectionFieldRow({
  field,
  selection,
  onToggle,
}: {
  field: SectionField;
  selection: { checked: boolean; showLabel: boolean } | undefined;
  onToggle: (fieldKey: string, prop: "checked" | "showLabel") => void;
}) {
  const checked = selection?.checked ?? false;
  const showLabel = selection?.showLabel ?? false;
  const cats = (field.categories ?? []).filter((c) => c && c.trim());
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900">
      <input
        type="checkbox"
        id={`sec-chk-${field.fieldKey}`}
        checked={checked}
        onChange={() => onToggle(field.fieldKey, "checked")}
        className="rounded border-neutral-300 dark:border-neutral-600 h-3.5 w-3.5 cursor-pointer"
      />
      <label
        htmlFor={`sec-chk-${field.fieldKey}`}
        className="flex-1 flex flex-wrap items-center gap-1.5 text-sm text-neutral-800 dark:text-neutral-200 cursor-pointer select-none"
      >
        <span>{field.label}</span>
        {field.synthetic && (
          <span
            title="Auto-picks the right value based on this policy's category — like Display Name picks personal vs company name."
            className="rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5"
          >
            Auto
          </span>
        )}
        {cats.map((c) => (
          <span
            key={c}
            title={`This variant is restricted to category: ${c}`}
            className="rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 text-[9px] font-medium px-1.5 py-0.5"
          >
            {c}
          </span>
        ))}
      </label>
      <label className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-500 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={showLabel}
          onChange={() => onToggle(field.fieldKey, "showLabel")}
          className="rounded border-neutral-300 dark:border-neutral-600 h-3 w-3"
        />
        Label
      </label>
    </div>
  );
}

function FieldListItem({
  field,
  isSelected,
  isMultiSelected,
  sectionColor,
  validationStatus,
  onSelect,
  onCtrlClick,
}: {
  field: PdfFieldMapping;
  isSelected: boolean;
  isMultiSelected: boolean;
  sectionColor?: string;
  validationStatus?: "ok" | "optional";
  onSelect: () => void;
  onCtrlClick: () => void;
}) {
  const tag =
    field.source === "package"
      ? `${field.packageName}.${field.fieldKey}`
      : field.source === "accounting"
        ? `accounting${field.lineKey ? `[${field.lineKey}]` : ""}.${field.fieldKey}`
        : `${field.source}.${field.fieldKey}`;

  return (
    <button
      type="button"
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) { onCtrlClick(); return; }
        onSelect();
      }}
      className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
        isSelected
          ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700"
          : isMultiSelected
            ? "bg-blue-50/60 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 ring-1 ring-dashed ring-blue-200 dark:ring-blue-800"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300"
      }`}
    >
      {validationStatus === "ok" && <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />}
      {validationStatus === "optional" && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-400 dark:bg-blue-500" />}
      {sectionColor && !validationStatus && (
        <div className="w-1.5 h-4 rounded-full shrink-0" style={{ backgroundColor: sectionColor }} />
      )}
      <span className="truncate font-medium flex-1">{field.label || field.fieldKey}</span>
      <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">{tag}</span>
    </button>
  );
}

const PDF_LOADING_VIEW = (
  <div className="flex items-center justify-center h-full text-sm text-neutral-500">Loading PDF...</div>
);
const PDF_ERROR_VIEW = (
  <div className="flex items-center justify-center h-full text-sm text-red-500 dark:text-red-400">Failed to load PDF</div>
);

/**
 * The PDF.js canvas is rasterised once at this width and then CSS-scaled
 * to the actual `displayWidth`. Any layout shift (modal scroll-lock,
 * sidebar collapse, browser resize) becomes a free transform update
 * instead of a full PDF.js re-render — which is what produced the
 * visible flash whenever the dialog scroll-lock changed body padding.
 *
 * Kept in sync with the `Math.min(containerWidth, NATURAL_PDF_WIDTH)`
 * clamp used to compute `displayWidth`, so we always downscale (sharp
 * on retina) and never upscale (which would blur the canvas).
 */
const NATURAL_PDF_WIDTH = 800;

type PdfPageBackgroundProps = {
  pdfUrl: string;
  isBlankPage: boolean;
  currentPage: number;
  displayWidth: number;
};

/**
 * Inner PDF.js renderer — kept as a separate `React.memo` so the
 * expensive Document/Page subtree is only reconciled when the actual
 * content (file or page index) changes. The width prop is a constant
 * (`NATURAL_PDF_WIDTH`), so once rasterised, the canvas is never
 * redrawn for layout reasons.
 */
const PdfPageInner = React.memo(
  function PdfPageInner({ pdfUrl, currentPage }: { pdfUrl: string; currentPage: number }) {
    return (
      <Document file={pdfUrl} loading={PDF_LOADING_VIEW} error={PDF_ERROR_VIEW}>
        <Page
          pageNumber={currentPage + 1}
          width={NATURAL_PDF_WIDTH}
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
      </Document>
    );
  },
);

/**
 * Outer scaling wrapper — re-renders freely whenever `displayWidth`
 * changes (so the CSS transform stays accurate), but the memoised
 * `<PdfPageInner>` skips reconciliation because its props are
 * unchanged. Result: width changes are a pure CSS transform update,
 * never a PDF.js redraw, never a canvas blank.
 */
function PdfPageBackground({ pdfUrl, isBlankPage, currentPage, displayWidth }: PdfPageBackgroundProps) {
  if (isBlankPage) {
    return (
      <div className="w-full h-full bg-white flex items-center justify-center">
        <span className="text-neutral-300 text-sm select-none pointer-events-none">Blank Page</span>
      </div>
    );
  }

  const scaleRatio = displayWidth / NATURAL_PDF_WIDTH;

  return (
    <div
      style={{
        width: NATURAL_PDF_WIDTH,
        transform: scaleRatio === 1 ? undefined : `scale(${scaleRatio})`,
        transformOrigin: "top left",
      }}
    >
      <PdfPageInner pdfUrl={pdfUrl} currentPage={currentPage} />
    </div>
  );
}

type Props = {
  template: PdfTemplateRow;
  onClose: () => void;
};

export default function PdfTemplateEditor({ template, onClose }: Props) {
  const meta = template.meta as unknown as PdfTemplateMeta;
  const pdfUrl = React.useMemo(
    () => `/api/pdf-templates/${template.id}/preview`,
    [template.id],
  );

  const [fields, setFields] = React.useState<PdfFieldMapping[]>(meta.fields ?? []);
  const [sections, setSections] = React.useState<PdfTemplateSection[]>(meta.sections ?? []);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [currentPage, setCurrentPage] = React.useState(0);
  const [placingMode, setPlacingMode] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [validatingFields, setValidatingFields] = React.useState(false);
  const [validationResult, setValidationResult] = React.useState<{
    policyNumber: string;
    totalFields: number;
    okCount: number;
    optionalCount: number;
    results: { id: string; source: string; fieldKey: string; resolved: unknown; status: "ok" | "optional" }[];
  } | null>(null);
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());
  const [renamingSectionId, setRenamingSectionId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [showSectionPicker, setShowSectionPicker] = React.useState(false);
  const [sectionPickerTemplate, setSectionPickerTemplate] = React.useState<SectionTemplate | null>(null);
  const [packageSectionTemplates, setPackageSectionTemplates] = React.useState<SectionTemplate[]>([]);
  const [fieldSelections, setFieldSelections] = React.useState<Record<string, { checked: boolean; showLabel: boolean }>>({});
  const [sectionLabelColor, setSectionLabelColor] = React.useState("#6b7280");
  const [sectionDataColor, setSectionDataColor] = React.useState("#000000");
  const [structuredLayout, setStructuredLayout] = React.useState(true);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = React.useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = React.useState<Set<string>>(new Set());
  const [images, setImages] = React.useState<PdfImageMapping[]>(meta.images ?? []);
  const [drawings, setDrawings] = React.useState<PdfDrawing[]>(meta.drawings ?? []);
  const [pages, setPages] = React.useState(meta.pages ?? []);
  const [selectedImageId, setSelectedImageId] = React.useState<string | null>(null);
  const [draggingImageId, setDraggingImageId] = React.useState<string | null>(null);
  const [imageUrls, setImageUrls] = React.useState<Record<string, string>>({});
  const [selectedDrawingId, setSelectedDrawingId] = React.useState<string | null>(null);
  const [draggingDrawingId, setDraggingDrawingId] = React.useState<string | null>(null);
  const [resizingDrawingId, setResizingDrawingId] = React.useState<string | null>(null);
  const [editingDrawingId, setEditingDrawingId] = React.useState<string | null>(null);

  const [checkboxes, setCheckboxes] = React.useState<PdfCheckbox[]>(meta.checkboxes ?? []);
  const [selectedCheckboxId, setSelectedCheckboxId] = React.useState<string | null>(null);
  const [draggingCheckboxId, setDraggingCheckboxId] = React.useState<string | null>(null);
  const [resizingCheckboxId, setResizingCheckboxId] = React.useState<string | null>(null);
  const [editingCheckboxId, setEditingCheckboxId] = React.useState<string | null>(null);
  // Multi-select for checkboxes & radio options (separate from field
  // multi-select). Stored as `${kind}:${id}` strings so we can mix
  // kinds in one selection (cb:UUID, ro:GROUP_ID/OPTION_ID).
  const [multiSelectedShapeIds, setMultiSelectedShapeIds] = React.useState<Set<string>>(new Set());

  const [radioGroups, setRadioGroups] = React.useState<PdfRadioGroup[]>(meta.radioGroups ?? []);
  const [selectedRadioOption, setSelectedRadioOption] = React.useState<{ groupId: string; optionId: string } | null>(null);
  const [draggingRadioOption, setDraggingRadioOption] = React.useState<{ groupId: string; optionId: string } | null>(null);
  const [resizingRadioOption, setResizingRadioOption] = React.useState<{ groupId: string; optionId: string } | null>(null);
  const [editingRadioGroupId, setEditingRadioGroupId] = React.useState<string | null>(null);

  // Fillable AcroForm text inputs — recipient can type into these in
  // the generated PDF. Editor renders a soft-blue rectangle with a
  // small "Input" tag so admins can find them on the canvas; the
  // generated PDF replaces it with a real `pdf-lib` TextField widget.
  const [textInputs, setTextInputs] = React.useState<PdfTextInput[]>(meta.textInputs ?? []);
  const [selectedTextInputId, setSelectedTextInputId] = React.useState<string | null>(null);
  const [draggingTextInputId, setDraggingTextInputId] = React.useState<string | null>(null);
  const [resizingTextInputId, setResizingTextInputId] = React.useState<string | null>(null);
  const [editingTextInputId, setEditingTextInputId] = React.useState<string | null>(null);

  type CtxMenu =
    | { kind: "checkbox"; id: string; screenX: number; screenY: number }
    | { kind: "radioOption"; groupId: string; optionId: string; screenX: number; screenY: number };
  const [ctxMenu, setCtxMenu] = React.useState<CtxMenu | null>(null);

  // Rubber-band (marquee) selection — drawn in canvas-local coords.
  const [dragSel, setDragSel] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const [previewPolicyId, setPreviewPolicyId] = React.useState<number | null>(null);
  const [previewPolicyNumber, setPreviewPolicyNumber] = React.useState("");
  const [previewValues, setPreviewValues] = React.useState<Record<string, string>>({});
  const [showPolicyPicker, setShowPolicyPicker] = React.useState(false);
  const [policySearch, setPolicySearch] = React.useState("");
  const [policyResults, setPolicyResults] = React.useState<{ id: number; policyNumber: string }[]>([]);
  const [policySearching, setPolicySearching] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  const [showImageDialog, setShowImageDialog] = React.useState(false);
  const [pendingImageFile, setPendingImageFile] = React.useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = React.useState<string>("");
  const [pendingImageLabel, setPendingImageLabel] = React.useState("");
  const [pendingImageUploading, setPendingImageUploading] = React.useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  const [showSettings, setShowSettings] = React.useState(false);
  const [settingsFlows, setSettingsFlows] = React.useState<string[]>(meta.flows ?? []);
  const [settingsShowWhenStatus, setSettingsShowWhenStatus] = React.useState<string[]>(meta.showWhenStatus ?? []);
  const [settingsInsurerIds, setSettingsInsurerIds] = React.useState<number[]>(meta.insurerPolicyIds ?? []);
  const [settingsLineKey, setSettingsLineKey] = React.useState(meta.accountingLineKey ?? "");
  const [settingsDesc, setSettingsDesc] = React.useState(meta.description ?? "");
  const [settingsRepeatableSlots, setSettingsRepeatableSlots] = React.useState<string>(
    meta.repeatableSlots ? String(meta.repeatableSlots) : String(DEFAULT_REPEATABLE_SLOTS),
  );
  const [settingsSaving, setSettingsSaving] = React.useState(false);

  // Parsed + clamped slot count used by the picker. Empty/invalid input
  // falls back to the default so the editor never shows zero slots.
  const effectiveRepeatableSlots = React.useMemo(() => {
    const parsed = Number(settingsRepeatableSlots);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REPEATABLE_SLOTS;
    return Math.max(1, Math.min(20, Math.floor(parsed)));
  }, [settingsRepeatableSlots]);

  const [availableFlows, setAvailableFlows] = React.useState<{ label: string; value: string }[]>([]);
  const [availableStatuses, setAvailableStatuses] = React.useState<{ label: string; value: string }[]>([]);
  const [availableOrgs, setAvailableOrgs] = React.useState<{ id: number; name: string }[]>([]);

  // Load package section templates dynamically from form_options. Each
  // package configured under `/admin/policy-settings/<pkg>/fields` becomes
  // an entry in the "Add Section" picker, with its admin-configured fields
  // plus any synthetic computed fields (Display Name, Primary ID, …).
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pkgRes = await fetch("/api/form-options?groupKey=packages", { cache: "no-store" });
        if (!pkgRes.ok) return;
        const pkgData = (await pkgRes.json()) as OptionRow[];
        const packages = (Array.isArray(pkgData) ? pkgData : [])
          .map((p) => ({ label: String(p.label ?? ""), value: String(p.value ?? "") }))
          .filter((p) => p.value);
        if (packages.length === 0) {
          if (!cancelled) setPackageSectionTemplates([]);
          return;
        }
        const fieldsByPkg = await Promise.all(
          packages.map(async (p) => {
            try {
              const fr = await fetch(
                `/api/form-options?groupKey=${encodeURIComponent(`${p.value}_fields`)}`,
                { cache: "no-store" },
              );
              if (!fr.ok) return [];
              const fd = (await fr.json()) as OptionRow[];
              return (Array.isArray(fd) ? fd : []).flatMap((f): DynamicAdminField[] => {
                const meta = (f.meta ?? null) as {
                  categories?: unknown;
                  options?: unknown;
                  repeatable?: unknown;
                  booleanChildren?: unknown;
                } | null;
                const rawCats = Array.isArray(meta?.categories) ? meta!.categories : [];
                const categories = rawCats
                  .map((c) => (typeof c === "string" ? c : ""))
                  .filter((c): c is string => c.length > 0);
                const parentValue = String(f.value ?? "");
                const parentLabel = String(f.label ?? "");
                const parentValueType =
                  typeof f.valueType === "string" ? f.valueType : undefined;

                // Read a repeatable config block (top-level or nested)
                // into the editor's child schema. Returns undefined when
                // no usable child fields are present.
                const readRepeatable = (repRaw: unknown): {
                  itemLabel?: string;
                  children: RepeatableChildSpec[];
                } | undefined => {
                  if (!repRaw) return undefined;
                  const repObj =
                    Array.isArray(repRaw)
                      ? (repRaw[0] as Record<string, unknown> | undefined)
                      : (repRaw as Record<string, unknown> | undefined);
                  if (!repObj) return undefined;
                  const itemLabelRaw = repObj.itemLabel;
                  const itemLabel =
                    typeof itemLabelRaw === "string" && itemLabelRaw.trim()
                      ? itemLabelRaw.trim()
                      : undefined;
                  const childArr = Array.isArray(repObj.fields) ? repObj.fields : [];
                  const children: RepeatableChildSpec[] = [];
                  for (const cRaw of childArr as unknown[]) {
                    const c = (cRaw ?? {}) as Record<string, unknown>;
                    const cv = String(c.value ?? "").trim();
                    if (!cv) continue;
                    const cl = String(c.label ?? "").trim() || cv;
                    const ct = typeof c.inputType === "string" ? c.inputType : undefined;
                    children.push({ label: cl, value: cv, inputType: ct });
                  }
                  if (children.length === 0) return undefined;
                  return { itemLabel, children };
                };

                // Top-level repeatable on the admin field itself.
                let repeatableChildren: RepeatableChildSpec[] | undefined;
                let repeatableItemLabel: string | undefined;
                const isRepeatable =
                  parentValueType?.toLowerCase() === "repeatable"
                  || (meta?.repeatable !== undefined && meta?.repeatable !== null);
                if (isRepeatable) {
                  const rep = readRepeatable(meta?.repeatable);
                  if (rep) {
                    repeatableChildren = rep.children;
                    repeatableItemLabel = rep.itemLabel;
                  }
                }

                const out: DynamicAdminField[] = [{
                  label: parentLabel,
                  value: parentValue,
                  valueType: parentValueType,
                  categories,
                  repeatableChildren,
                  repeatableItemLabel,
                }];

                // Nested repeatables inside `meta.booleanChildren.{true,false}[*]`.
                // The wizard names each branch child `${pkg}__${parent}__{branch}__c{idx}`.
                // When that child's `inputType` is repeatable, the snapshot
                // stores `vals["${parent}__{branch}__c{idx}"]` as an array
                // of row objects. We expose each one as a synthetic admin
                // field so the picker can expand it into indexed slot
                // entries ("Driver 1 — Last Name" → fieldKey
                // `${parent}__{branch}__c{idx}__r0__lastName`).
                const bc = (meta?.booleanChildren ?? null) as {
                  true?: unknown;
                  false?: unknown;
                } | null;
                const branches: Array<{ key: "true" | "false"; arr: unknown[] }> = [];
                if (bc) {
                  if (Array.isArray(bc.true)) branches.push({ key: "true", arr: bc.true });
                  if (Array.isArray(bc.false)) branches.push({ key: "false", arr: bc.false });
                }
                for (const branch of branches) {
                  for (let cIdx = 0; cIdx < branch.arr.length; cIdx++) {
                    const childRaw = branch.arr[cIdx] as Record<string, unknown> | undefined;
                    if (!childRaw) continue;
                    const cInputType =
                      typeof childRaw.inputType === "string"
                        ? String(childRaw.inputType).toLowerCase()
                        : "";
                    const isChildRepeatable =
                      cInputType === "repeatable"
                      || cInputType.includes("repeat")
                      || childRaw.repeatable !== undefined;
                    if (!isChildRepeatable) continue;
                    const rep = readRepeatable(childRaw.repeatable);
                    if (!rep) continue;
                    // Snapshot key = wizard form-name minus the `${pkg}__`
                    // prefix (which is stripped by the policy submit
                    // aggregator). Keep this in sync with the wizard:
                    // `${nameBase}__{branch}__c{cIdx}` where
                    // `nameBase = ${pkg}__${parentValue}`.
                    const nestedValue = `${parentValue}__${branch.key}__c${cIdx}`;
                    const childLabel = String(childRaw.label ?? "").trim();
                    // Prefix the picker label with the parent field's
                    // label so admins can tell which boolean branch this
                    // nested repeatable lives under (e.g. "Add More
                    // Drivers? — Driver 1 — Last Name").
                    const nestedDisplayLabel =
                      childLabel || rep.itemLabel || `Item ${cIdx + 1}`;
                    // Use the repeatable's own `itemLabel` (e.g. "Driver")
                    // as the per-slot picker prefix. We deliberately do
                    // NOT include the parent boolean's question text
                    // here — admins find the long form unreadable in
                    // the picker — so collisions are only possible if
                    // two repeatables in the same package share the
                    // exact same itemLabel, which admins can rename.
                    const slotItemLabel = rep.itemLabel || nestedDisplayLabel;
                    out.push({
                      label: nestedDisplayLabel,
                      value: nestedValue,
                      valueType: "repeatable",
                      categories,
                      repeatableChildren: rep.children,
                      repeatableItemLabel: slotItemLabel,
                    });
                  }
                }

                // Cascading children: collect each unique child label
                // (e.g. "Model" appearing under every Make option) as a
                // virtual variant so it can be grouped into an Auto
                // entry alongside any same-label siblings from other
                // category-scoped parents.
                const options = Array.isArray(meta?.options) ? meta!.options : [];
                const seenChildSlugs = new Set<string>();
                for (const optRaw of options) {
                  const opt = (optRaw ?? {}) as {
                    children?: unknown;
                  };
                  const children = Array.isArray(opt.children) ? opt.children : [];
                  for (const childRaw of children) {
                    const child = (childRaw ?? {}) as {
                      label?: unknown;
                      inputType?: unknown;
                    };
                    const childLabel = String(child.label ?? "").trim();
                    if (!childLabel) continue;
                    const slug = slugifyLabel(childLabel);
                    if (seenChildSlugs.has(slug)) continue;
                    seenChildSlugs.add(slug);
                    out.push({
                      label: childLabel,
                      // Synthetic value — never used as a direct snapshot
                      // key. The editor only needs it to keep entries
                      // distinct in `Map`s; the resolver uses the by-label
                      // path which finds the real per-option keys.
                      value: `__child__${parentValue}__${slug}`,
                      valueType: typeof child.inputType === "string"
                        ? child.inputType
                        : undefined,
                      categories,
                      isChildOption: true,
                    });
                  }
                }
                return out;
              });
            } catch {
              return [];
            }
          }),
        );
        if (cancelled) return;
        const templates = packages.map((p, i) =>
          buildPackageSectionTemplate(p, fieldsByPkg[i], effectiveRepeatableSlots),
        );
        setPackageSectionTemplates(templates);
      } catch {
        if (!cancelled) setPackageSectionTemplates([]);
      }
    })();
    return () => { cancelled = true; };
    // Re-runs when the admin changes "Repeatable slots" in template
    // settings so the picker immediately reflects the new slot count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRepeatableSlots]);

  // Combined templates shown in the Add Section picker. Packages first
  // (admin-configured), then built-in entity sources.
  const sectionTemplates = React.useMemo<SectionTemplate[]>(
    () => [...packageSectionTemplates, ...BUILT_IN_SECTION_TEMPLATES],
    [packageSectionTemplates],
  );

  // Repair fields added before dynamic admin field types were passed
  // through. Without this, boolean package fields were saved as plain
  // text and rendered raw values like "true" instead of a tick.
  React.useEffect(() => {
    if (sectionTemplates.length === 0) return;
    const templateFields = new Map<string, SectionField>();
    const keyFor = (
      source: PdfFieldMapping["source"],
      packageName: string | undefined,
      lineKey: string | undefined,
      fieldKey: string,
    ) => `${source}:${packageName ?? ""}:${lineKey ?? ""}:${fieldKey.toLowerCase()}`;

    sectionTemplates.forEach((tpl) => {
      tpl.fields.forEach((field) => {
        templateFields.set(
          keyFor(tpl.source, tpl.packageName, tpl.lineKey, field.fieldKey),
          field,
        );
      });
    });

    setFields((prev) => {
      let changed = false;
      const next = prev.map((field) => {
        if (field.source === "static") return field;
        const templateField = templateFields.get(
          keyFor(field.source, field.packageName, field.lineKey, field.fieldKey),
        );
        if (!templateField?.format) return field;
        const shouldApplyFormat = !field.format || field.format === "text";
        const shouldApplyBooleanDefaults =
          templateField.format === "boolean"
          && field.trueValue === undefined
          && field.falseValue === undefined;
        if (!shouldApplyFormat && !shouldApplyBooleanDefaults) return field;
        changed = true;
        return {
          ...field,
          format: shouldApplyFormat ? templateField.format : field.format,
          trueValue: shouldApplyBooleanDefaults ? templateField.trueValue : field.trueValue,
          falseValue: shouldApplyBooleanDefaults ? templateField.falseValue : field.falseValue,
          matchValue: field.matchValue ?? templateField.matchValue,
        };
      });
      return changed ? next : prev;
    });
  }, [sectionTemplates]);

  React.useEffect(() => {
    if (!showSettings) return;
    Promise.all([
      fetch("/api/form-options?groupKey=flows", { cache: "no-store" }).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch("/api/form-options?groupKey=policy_statuses", { cache: "no-store" }).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch("/api/admin/organisations", { cache: "no-store" }).then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([flowsData, statusData, orgData]) => {
      setAvailableFlows(Array.isArray(flowsData) ? flowsData.map((f: OptionRow) => ({ label: String(f.label ?? ""), value: String(f.value ?? "") })) : []);
      setAvailableStatuses(Array.isArray(statusData) ? statusData.map((s: OptionRow) => ({ label: String(s.label ?? ""), value: String(s.value ?? "") })) : []);
      setAvailableOrgs(Array.isArray(orgData) ? orgData.map((org: OrganisationRow) => ({ id: Number(org.id), name: String(org.name ?? "") })) : []);
    });
  }, [showSettings]);

  async function handleSaveSettings() {
    setSettingsSaving(true);
    try {
      const res = await fetch(`/api/pdf-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flows: settingsFlows,
          showWhenStatus: settingsShowWhenStatus,
          insurerPolicyIds: settingsInsurerIds,
          accountingLineKey: settingsLineKey || undefined,
          description: settingsDesc,
          repeatableSlots: effectiveRepeatableSlots,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Settings saved");
      setShowSettings(false);
    } catch {
      toast.error("Failed to save settings");
    }
    setSettingsSaving(false);
  }

  const savedRef = React.useRef({ fields: meta.fields ?? [], sections: meta.sections ?? [], images: meta.images ?? [], drawings: meta.drawings ?? [], checkboxes: meta.checkboxes ?? [], radioGroups: meta.radioGroups ?? [], textInputs: meta.textInputs ?? [], pages: meta.pages ?? [] });
  const isDirty = JSON.stringify(fields) !== JSON.stringify(savedRef.current.fields)
    || JSON.stringify(sections) !== JSON.stringify(savedRef.current.sections)
    || JSON.stringify(images) !== JSON.stringify(savedRef.current.images)
    || JSON.stringify(drawings) !== JSON.stringify(savedRef.current.drawings)
    || JSON.stringify(checkboxes) !== JSON.stringify(savedRef.current.checkboxes)
    || JSON.stringify(radioGroups) !== JSON.stringify(savedRef.current.radioGroups)
    || JSON.stringify(textInputs) !== JSON.stringify(savedRef.current.textInputs)
    || JSON.stringify(pages) !== JSON.stringify(savedRef.current.pages);

  const totalPageCount = pages.length;

  const pageContainerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);

  React.useEffect(() => {
    const el = pageContainerRef.current;
    if (!el) return;
    let frame = 0;
    const obs = new ResizeObserver((entries) => {
      const raw = entries[0]?.contentRect.width ?? 0;
      if (raw <= 0) return;
      const nextWidth = Math.round(raw);
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setContainerWidth((prev) => {
          if (prev === nextWidth) return prev;
          if (Math.abs(prev - nextWidth) <= 1) return prev;
          return nextWidth;
        });
      });
    });
    obs.observe(el);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      obs.disconnect();
    };
  }, []);

  const pageDims = pages?.[currentPage];
  const pdfWidth = pageDims?.width ?? 595;
  const pdfHeight = pageDims?.height ?? 842;
  const isBlankPage = pageDims?.type === "blank";

  React.useEffect(() => {
    const toLoad = images.filter((img) => img.storedName && !imageUrls[img.storedName]);
    if (toLoad.length === 0) return;
    const names = [...new Set(toLoad.map((img) => img.storedName))];
    for (const name of names) {
      fetch(`/api/pdf-templates/images/${encodeURIComponent(name)}`)
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          setImageUrls((prev) => ({ ...prev, [name]: url }));
        })
        .catch(() => {});
    }
  }, [images, imageUrls]);
  const displayWidth = containerWidth > 0 ? Math.min(containerWidth, NATURAL_PDF_WIDTH) : NATURAL_PDF_WIDTH;
  const scale = displayWidth / pdfWidth;
  const displayHeight = pdfHeight * scale;

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (multiSelectedIds.size > 0) {
        e.preventDefault();
        setFields((prev) => prev.filter((f) => !multiSelectedIds.has(f.id)));
        setMultiSelectedIds(new Set());
        setSelectedId(null);
        return;
      }
      if (selectedId) {
        e.preventDefault();
        setFields((prev) => prev.filter((f) => f.id !== selectedId));
        setSelectedId(null);
        return;
      }
      if (selectedImageId) {
        e.preventDefault();
        setImages((prev) => prev.filter((img) => img.id !== selectedImageId));
        setSelectedImageId(null);
        return;
      }
      if (selectedDrawingId) {
        e.preventDefault();
        setDrawings((prev) => prev.filter((d) => d.id !== selectedDrawingId));
        setSelectedDrawingId(null);
        setEditingDrawingId(null);
        return;
      }
      if (selectedCheckboxId) {
        e.preventDefault();
        setCheckboxes((prev) => prev.filter((c) => c.id !== selectedCheckboxId));
        setSelectedCheckboxId(null);
        setEditingCheckboxId(null);
        return;
      }
      if (selectedTextInputId) {
        e.preventDefault();
        setTextInputs((prev) => prev.filter((t) => t.id !== selectedTextInputId));
        setSelectedTextInputId(null);
        setEditingTextInputId(null);
        return;
      }
      if (selectedRadioOption) {
        e.preventDefault();
        const { groupId, optionId } = selectedRadioOption;
        setRadioGroups((prev) =>
          prev
            .map((g) =>
              g.id === groupId
                ? { ...g, options: g.options.filter((o) => o.id !== optionId) }
                : g,
            )
            // Drop empty groups (no options left).
            .filter((g) => g.options.length > 0),
        );
        setSelectedRadioOption(null);
        return;
      }
      if (multiSelectedShapeIds.size > 0) {
        e.preventDefault();
        const cbIds = new Set<string>();
        const roKeys = new Set<string>();
        multiSelectedShapeIds.forEach((k) => {
          const [kind, rest] = k.split(":");
          if (kind === "cb") cbIds.add(rest);
          else if (kind === "ro") roKeys.add(rest);
        });
        if (cbIds.size) setCheckboxes((prev) => prev.filter((c) => !cbIds.has(c.id)));
        if (roKeys.size) {
          setRadioGroups((prev) =>
            prev
              .map((g) => ({
                ...g,
                options: g.options.filter((o) => !roKeys.has(`${g.id}/${o.id}`)),
              }))
              .filter((g) => g.options.length > 0),
          );
        }
        setMultiSelectedShapeIds(new Set());
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedImageId, selectedDrawingId, selectedCheckboxId, selectedRadioOption, multiSelectedIds, multiSelectedShapeIds]);

  // Arrow-key nudging for single-selected checkboxes and radio options.
  // 1 pt per press; 10 pt when Shift is held. Does nothing when focus is
  // inside a text input so normal editing isn't interrupted.
  React.useEffect(() => {
    function onArrow(e: KeyboardEvent) {
      const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!arrows.includes(e.key)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const delta = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft")  dx = -delta;
      if (e.key === "ArrowRight") dx = +delta;
      if (e.key === "ArrowUp")    dy = +delta; // PDF y grows upward
      if (e.key === "ArrowDown")  dy = -delta;

      if (selectedCheckboxId) {
        e.preventDefault();
        setCheckboxes((prev) =>
          prev.map((c) =>
            c.id === selectedCheckboxId
              ? { ...c, x: Math.max(0, Math.round((c.x + dx) * 100) / 100), y: Math.max(0, Math.round((c.y + dy) * 100) / 100) }
              : c,
          ),
        );
        return;
      }
      if (selectedRadioOption) {
        e.preventDefault();
        const { groupId, optionId } = selectedRadioOption;
        setRadioGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? {
                  ...g,
                  options: g.options.map((o) =>
                    o.id === optionId
                      ? { ...o, x: Math.max(0, Math.round((o.x + dx) * 100) / 100), y: Math.max(0, Math.round((o.y + dy) * 100) / 100) }
                      : o,
                  ),
                }
              : g,
          ),
        );
      }
    }
    window.addEventListener("keydown", onArrow);
    return () => window.removeEventListener("keydown", onArrow);
  }, [selectedCheckboxId, selectedRadioOption]);

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  function updateField(id: string, patch: Partial<PdfFieldMapping>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function deleteField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function duplicateField(field: PdfFieldMapping) {
    const dup: PdfFieldMapping = {
      ...field,
      id: crypto.randomUUID(),
      label: `${field.label} (copy)`,
      y: field.y - 15,
    };
    setFields((prev) => [...prev, dup]);
    setSelectedId(dup.id);
  }

  function getSectionColor(sectionId?: string): string {
    if (!sectionId) return "#3b82f6";
    return sections.find((s) => s.id === sectionId)?.color ?? "#3b82f6";
  }

  function toggleSectionCollapse(sectionId: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function openSectionConfig(tpl: SectionTemplate) {
    setEditingSectionId(null);
    setSectionPickerTemplate(tpl);
    const selections: Record<string, { checked: boolean; showLabel: boolean }> = {};
    tpl.fields.forEach((f) => {
      selections[f.fieldKey] = { checked: false, showLabel: false };
    });
    setFieldSelections(selections);
    setSectionLabelColor("#6b7280");
    setSectionDataColor("#000000");
    setShowSectionPicker(false);
  }

  function openSectionEdit(sectionId: string) {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;

    const sectionFields = fields.filter((f) => f.sectionId === sectionId && f.source !== "static");
    const sample = sectionFields[0];
    const source = sample?.source;
    const samplePkg = sample?.packageName;
    const sampleLine = sample?.lineKey;

    // Match by (source, packageName, lineKey) so package sections and
    // per-line accounting sections are picked up correctly. Fall back to
    // matching by name (for empty / custom sections).
    let tpl = sectionTemplates.find((t) =>
      t.source === source
      && (t.packageName ?? undefined) === (samplePkg ?? undefined)
      && (t.lineKey ?? undefined) === (sampleLine ?? undefined),
    );
    if (!tpl) {
      tpl = sectionTemplates.find((t) => t.name === section.name);
    }
    if (!tpl) return;

    // Merge in any existing field keys that are NOT in the template — this
    // keeps backward compatibility if admin removed a field key after the
    // template was created, so the user can still see / uncheck it.
    const tplKeys = new Set(tpl.fields.map((f) => f.fieldKey));
    const sectionStaticFields = fields.filter((f) => f.sectionId === sectionId && f.source === "static");
    const extraFields: SectionField[] = [];
    sectionFields.forEach((sf) => {
      if (!tplKeys.has(sf.fieldKey)) {
        extraFields.push({
          label: sf.label || sf.fieldKey,
          fieldKey: sf.fieldKey,
          format: sf.format,
        });
        tplKeys.add(sf.fieldKey);
      }
    });
    const mergedTpl: SectionTemplate = extraFields.length > 0
      ? { ...tpl, fields: [...tpl.fields, ...extraFields] }
      : tpl;

    const existingKeys = new Set(sectionFields.map((f) => f.fieldKey));
    const labelledKeys = new Set(
      sectionStaticFields.map((f) => {
        const match = mergedTpl.fields.find((tf) => `${tf.label}:` === f.staticValue);
        return match?.fieldKey;
      }).filter(Boolean) as string[],
    );

    const selections: Record<string, { checked: boolean; showLabel: boolean }> = {};
    mergedTpl.fields.forEach((f) => {
      selections[f.fieldKey] = {
        checked: existingKeys.has(f.fieldKey),
        showLabel: labelledKeys.has(f.fieldKey),
      };
    });

    const labelField = sectionStaticFields[0];
    const dataField = sectionFields[0];
    setSectionLabelColor(labelField?.fontColor ?? "#6b7280");
    setSectionDataColor(dataField?.fontColor ?? "#000000");

    setEditingSectionId(sectionId);
    setSectionPickerTemplate(mergedTpl);
    setFieldSelections(selections);
  }

  function toggleFieldSel(fieldKey: string, prop: "checked" | "showLabel") {
    setFieldSelections((prev) => ({
      ...prev,
      [fieldKey]: { ...prev[fieldKey], [prop]: !prev[fieldKey]?.[prop] },
    }));
  }

  function buildSectionFields(
    tpl: SectionTemplate,
    sectionId: string,
    startY: number,
  ): { fields: PdfFieldMapping[]; drawings: PdfDrawing[] } {
    const startX = Math.round(pdfWidth * 0.1);
    const spacing = 18;
    const labelOffset = 120;
    const picked = tpl.fields.filter((f) => fieldSelections[f.fieldKey]?.checked);
    const result: PdfFieldMapping[] = [];
    const newDrawings: PdfDrawing[] = [];

    const headerHeight = structuredLayout ? 20 : 0;
    const effectiveStartY = startY - headerHeight;

    if (structuredLayout) {
      result.push({
        id: crypto.randomUUID(),
        label: `${tpl.name} (title)`,
        page: currentPage,
        x: startX + 5,
        y: startY - 4,
        fontSize: 11,
        fontColor: tpl.color,
        source: "static",
        fieldKey: "static",
        staticValue: tpl.name,
        sectionId,
        format: "text",
      });
    }

    picked.forEach((f, i) => {
      const yPos = effectiveStartY - i * spacing;
      const sel = fieldSelections[f.fieldKey];

      if (structuredLayout || sel?.showLabel) {
        result.push({
          id: crypto.randomUUID(),
          label: `${f.label} (label)`,
          page: currentPage,
          x: startX + (structuredLayout ? 5 : 0),
          y: yPos,
          fontSize: structuredLayout ? 9 : DEFAULT_FONT_SIZE,
          fontColor: sectionLabelColor,
          source: "static",
          fieldKey: "static",
          staticValue: `${f.label}:`,
          sectionId,
          format: "text",
        });
        result.push({
          id: crypto.randomUUID(),
          label: f.label,
          page: currentPage,
          x: startX + labelOffset,
          y: yPos,
          fontSize: structuredLayout ? 9 : DEFAULT_FONT_SIZE,
          fontColor: sectionDataColor !== "#000000" ? sectionDataColor : undefined,
          source: tpl.source,
          packageName: tpl.packageName,
          fieldKey: f.fieldKey,
          lineKey: tpl.lineKey,
          sectionId,
          format: f.format ?? "text",
          trueValue: f.trueValue,
          falseValue: f.falseValue,
          matchValue: f.matchValue,
        });
      } else {
        result.push({
          id: crypto.randomUUID(),
          label: f.label,
          page: currentPage,
          x: startX,
          y: yPos,
          fontSize: DEFAULT_FONT_SIZE,
          fontColor: sectionDataColor !== "#000000" ? sectionDataColor : undefined,
          source: tpl.source,
          packageName: tpl.packageName,
          fieldKey: f.fieldKey,
          lineKey: tpl.lineKey,
          sectionId,
          format: f.format ?? "text",
          trueValue: f.trueValue,
          falseValue: f.falseValue,
          matchValue: f.matchValue,
        });
      }
    });

    if (structuredLayout && picked.length > 0) {
      const boxHeight = headerHeight + picked.length * spacing + 8;
      const boxWidth = Math.round(pdfWidth * 0.8);
      newDrawings.push({
        id: crypto.randomUUID(),
        page: currentPage,
        x: startX,
        y: startY - boxHeight + 14,
        width: boxWidth,
        height: boxHeight,
        strokeColor: tpl.color,
        strokeWidth: 0.75,
        sectionId,
      });
    }

    return { fields: result, drawings: newDrawings };
  }

  function confirmSectionAdd() {
    if (!sectionPickerTemplate) return;
    const tpl = sectionPickerTemplate;

    if (editingSectionId) {
      const sid = editingSectionId;
      const existing = fields.filter((f) => f.sectionId === sid);
      const existingDataKeys = new Set(
        existing.filter((f) => f.source !== "static").map((f) => f.fieldKey),
      );

      const uncheckedKeys = new Set(
        tpl.fields.filter((f) => !fieldSelections[f.fieldKey]?.checked).map((f) => f.fieldKey),
      );

      const idsToRemove = new Set<string>();
      existing.forEach((ef) => {
        if (ef.source === "static") {
          const match = tpl.fields.find((tf) => `${tf.label}:` === ef.staticValue);
          if (match && uncheckedKeys.has(match.fieldKey)) idsToRemove.add(ef.id);
        } else if (uncheckedKeys.has(ef.fieldKey)) {
          idsToRemove.add(ef.id);
        }
      });

      const newlyChecked = tpl.fields.filter(
        (f) => fieldSelections[f.fieldKey]?.checked && !existingDataKeys.has(f.fieldKey),
      );

      let addedFields: PdfFieldMapping[] = [];
      if (newlyChecked.length > 0) {
        const tempSelections = { ...fieldSelections };
        tpl.fields.forEach((f) => {
          if (!newlyChecked.some((nc) => nc.fieldKey === f.fieldKey)) {
            tempSelections[f.fieldKey] = { ...tempSelections[f.fieldKey], checked: false };
          }
        });
        const origSelections = fieldSelections;
        setFieldSelections(tempSelections);
        const built = buildSectionFields(tpl, sid, Math.round(pdfHeight * 0.5));
        addedFields = built.fields;
        setFieldSelections(origSelections);

        addedFields = newlyChecked.flatMap((f, i) => {
          const yPos = Math.round(pdfHeight * 0.5) - i * 18;
          const sel = fieldSelections[f.fieldKey];
          const startX = Math.round(pdfWidth * 0.1);
          const result: PdfFieldMapping[] = [];
          if (sel?.showLabel) {
            result.push({
              id: crypto.randomUUID(),
              label: `${f.label} (label)`,
              page: currentPage,
              x: startX,
              y: yPos,
              fontSize: DEFAULT_FONT_SIZE,
              fontColor: sectionLabelColor,
              source: "static",
              fieldKey: "static",
              staticValue: `${f.label}:`,
              sectionId: sid,
              format: "text",
            });
            result.push({
              id: crypto.randomUUID(),
              label: f.label,
              page: currentPage,
              x: startX + 100,
              y: yPos,
              fontSize: DEFAULT_FONT_SIZE,
              fontColor: sectionDataColor !== "#000000" ? sectionDataColor : undefined,
              source: tpl.source,
              packageName: tpl.packageName,
              lineKey: tpl.lineKey,
              fieldKey: f.fieldKey,
              sectionId: sid,
              format: f.format ?? "text",
              trueValue: f.trueValue,
              falseValue: f.falseValue,
              matchValue: f.matchValue,
            });
          } else {
            result.push({
              id: crypto.randomUUID(),
              label: f.label,
              page: currentPage,
              x: startX,
              y: yPos,
              fontSize: DEFAULT_FONT_SIZE,
              fontColor: sectionDataColor !== "#000000" ? sectionDataColor : undefined,
              source: tpl.source,
              packageName: tpl.packageName,
              lineKey: tpl.lineKey,
              fieldKey: f.fieldKey,
              sectionId: sid,
              format: f.format ?? "text",
              trueValue: f.trueValue,
              falseValue: f.falseValue,
              matchValue: f.matchValue,
            });
          }
          return result;
        });
      }

      setFields((prev) => [...prev.filter((f) => !idsToRemove.has(f.id)), ...addedFields]);
      setEditingSectionId(null);
      setSectionPickerTemplate(null);
      return;
    }

    const sectionId = crypto.randomUUID();
    setSections((prev) => [...prev, { id: sectionId, name: tpl.name, color: tpl.color }]);
    const built = buildSectionFields(tpl, sectionId, Math.round(pdfHeight * 0.85));
    setFields((prev) => [...prev, ...built.fields]);
    if (built.drawings.length > 0) setDrawings((prev) => [...prev, ...built.drawings]);
    setSectionPickerTemplate(null);
    if (built.fields.length > 0) setSelectedId(built.fields[0].id);
  }

  function addEmptySection() {
    const usedColors = new Set(sections.map((s) => s.color));
    const nextColor = SECTION_COLORS.find((c) => !usedColors.has(c)) ?? SECTION_COLORS[sections.length % SECTION_COLORS.length];
    const newSection: PdfTemplateSection = {
      id: crypto.randomUUID(),
      name: `Section ${sections.length + 1}`,
      color: nextColor,
    };
    setSections((prev) => [...prev, newSection]);
    setRenamingSectionId(newSection.id);
    setRenameValue(newSection.name);
    setShowSectionPicker(false);
  }

  function addAnotherField() {
    const ref = selectedField;
    const newField: PdfFieldMapping = {
      id: crypto.randomUUID(),
      label: `Field ${fields.length + 1}`,
      page: currentPage,
      x: ref ? ref.x : Math.round(pdfWidth * 0.1),
      y: ref ? ref.y - 18 : Math.round(pdfHeight * 0.5),
      fontSize: ref?.fontSize ?? DEFAULT_FONT_SIZE,
      source: ref?.source ?? "policy",
      fieldKey: "",
      sectionId: ref?.sectionId,
      format: "text",
    };
    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
  }

  function renameSection(id: string, name: string) {
    if (!name.trim()) return;
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)));
    setRenamingSectionId(null);
  }

  function deleteSection(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id));
    setFields((prev) => prev.filter((f) => f.sectionId !== id));
    setDrawings((prev) => prev.filter((d) => d.sectionId !== id));
    if (selectedId && fields.find((f) => f.id === selectedId)?.sectionId === id) {
      setSelectedId(null);
    }
  }

  function cycleSectionColor(id: string) {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const idx = SECTION_COLORS.indexOf(s.color);
        return { ...s, color: SECTION_COLORS[(idx + 1) % SECTION_COLORS.length] };
      }),
    );
  }

  function addFieldAtCenter() {
    const newField: PdfFieldMapping = {
      id: crypto.randomUUID(),
      label: `Field ${fields.length + 1}`,
      page: currentPage,
      x: Math.round(pdfWidth * 0.1),
      y: Math.round(pdfHeight * 0.5),
      fontSize: DEFAULT_FONT_SIZE,
      source: "policy",
      fieldKey: "policyNumber",
      format: "text",
    };
    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
    setPlacingMode(false);
  }

  function addStaticText() {
    const newField: PdfFieldMapping = {
      id: crypto.randomUUID(),
      label: "Text",
      page: currentPage,
      x: Math.round(pdfWidth * 0.1),
      y: Math.round(pdfHeight * 0.5),
      fontSize: DEFAULT_FONT_SIZE,
      source: "static",
      fieldKey: "static",
      staticValue: "Your text here",
      format: "text",
    };
    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
  }

  function addBorder() {
    const newDrawing: PdfDrawing = {
      id: crypto.randomUUID(),
      page: currentPage,
      x: Math.round(pdfWidth * 0.1),
      y: Math.round(pdfHeight * 0.3),
      width: Math.round(pdfWidth * 0.8),
      height: Math.round(pdfHeight * 0.15),
      strokeColor: "#000000",
      strokeWidth: 0.75,
    };
    setDrawings((prev) => [...prev, newDrawing]);
    setSelectedDrawingId(newDrawing.id);
    setSelectedId(null);
    setSelectedImageId(null);
  }

  function handlePageClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const pdfX = clickX / scale;
    const pdfY = pdfHeight - clickY / scale;

    if (placingMode) {
      const newField: PdfFieldMapping = {
        id: crypto.randomUUID(),
        label: `Field ${fields.length + 1}`,
        page: currentPage,
        x: Math.round(pdfX * 100) / 100,
        y: Math.round(pdfY * 100) / 100,
        fontSize: DEFAULT_FONT_SIZE,
        source: "policy",
        fieldKey: "policyNumber",
        format: "text",
      };
      setFields((prev) => [...prev, newField]);
      setSelectedId(newField.id);
      setPlacingMode(false);
    } else {
      setSelectedId(null);
      setSelectedImageId(null);
      setSelectedDrawingId(null);
      setMultiSelectedIds(new Set());
    }
  }

  function handleFieldMouseDown(fieldId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedDrawingId(null);

    if (e.ctrlKey || e.metaKey) {
      setMultiSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(fieldId)) next.delete(fieldId);
        else next.add(fieldId);
        return next;
      });
      return;
    }

    const isGroupDrag = multiSelectedIds.has(fieldId) && multiSelectedIds.size > 1;
    const dragIds = isGroupDrag ? [...multiSelectedIds] : [fieldId];
    const startPositions = dragIds.map((id) => {
      const f = fields.find((ff) => ff.id === id);
      return { id, x: f?.x ?? 0, y: f?.y ?? 0 };
    });

    const startScreenX = e.clientX;
    const startScreenY = e.clientY;
    let dragged = false;
    setDraggingId(fieldId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startScreenX) / scale;
      const dy = (ev.clientY - startScreenY) / scale;
      if (!dragged && Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      setFields((prev) =>
        prev.map((f) => {
          const sp = startPositions.find((s) => s.id === f.id);
          if (!sp) return f;
          return {
            ...f,
            x: Math.max(0, Math.round((sp.x + dx) * 100) / 100),
            y: Math.max(0, Math.round((sp.y - dy) * 100) / 100),
          };
        }),
      );
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggingId(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleFieldDoubleClick(fieldId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedId(fieldId);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
  }

  function selectSectionFields(sectionId: string) {
    const ids = fields.filter((f) => f.sectionId === sectionId && f.page === currentPage).map((f) => f.id);
    setMultiSelectedIds(new Set(ids));
  }

  function alignFields(dir: "left" | "right" | "top" | "bottom" | "dist-v" | "dist-h") {
    const ids = [...multiSelectedIds];
    const sel = fields.filter((f) => ids.includes(f.id));
    if (sel.length < 2) return;

    switch (dir) {
      case "left": {
        const minX = Math.min(...sel.map((f) => f.x));
        setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, x: minX } : f)));
        break;
      }
      case "right": {
        const maxX = Math.max(...sel.map((f) => f.x));
        setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, x: maxX } : f)));
        break;
      }
      case "top": {
        const maxY = Math.max(...sel.map((f) => f.y));
        setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, y: maxY } : f)));
        break;
      }
      case "bottom": {
        const minY = Math.min(...sel.map((f) => f.y));
        setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, y: minY } : f)));
        break;
      }
      case "dist-v": {
        const sorted = [...sel].sort((a, b) => b.y - a.y);
        const topY = sorted[0].y;
        const bottomY = sorted[sorted.length - 1].y;
        const step = (topY - bottomY) / (sorted.length - 1);
        const updates = new Map(sorted.map((f, i) => [f.id, topY - i * step]));
        setFields((prev) =>
          prev.map((f) => {
            const newY = updates.get(f.id);
            return newY !== undefined ? { ...f, y: Math.round(newY * 100) / 100 } : f;
          }),
        );
        break;
      }
      case "dist-h": {
        const sorted = [...sel].sort((a, b) => a.x - b.x);
        const leftX = sorted[0].x;
        const rightX = sorted[sorted.length - 1].x;
        const step = (rightX - leftX) / (sorted.length - 1);
        const updates = new Map(sorted.map((f, i) => [f.id, leftX + i * step]));
        setFields((prev) =>
          prev.map((f) => {
            const newX = updates.get(f.id);
            return newX !== undefined ? { ...f, x: Math.round(newX * 100) / 100 } : f;
          }),
        );
        break;
      }
    }
  }

  function addBlankPage() {
    const newPage = { width: 595, height: 842, type: "blank" as const };
    setPages((prev) => [...prev, newPage]);
    setCurrentPage(pages.length);
  }

  function removeBlankPage(pageIndex: number) {
    if (pages[pageIndex]?.type !== "blank") return;
    setFields((prev) => prev.filter((f) => f.page !== pageIndex).map((f) => f.page > pageIndex ? { ...f, page: f.page - 1 } : f));
    setImages((prev) => prev.filter((img) => img.page !== pageIndex).map((img) => img.page > pageIndex ? { ...img, page: img.page - 1 } : img));
    setDrawings((prev) => prev.filter((d) => d.page !== pageIndex).map((d) => d.page > pageIndex ? { ...d, page: d.page - 1 } : d));
    setCheckboxes((prev) => prev.filter((c) => c.page !== pageIndex).map((c) => c.page > pageIndex ? { ...c, page: c.page - 1 } : c));
    setRadioGroups((prev) => prev.map((g) => ({
      ...g,
      options: g.options
        .filter((o) => o.page !== pageIndex)
        .map((o) => o.page > pageIndex ? { ...o, page: o.page - 1 } : o),
    })).filter((g) => g.options.length > 0));
    setPages((prev) => prev.filter((_, i) => i !== pageIndex));
    if (currentPage >= pageIndex && currentPage > 0) setCurrentPage(currentPage - 1);
  }

  function handleImageFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (PNG, JPG)");
      e.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2 MB");
      e.target.value = "";
      return;
    }
    setPendingImageFile(file);
    setPendingImageLabel(file.name.replace(/\.[^.]+$/, ""));
    setPendingImagePreview(URL.createObjectURL(file));
    setShowImageDialog(true);
    e.target.value = "";
  }

  function cancelImageDialog() {
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    setPendingImageFile(null);
    setPendingImagePreview("");
    setPendingImageLabel("");
    setShowImageDialog(false);
  }

  async function confirmImageUpload() {
    if (!pendingImageFile) return;
    setPendingImageUploading(true);
    const formData = new FormData();
    formData.append("file", pendingImageFile);
    try {
      const res = await fetch(`/api/pdf-templates/${template.id}/images`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storedName } = await res.json();
      const img = new window.Image();
      const objectUrl = pendingImagePreview;
      img.onload = () => {
        const aspect = img.naturalWidth / img.naturalHeight;
        const w = Math.min(200, pdfWidth * 0.4);
        const h = w / aspect;
        const newImage: PdfImageMapping = {
          id: crypto.randomUUID(),
          page: currentPage,
          x: Math.round(pdfWidth * 0.1),
          y: Math.round(pdfHeight * 0.5),
          width: Math.round(w),
          height: Math.round(h),
          storedName,
          label: pendingImageLabel || pendingImageFile!.name.replace(/\.[^.]+$/, ""),
        };
        setImages((prev) => [...prev, newImage]);
        setImageUrls((prev) => ({ ...prev, [storedName]: objectUrl }));
        setSelectedImageId(newImage.id);
        setSelectedId(null);
        toast.success("Image added");
      };
      img.src = objectUrl;
    } catch {
      toast.error("Failed to upload image");
    }
    setPendingImageUploading(false);
    setPendingImageFile(null);
    setPendingImagePreview("");
    setPendingImageLabel("");
    setShowImageDialog(false);
  }

  function updateImage(id: string, patch: Partial<PdfImageMapping>) {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  }

  function deleteImage(id: string) {
    setImages((prev) => prev.filter((img) => img.id !== id));
    if (selectedImageId === id) setSelectedImageId(null);
  }

  function duplicateImage(img: PdfImageMapping) {
    const dup: PdfImageMapping = { ...img, id: crypto.randomUUID(), label: `${img.label ?? "Image"} (copy)`, y: img.y - 20 };
    setImages((prev) => [...prev, dup]);
    setSelectedImageId(dup.id);
  }

  function handleImageMouseDown(imageId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedImageId(imageId);
    setSelectedId(null);
    setSelectedDrawingId(null);
    const img = images.find((i) => i.id === imageId);
    if (!img) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = img.x;
    const origY = img.y;
    setDraggingImageId(imageId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      setImages((prev) =>
        prev.map((i) =>
          i.id === imageId
            ? { ...i, x: Math.max(0, Math.round((origX + dx) * 100) / 100), y: Math.max(0, Math.round((origY - dy) * 100) / 100) }
            : i,
        ),
      );
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggingImageId(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const selectedImage = images.find((img) => img.id === selectedImageId) ?? null;
  function updateDrawing(id: string, patch: Partial<PdfDrawing>) {
    setDrawings((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function handleDrawingMouseDown(drawingId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedDrawingId(drawingId);
    setSelectedId(null);
    setSelectedImageId(null);

    const d = drawings.find((dr) => dr.id === drawingId);
    if (!d) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = d.x;
    const origY = d.y;

    const sectionId = d.sectionId;
    const sectionFields = sectionId ? fields.filter((f) => f.sectionId === sectionId) : [];
    const fieldStarts = sectionFields.map((f) => ({ id: f.id, x: f.x, y: f.y }));

    const sectionImages = sectionId ? images.filter((img) => img.sectionId === sectionId) : [];
    const imageStarts = sectionImages.map((img) => ({ id: img.id, x: img.x, y: img.y }));

    let dragged = false;
    setDraggingDrawingId(drawingId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (!dragged && Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      const newX = Math.max(0, Math.round((origX + dx) * 100) / 100);
      const newY = Math.max(0, Math.round((origY - dy) * 100) / 100);
      const deltaX = newX - origX;
      const deltaY = newY - origY;

      setDrawings((prev) =>
        prev.map((dr) => (dr.id === drawingId ? { ...dr, x: newX, y: newY } : dr)),
      );

      if (fieldStarts.length > 0) {
        setFields((prev) =>
          prev.map((f) => {
            const fs = fieldStarts.find((s) => s.id === f.id);
            if (!fs) return f;
            return {
              ...f,
              x: Math.max(0, Math.round((fs.x + deltaX) * 100) / 100),
              y: Math.max(0, Math.round((fs.y + deltaY) * 100) / 100),
            };
          }),
        );
      }

      if (imageStarts.length > 0) {
        setImages((prev) =>
          prev.map((img) => {
            const is = imageStarts.find((s) => s.id === img.id);
            if (!is) return img;
            return {
              ...img,
              x: Math.max(0, Math.round((is.x + deltaX) * 100) / 100),
              y: Math.max(0, Math.round((is.y + deltaY) * 100) / 100),
            };
          }),
        );
      }
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggingDrawingId(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function updateCheckbox(id: string, patch: Partial<PdfCheckbox>) {
    setCheckboxes((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addCheckbox() {
    const newCheckbox: PdfCheckbox = {
      id: crypto.randomUUID(),
      page: currentPage,
      x: Math.round(pdfWidth * 0.1),
      y: Math.round(pdfHeight * 0.5),
      width: 12,
      height: 12,
      defaultChecked: false,
      borderless: true,
    };
    setCheckboxes((prev) => [...prev, newCheckbox]);
    setSelectedCheckboxId(newCheckbox.id);
    setSelectedId(null);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
  }

  function handleCheckboxMouseDown(checkboxId: string, e: React.MouseEvent) {
    e.stopPropagation();

    const shapeKey = `cb:${checkboxId}`;

    // Shift-click toggles the shape multi-select set; we don't start
    // a drag in this case so the user can build up a selection.
    if (e.shiftKey) {
      toggleShapeMultiSelect(shapeKey, true);
      setSelectedCheckboxId(checkboxId);
      setSelectedId(null);
      setSelectedImageId(null);
      setSelectedDrawingId(null);
      setSelectedRadioOption(null);
      return;
    }

    setSelectedCheckboxId(checkboxId);
    setSelectedId(null);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
    setSelectedRadioOption(null);

    const c = checkboxes.find((cb) => cb.id === checkboxId);
    if (!c) return;

    // Group-drag when this checkbox is part of an existing multi-selection.
    const isGroupDrag = multiSelectedShapeIds.has(shapeKey) && multiSelectedShapeIds.size > 1;
    const dragKeys = isGroupDrag ? [...multiSelectedShapeIds] : [shapeKey];

    const startX = e.clientX;
    const startY = e.clientY;
    const origPositions = collectShapePositions(dragKeys);

    setDraggingCheckboxId(checkboxId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      applyShapeTranslation(origPositions, dx, dy);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggingCheckboxId(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ---------- Fillable text input helpers ----------

  function addTextInput() {
    const newInput: PdfTextInput = {
      id: crypto.randomUUID(),
      page: currentPage,
      x: Math.round(pdfWidth * 0.1),
      y: Math.round(pdfHeight * 0.5),
      width: 120,
      height: 18,
      defaultValue: "",
      label: `Input ${textInputs.length + 1}`,
      fontSize: 10,
      multiline: false,
    };
    setTextInputs((prev) => [...prev, newInput]);
    setSelectedTextInputId(newInput.id);
    setSelectedId(null);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
    setSelectedCheckboxId(null);
    setSelectedRadioOption(null);
  }

  function updateTextInput(id: string, patch: Partial<PdfTextInput>) {
    setTextInputs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function handleTextInputMouseDown(inputId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedTextInputId(inputId);
    setSelectedId(null);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
    setSelectedCheckboxId(null);
    setSelectedRadioOption(null);

    const t = textInputs.find((ti) => ti.id === inputId);
    if (!t) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = t.x;
    const origY = t.y;
    setDraggingTextInputId(inputId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = -(ev.clientY - startY) / scale;
      setTextInputs((prev) =>
        prev.map((ti) =>
          ti.id === inputId
            ? { ...ti, x: Math.round((origX + dx) * 100) / 100, y: Math.round((origY + dy) * 100) / 100 }
            : ti,
        ),
      );
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggingTextInputId(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleTextInputResize(inputId: string, edge: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const t = textInputs.find((ti) => ti.id === inputId);
    if (!t) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = t.x, origY = t.y, origW = t.width, origH = t.height;
    setResizingTextInputId(inputId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = -(ev.clientY - startY) / scale;
      let nx = origX, ny = origY, nw = origW, nh = origH;
      if (edge.includes("e")) nw = Math.max(20, origW + dx);
      if (edge.includes("w")) { nw = Math.max(20, origW - dx); nx = origX + (origW - nw); }
      if (edge.includes("s")) { nh = Math.max(10, origH - dy); ny = origY + (origH - nh); }
      if (edge.includes("n")) nh = Math.max(10, origH + dy);
      setTextInputs((prev) =>
        prev.map((ti) =>
          ti.id === inputId
            ? { ...ti, x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100, width: Math.round(nw * 100) / 100, height: Math.round(nh * 100) / 100 }
            : ti,
        ),
      );
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizingTextInputId(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleCheckboxResize(checkboxId: string, edge: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    const c = checkboxes.find((cb) => cb.id === checkboxId);
    if (!c) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = c.x;
    const origY = c.y;
    const origW = c.width;
    const origH = c.height;
    setResizingCheckboxId(checkboxId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = -(ev.clientY - startY) / scale;
      let nx = origX, ny = origY, nw = origW, nh = origH;

      if (edge.includes("e")) { nw = Math.max(6, origW + dx); }
      if (edge.includes("w")) { nw = Math.max(6, origW - dx); nx = origX + (origW - nw); }
      if (edge.includes("s")) { nh = Math.max(6, origH - dy); ny = origY + (origH - nh); }
      if (edge.includes("n")) { nh = Math.max(6, origH + dy); }

      setCheckboxes((prev) =>
        prev.map((cb) =>
          cb.id === checkboxId
            ? { ...cb, x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100, width: Math.round(nw * 100) / 100, height: Math.round(nh * 100) / 100 }
            : cb,
        ),
      );
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizingCheckboxId(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ---------- Radio group (Yes/No selection) helpers ----------

  function updateRadioGroup(groupId: string, patch: Partial<PdfRadioGroup>) {
    setRadioGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));
  }

  function updateRadioOption(groupId: string, optionId: string, patch: Partial<PdfRadioOption>) {
    setRadioGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, options: g.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)) }
          : g,
      ),
    );
  }

  // Generate a stable, sanitized field-name for a new radio group based
  // on its label, falling back to a counter to keep the document unique.
  function nextRadioGroupName(label: string): string {
    const base = (label || "selection")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "selection";
    const taken = new Set(radioGroups.map((g) => g.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  function addYesNoSelection() {
    const id = crypto.randomUUID();
    const baseX = Math.round(pdfWidth * 0.1);
    const baseY = Math.round(pdfHeight * 0.5);
    const newGroup: PdfRadioGroup = {
      id,
      name: nextRadioGroupName("selection"),
      label: "Yes/No selection",
      defaultValue: "",
      borderless: true,
      options: [
        {
          id: crypto.randomUUID(),
          value: "yes",
          label: "Yes",
          page: currentPage,
          x: baseX,
          y: baseY,
          width: 12,
          height: 12,
        },
        {
          id: crypto.randomUUID(),
          value: "no",
          label: "No",
          page: currentPage,
          x: baseX + 60,
          y: baseY,
          width: 12,
          height: 12,
        },
      ],
    };
    setRadioGroups((prev) => [...prev, newGroup]);
    setSelectedRadioOption({ groupId: id, optionId: newGroup.options[0].id });
    setSelectedId(null);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
    setSelectedCheckboxId(null);
  }

  function handleRadioOptionMouseDown(groupId: string, optionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedRadioOption({ groupId, optionId });
    setSelectedId(null);
    setSelectedImageId(null);
    setSelectedDrawingId(null);
    setSelectedCheckboxId(null);

    const group = radioGroups.find((g) => g.id === groupId);
    const opt = group?.options.find((o) => o.id === optionId);
    if (!opt) return;

    // Group-drag: when this option is part of a multi-shape selection
    // (with at least one other shape selected), drag the entire group.
    const shapeKey = `ro:${groupId}/${optionId}`;
    const isGroupDrag = multiSelectedShapeIds.has(shapeKey) && multiSelectedShapeIds.size > 1;
    const dragKeys = isGroupDrag ? [...multiSelectedShapeIds] : [shapeKey];

    const startX = e.clientX;
    const startY = e.clientY;
    const origPositions = collectShapePositions(dragKeys);

    setDraggingRadioOption({ groupId, optionId });

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      applyShapeTranslation(origPositions, dx, dy);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraggingRadioOption(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleRadioOptionResize(groupId: string, optionId: string, edge: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    const group = radioGroups.find((g) => g.id === groupId);
    const opt = group?.options.find((o) => o.id === optionId);
    if (!opt) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = opt.x, origY = opt.y, origW = opt.width, origH = opt.height;
    setResizingRadioOption({ groupId, optionId });

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = -(ev.clientY - startY) / scale;
      let nx = origX, ny = origY, nw = origW, nh = origH;
      if (edge.includes("e")) { nw = Math.max(6, origW + dx); }
      if (edge.includes("w")) { nw = Math.max(6, origW - dx); nx = origX + (origW - nw); }
      if (edge.includes("s")) { nh = Math.max(6, origH - dy); ny = origY + (origH - nh); }
      if (edge.includes("n")) { nh = Math.max(6, origH + dy); }
      updateRadioOption(groupId, optionId, {
        x: Math.round(nx * 100) / 100,
        y: Math.round(ny * 100) / 100,
        width: Math.round(nw * 100) / 100,
        height: Math.round(nh * 100) / 100,
      });
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizingRadioOption(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ---------- Shape multi-select & alignment ----------

  // Snapshot positions for a list of shape keys (cb:ID or ro:GROUP/OPT)
  // so we can translate them all together during a group drag.
  function collectShapePositions(keys: string[]): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    for (const k of keys) {
      const [kind, rest] = k.split(":");
      if (kind === "cb") {
        const cb = checkboxes.find((c) => c.id === rest);
        if (cb) out.set(k, { x: cb.x, y: cb.y });
      } else if (kind === "ro") {
        const [gId, oId] = rest.split("/");
        const opt = radioGroups.find((g) => g.id === gId)?.options.find((o) => o.id === oId);
        if (opt) out.set(k, { x: opt.x, y: opt.y });
      }
    }
    return out;
  }

  function applyShapeTranslation(orig: Map<string, { x: number; y: number }>, dx: number, dy: number) {
    if (orig.size === 0) return;
    setCheckboxes((prev) =>
      prev.map((cb) => {
        const o = orig.get(`cb:${cb.id}`);
        if (!o) return cb;
        return {
          ...cb,
          x: Math.max(0, Math.round((o.x + dx) * 100) / 100),
          y: Math.max(0, Math.round((o.y - dy) * 100) / 100),
        };
      }),
    );
    setRadioGroups((prev) =>
      prev.map((g) => ({
        ...g,
        options: g.options.map((opt) => {
          const o = orig.get(`ro:${g.id}/${opt.id}`);
          if (!o) return opt;
          return {
            ...opt,
            x: Math.max(0, Math.round((o.x + dx) * 100) / 100),
            y: Math.max(0, Math.round((o.y - dy) * 100) / 100),
          };
        }),
      })),
    );
  }

  // Toggle a shape into the multi-select on Shift-click (and also
  // includes the original click target).
  function toggleShapeMultiSelect(shapeKey: string, additive: boolean) {
    setMultiSelectedShapeIds((prev) => {
      const next = new Set(prev);
      if (!additive) {
        next.clear();
        next.add(shapeKey);
        return next;
      }
      if (next.has(shapeKey)) next.delete(shapeKey);
      else next.add(shapeKey);
      return next;
    });
  }

  // Rect representation for a shape — used by alignment + bounds math.
  type ShapeRect = { key: string; x: number; y: number; width: number; height: number };

  function getShapeRect(key: string): ShapeRect | null {
    const [kind, rest] = key.split(":");
    if (kind === "cb") {
      const cb = checkboxes.find((c) => c.id === rest);
      return cb ? { key, x: cb.x, y: cb.y, width: cb.width, height: cb.height } : null;
    }
    if (kind === "ro") {
      const [gId, oId] = rest.split("/");
      const opt = radioGroups.find((g) => g.id === gId)?.options.find((o) => o.id === oId);
      return opt ? { key, x: opt.x, y: opt.y, width: opt.width, height: opt.height } : null;
    }
    return null;
  }

  function setShapeXY(key: string, x?: number, y?: number) {
    const [kind, rest] = key.split(":");
    if (kind === "cb") {
      setCheckboxes((prev) =>
        prev.map((cb) =>
          cb.id === rest
            ? { ...cb, x: x !== undefined ? Math.round(x * 100) / 100 : cb.x, y: y !== undefined ? Math.round(y * 100) / 100 : cb.y }
            : cb,
        ),
      );
    } else if (kind === "ro") {
      const [gId, oId] = rest.split("/");
      setRadioGroups((prev) =>
        prev.map((g) =>
          g.id === gId
            ? {
                ...g,
                options: g.options.map((o) =>
                  o.id === oId
                    ? { ...o, x: x !== undefined ? Math.round(x * 100) / 100 : o.x, y: y !== undefined ? Math.round(y * 100) / 100 : o.y }
                    : o,
                ),
              }
            : g,
        ),
      );
    }
  }

  function alignShapes(dir: "left" | "right" | "top" | "bottom" | "dist-h" | "dist-v") {
    const keys = [...multiSelectedShapeIds];
    const rects = keys.map((k) => getShapeRect(k)).filter((r): r is ShapeRect => !!r);
    if (rects.length < 2) return;

    switch (dir) {
      case "left": {
        const minX = Math.min(...rects.map((r) => r.x));
        rects.forEach((r) => setShapeXY(r.key, minX, undefined));
        break;
      }
      case "right": {
        // Align right edges (x + width).
        const maxRight = Math.max(...rects.map((r) => r.x + r.width));
        rects.forEach((r) => setShapeXY(r.key, maxRight - r.width, undefined));
        break;
      }
      case "top": {
        // PDF y grows upward, so "top" = highest y+height.
        const maxTop = Math.max(...rects.map((r) => r.y + r.height));
        rects.forEach((r) => setShapeXY(r.key, undefined, maxTop - r.height));
        break;
      }
      case "bottom": {
        const minY = Math.min(...rects.map((r) => r.y));
        rects.forEach((r) => setShapeXY(r.key, undefined, minY));
        break;
      }
      case "dist-h": {
        const sorted = [...rects].sort((a, b) => a.x - b.x);
        const left = sorted[0].x;
        const right = sorted[sorted.length - 1].x;
        const step = (right - left) / (sorted.length - 1);
        sorted.forEach((r, i) => setShapeXY(r.key, left + i * step, undefined));
        break;
      }
      case "dist-v": {
        const sorted = [...rects].sort((a, b) => b.y - a.y);
        const topY = sorted[0].y;
        const bottomY = sorted[sorted.length - 1].y;
        const step = (topY - bottomY) / (sorted.length - 1);
        sorted.forEach((r, i) => setShapeXY(r.key, undefined, topY - i * step));
        break;
      }
    }
  }

  function handleDrawingResize(drawingId: string, edge: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    const d = drawings.find((dr) => dr.id === drawingId);
    if (!d) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = d.x;
    const origY = d.y;
    const origW = d.width;
    const origH = d.height;
    setResizingDrawingId(drawingId);

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / scale;
      const dy = -(ev.clientY - startY) / scale;
      let nx = origX, ny = origY, nw = origW, nh = origH;

      if (edge.includes("e")) { nw = Math.max(40, origW + dx); }
      if (edge.includes("w")) { nw = Math.max(40, origW - dx); nx = origX + (origW - nw); }
      if (edge.includes("s")) { nh = Math.max(20, origH - dy); ny = origY + (origH - nh); }
      if (edge.includes("n")) { nh = Math.max(20, origH + dy); }

      setDrawings((prev) =>
        prev.map((dr) =>
          dr.id === drawingId
            ? { ...dr, x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100, width: Math.round(nw * 100) / 100, height: Math.round(nh * 100) / 100 }
            : dr,
        ),
      );
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizingDrawingId(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  React.useEffect(() => {
    if (!showPolicyPicker) return;
    let cancelled = false;
    const run = async () => {
      setPolicySearching(true);
      try {
        const params = new URLSearchParams({ limit: "10" });
        if (policySearch.trim()) params.set("policyNumber", policySearch.trim());
        const res = await fetch(`/api/policies?${params}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          const rows = (Array.isArray(data) ? data : data.rows ?? []).slice(0, 10);
          setPolicyResults(rows.map((r: Record<string, unknown>) => ({
            id: Number(r.policyId ?? r.id),
            policyNumber: String(r.policyNumber ?? ""),
          })));
        }
      } catch { /* ignore */ }
      if (!cancelled) setPolicySearching(false);
    };
    const timer = setTimeout(run, policySearch.trim() ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [policySearch, showPolicyPicker]);

  async function resolvePreview(pid: number) {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/pdf-templates/${template.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: pid, fields }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewValues(data.values ?? {});
        setPreviewPolicyNumber(data.policyNumber ?? "");
      }
    } catch { /* ignore */ }
    setPreviewLoading(false);
  }

  function linkPolicy(pid: number, policyNumber: string) {
    setPreviewPolicyId(pid);
    setPreviewPolicyNumber(policyNumber);
    setShowPolicyPicker(false);
    setPolicySearch("");
    resolvePreview(pid);
  }

  function unlinkPolicy() {
    setPreviewPolicyId(null);
    setPreviewPolicyNumber("");
    setPreviewValues({});
  }

  React.useEffect(() => {
    if (previewPolicyId && fields.length > 0) {
      const timer = setTimeout(() => resolvePreview(previewPolicyId), 500);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.length]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/pdf-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, sections, images, drawings, checkboxes, radioGroups, textInputs, pages }),
      });
      if (!res.ok) throw new Error("Save failed");
      savedRef.current = { fields, sections, images, drawings, checkboxes, radioGroups, textInputs, pages };
      toast.success("Fields saved");
    } catch {
      toast.error("Failed to save");
    }
    setSaving(false);
  }

  async function handleValidateFields() {
    if (fields.length === 0) {
      toast.error("No fields to validate — add fields first");
      return;
    }
    setValidatingFields(true);
    setValidationResult(null);
    try {
      const payload = fields
        .filter((f) => f.source !== "static")
        .map((f) => ({
          id: f.id,
          source: f.source,
          fieldKey: f.fieldKey,
          packageName: f.packageName,
          format: f.format,
        }));
      if (payload.length === 0) {
        toast.info("All fields are static — nothing to validate");
        setValidatingFields(false);
        return;
      }
      const reqBody: Record<string, unknown> = { fields: payload, templateType: "pdf" };
      if (previewPolicyId) reqBody.policyId = previewPolicyId;
      const res = await fetch("/api/admin/validate-template-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Validation failed");
      const data = await res.json();
      setValidationResult(data);
      const msg = data.okCount === data.totalFields
        ? `All ${data.totalFields} fields resolved against ${data.policyNumber}`
        : `${data.okCount}/${data.totalFields} fields resolved against ${data.policyNumber}`;
      if (data.okCount === data.totalFields) toast.success(msg);
      else toast.info(msg);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Validation failed");
    } finally {
      setValidatingFields(false);
    }
  }

  const validationMap = React.useMemo(() => {
    if (!validationResult) return new Map<string, "ok" | "optional">();
    return new Map(validationResult.results.map((r) => [r.id, r.status]));
  }, [validationResult]);

  const pageFields = React.useMemo(
    () => fields.filter((f) => f.page === currentPage),
    [fields, currentPage],
  );
  const pageImages = React.useMemo(
    () => images.filter((img) => img.page === currentPage),
    [images, currentPage],
  );

  return (
    <div className="space-y-3">
      {/* Toolbar row 1: navigation + name + settings/save */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onClose} className="gap-1 shrink-0">
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium block truncate">{template.label}</span>
        </div>
        {previewPolicyId ? (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="secondary" onClick={() => resolvePreview(previewPolicyId)} className="gap-1.5" disabled={previewLoading}>
              {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline text-xs font-mono">{previewPolicyNumber}</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={unlinkPolicy} className="h-7 w-7 p-0" title="Unlink preview policy">
              <EyeOff className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setShowPolicyPicker(true)} className="gap-1.5 shrink-0">
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Preview Data</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleValidateFields}
          disabled={validatingFields || fields.length === 0}
          className="gap-1.5 shrink-0"
          title="Validate all fields against a sample policy"
        >
          {validatingFields ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Validate</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowSettings(true)} className="gap-1.5 shrink-0" title="Template Settings">
          <Settings2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
        <Button
          size="sm"
          variant={isDirty ? "default" : "outline"}
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5 shrink-0"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{saving ? "Saving..." : isDirty ? "Save *" : "Save"}</span>
          {isDirty && <span className="sm:hidden w-1.5 h-1.5 rounded-full bg-white" />}
        </Button>
      </div>

      {/* Validation result banner */}
      {validationResult && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            <strong>{validationResult.policyNumber}</strong>
            {" — "}<span className="font-medium">{validationResult.okCount} resolved</span>
            {validationResult.optionalCount > 0 && (
              <span className="text-blue-600 dark:text-blue-400">, {validationResult.optionalCount} empty for this policy</span>
            )}
          </span>
          <button onClick={() => setValidationResult(null)} className="shrink-0 hover:opacity-70">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Toolbar row 2: editing actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={addFieldAtCenter} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add Field</span>
        </Button>
        <Button size="sm" variant="outline" onClick={addStaticText} className="gap-1.5">
          <Type className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add Text</span>
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowImageDialog(true)}>
          <ImagePlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add Image</span>
        </Button>
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/jpg" className="hidden" onChange={handleImageFileSelect} />
        <Button size="sm" variant="outline" onClick={addBorder} className="gap-1.5">
          <Square className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add Border</span>
        </Button>
        <Button size="sm" variant="outline" onClick={addCheckbox} className="gap-1.5" title="Add a fillable checkbox the recipient can tick">
          <CheckSquare className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add Checkbox</span>
        </Button>
        <Button size="sm" variant="outline" onClick={addYesNoSelection} className="gap-1.5" title="Add a Yes/No selection (radio group) — recipient picks one">
          <CircleDot className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add Yes/No</span>
        </Button>
        <Button size="sm" variant="outline" onClick={addTextInput} className="gap-1.5" title="Add a fillable text input the recipient can type into">
          <TextCursorInput className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add Input</span>
        </Button>
        <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-700 hidden sm:block" />
        <Button
          size="sm"
          variant={placingMode ? "default" : "ghost"}
          onClick={() => setPlacingMode(!placingMode)}
          className="gap-1.5"
        >
          <Crosshair className={`h-3.5 w-3.5 ${placingMode ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline">{placingMode ? "Cancel" : "Place on PDF"}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={addBlankPage} className="gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Blank Page</span>
        </Button>
      </div>

      {/* Page navigation */}
      {totalPageCount > 1 && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="text-neutral-500 dark:text-neutral-400">Page:</span>
          {Array.from({ length: totalPageCount }, (_, i) => {
            const isBlank = pages[i]?.type === "blank";
            return (
              <div key={i} className="flex items-center gap-0.5">
                <Button
                  size="xs"
                  variant={currentPage === i ? "default" : "outline"}
                  onClick={() => setCurrentPage(i)}
                  className={isBlank ? "border-dashed" : ""}
                >
                  {i + 1}{isBlank ? " ○" : ""}
                </Button>
                {isBlank && currentPage === i && (
                  <Button size="xs" variant="ghost" className="h-5 w-5 p-0 text-red-500 dark:text-red-400" onClick={() => removeBlankPage(i)} title="Remove blank page">
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* PDF Preview with field overlays */}
      <div ref={pageContainerRef}>
        <div
          className={`relative border border-neutral-300 dark:border-neutral-700 rounded-md overflow-hidden bg-neutral-100 dark:bg-neutral-800 mx-auto ${
            placingMode ? "cursor-crosshair" : ""
          }`}
          style={{ width: displayWidth, height: displayHeight }}
          onMouseDown={(e) => {
            // Only fire from the canvas background — child overlays call
            // stopPropagation so clicks on them never reach here.
            if (placingMode) return;
            if (e.button !== 0) return; // left button only
            setCtxMenu(null);

            const rect = e.currentTarget.getBoundingClientRect();
            const x0 = e.clientX - rect.left;
            const y0 = e.clientY - rect.top;
            setDragSel({ x0, y0, x1: x0, y1: y0 });

            function onMove(ev: MouseEvent) {
              setDragSel({ x0, y0, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top });
            }

            function onUp(ev: MouseEvent) {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);

              const x1 = ev.clientX - rect.left;
              const y1 = ev.clientY - rect.top;
              setDragSel(null);

              const wasDrag = Math.abs(x1 - x0) > 6 || Math.abs(y1 - y0) > 6;

              if (!wasDrag) {
                // Plain click on background — clear all selections.
                setSelectedId(null);
                setSelectedImageId(null);
                setSelectedDrawingId(null);
                setSelectedCheckboxId(null);
                setSelectedRadioOption(null);
                setMultiSelectedIds(new Set());
                setMultiSelectedShapeIds(new Set());
                return;
              }

              // Rubber-band: select every checkbox / radio option whose
              // screen rect overlaps the drawn rectangle.
              const selLeft   = Math.min(x0, x1);
              const selRight  = Math.max(x0, x1);
              const selTop    = Math.min(y0, y1);
              const selBottom = Math.max(y0, y1);

              const hits = new Set<string>();

              checkboxes.filter((c) => c.page === currentPage).forEach((c) => {
                const sx = c.x * scale;
                const sy = (pdfHeight - c.y - c.height) * scale;
                const sw = c.width * scale;
                const sh = c.height * scale;
                if (sx + sw >= selLeft && sx <= selRight && sy + sh >= selTop && sy <= selBottom) {
                  hits.add(`cb:${c.id}`);
                }
              });

              radioGroups.forEach((g) => {
                g.options.filter((o) => o.page === currentPage).forEach((o) => {
                  const sx = o.x * scale;
                  const sy = (pdfHeight - o.y - o.height) * scale;
                  const sw = o.width * scale;
                  const sh = o.height * scale;
                  if (sx + sw >= selLeft && sx <= selRight && sy + sh >= selTop && sy <= selBottom) {
                    hits.add(`ro:${g.id}/${o.id}`);
                  }
                });
              });

              setMultiSelectedShapeIds(hits);

              // If only one shape was caught, also set it as the primary
              // selection so arrow-key nudge works immediately.
              if (hits.size === 1) {
                const [key] = hits;
                const [kind, rest] = key.split(":");
                if (kind === "cb") setSelectedCheckboxId(rest);
                else if (kind === "ro") {
                  const [gId, oId] = rest.split("/");
                  setSelectedRadioOption({ groupId: gId, optionId: oId });
                }
              }
            }

            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        >
          <PdfPageBackground
            pdfUrl={pdfUrl}
            isBlankPage={isBlankPage}
            currentPage={currentPage}
            displayWidth={displayWidth}
          />

          {/* Transparent overlay to capture clicks in placing mode */}
          {placingMode && (
            <div
              className="absolute inset-0 z-30 cursor-crosshair"
              onClick={handlePageClick}
            >
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs px-3 py-1 rounded-full shadow-lg pointer-events-none animate-pulse">
                Click anywhere on the PDF to place a field
              </div>
            </div>
          )}

          {/* Rubber-band selection rectangle */}
          {dragSel && (() => {
            const left   = Math.min(dragSel.x0, dragSel.x1);
            const top    = Math.min(dragSel.y0, dragSel.y1);
            const width  = Math.abs(dragSel.x1 - dragSel.x0);
            const height = Math.abs(dragSel.y1 - dragSel.y0);
            return (
              <div
                className="absolute pointer-events-none z-20 border-2 border-blue-500 bg-blue-400/10 rounded-sm"
                style={{ left, top, width, height }}
              />
            );
          })()}

          {/* Drawing overlays (borders/rectangles) */}
          {drawings.filter((d) => d.page === currentPage).map((d) => {
            const screenX = d.x * scale;
            const screenY = (pdfHeight - d.y - d.height) * scale;
            const dW = d.width * scale;
            const dH = d.height * scale;
            const isSel = d.id === selectedDrawingId;
            const isDrag = d.id === draggingDrawingId;
            const isResize = d.id === resizingDrawingId;
            const strokeColor = d.strokeColor ?? "#000";
            return (
              <div
                key={d.id}
                className={`absolute z-8 select-none ${isSel || isDrag ? "ring-2 ring-blue-500" : "hover:ring-1 hover:ring-blue-300"}`}
                style={{
                  left: screenX,
                  top: screenY,
                  width: dW,
                  height: dH,
                  border: `${Math.max((d.strokeWidth ?? 0.75) * scale, 1)}px solid ${strokeColor}`,
                  borderRadius: 2,
                  cursor: isDrag ? "grabbing" : "grab",
                }}
                onMouseDown={(e) => handleDrawingMouseDown(d.id, e)}
                onDoubleClick={(e) => { e.stopPropagation(); setEditingDrawingId(d.id); }}
              >
                {(isSel || isDrag || isResize) && (
                  <>
                    {/* Resize handles */}
                    {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => {
                      const isVert = edge === "n" || edge === "s";
                      const isHoriz = edge === "e" || edge === "w";
                      const cursor = isVert ? "ns-resize" : isHoriz ? "ew-resize" : (edge === "ne" || edge === "sw") ? "nesw-resize" : "nwse-resize";
                      const pos: React.CSSProperties = {};
                      if (edge.includes("n")) pos.top = -4;
                      if (edge.includes("s")) pos.bottom = -4;
                      if (edge.includes("e")) pos.right = -4;
                      if (edge.includes("w")) pos.left = -4;
                      if (isVert) { pos.left = "50%"; pos.transform = "translateX(-50%)"; }
                      if (isHoriz) { pos.top = "50%"; pos.transform = "translateY(-50%)"; }
                      return (
                        <div
                          key={edge}
                          className="absolute w-2 h-2 bg-blue-500 border border-white rounded-sm z-10"
                          style={{ ...pos, cursor }}
                          onMouseDown={(ev) => handleDrawingResize(d.id, edge, ev)}
                        />
                      );
                    })}
                    {/* Section label */}
                    {d.sectionId && (
                      <div
                        className="absolute left-0 px-1 rounded-b text-[9px] leading-none py-0.5 whitespace-nowrap text-white pointer-events-none"
                        style={{ top: "100%", backgroundColor: strokeColor }}
                      >
                        {sections.find((s) => s.id === d.sectionId)?.name ?? "Border"}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Checkbox overlays (interactive AcroForm fields) */}
          {checkboxes.filter((c) => c.page === currentPage).map((c) => {
            const screenX = c.x * scale;
            const screenY = (pdfHeight - c.y - c.height) * scale;
            const cW = c.width * scale;
            const cH = c.height * scale;
            const isSel = c.id === selectedCheckboxId;
            const isDrag = c.id === draggingCheckboxId;
            const isResize = c.id === resizingCheckboxId;
            const isMultiSel = multiSelectedShapeIds.has(`cb:${c.id}`);
            // Editor visual: borderless boxes show a faint dashed outline
            // so the admin can still find them on the canvas — the
            // generated PDF stays truly borderless.
            const editorBorder = c.borderless
              ? `${Math.max(1, scale)}px dashed rgba(5,150,105,0.55)`
              : `${Math.max(1, scale)}px solid #059669`;
            return (
              <div
                key={c.id}
                className={`absolute z-9 select-none ${
                  isMultiSel
                    ? "ring-2 ring-emerald-600"
                    : isSel || isDrag
                    ? "ring-2 ring-emerald-500"
                    : "hover:ring-1 hover:ring-emerald-400"
                }`}
                style={{
                  left: screenX,
                  top: screenY,
                  width: cW,
                  height: cH,
                  border: editorBorder,
                  borderRadius: 2,
                  backgroundColor: c.defaultChecked ? "rgba(5,150,105,0.18)" : "rgba(5,150,105,0.04)",
                  cursor: isDrag ? "grabbing" : "grab",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: Math.max(8, Math.min(cW, cH) * 0.85),
                  color: "#059669",
                  fontWeight: 700,
                  lineHeight: 1,
                }}
                onMouseDown={(e) => handleCheckboxMouseDown(c.id, e)}
                onDoubleClick={(e) => { e.stopPropagation(); setEditingCheckboxId(c.id); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ kind: "checkbox", id: c.id, screenX: e.clientX, screenY: e.clientY }); }}
                title={c.label || (c.borderless ? "Fillable checkbox (no border in PDF)" : "Fillable checkbox (client-tickable in PDF)")}
              >
                {c.defaultChecked ? "✓" : ""}
                {(isSel || isDrag || isResize) && (
                  <>
                    {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => {
                      const isVert = edge === "n" || edge === "s";
                      const isHoriz = edge === "e" || edge === "w";
                      const cursor = isVert ? "ns-resize" : isHoriz ? "ew-resize" : (edge === "ne" || edge === "sw") ? "nesw-resize" : "nwse-resize";
                      const pos: React.CSSProperties = {};
                      if (edge.includes("n")) pos.top = -4;
                      if (edge.includes("s")) pos.bottom = -4;
                      if (edge.includes("e")) pos.right = -4;
                      if (edge.includes("w")) pos.left = -4;
                      if (isVert) { pos.left = "50%"; pos.transform = "translateX(-50%)"; }
                      if (isHoriz) { pos.top = "50%"; pos.transform = "translateY(-50%)"; }
                      return (
                        <div
                          key={edge}
                          className="absolute w-2 h-2 bg-emerald-500 border border-white rounded-sm z-10"
                          style={{ ...pos, cursor }}
                          onMouseDown={(ev) => handleCheckboxResize(c.id, edge, ev)}
                        />
                      );
                    })}
                    <div
                      className="absolute left-0 px-1 rounded-b text-[9px] leading-none py-0.5 whitespace-nowrap text-white pointer-events-none"
                      style={{ top: "100%", backgroundColor: "#059669" }}
                    >
                      {c.label || "Checkbox"}{c.borderless ? " (borderless)" : ""}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Fillable text input overlays — soft-blue rectangles that
              become real AcroForm TextField widgets in the generated PDF. */}
          {textInputs.filter((t) => t.page === currentPage).map((t) => {
            const screenX = t.x * scale;
            const screenY = (pdfHeight - t.y - t.height) * scale;
            const cW = t.width * scale;
            const cH = t.height * scale;
            const isSel = t.id === selectedTextInputId;
            const isDrag = t.id === draggingTextInputId;
            const isResize = t.id === resizingTextInputId;
            return (
              <div
                key={t.id}
                className={`absolute z-9 select-none ${
                  isSel || isDrag
                    ? "ring-2 ring-sky-500"
                    : "hover:ring-1 hover:ring-sky-400"
                }`}
                style={{
                  left: screenX,
                  top: screenY,
                  width: cW,
                  height: cH,
                  border: `${Math.max(1, scale)}px dashed rgba(14,165,233,0.6)`,
                  borderRadius: 2,
                  backgroundColor: "rgba(14,165,233,0.08)",
                  cursor: isDrag ? "grabbing" : "grab",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: Math.max(2, 4 * scale),
                  fontSize: Math.max(8, (t.fontSize ?? 10) * scale),
                  color: "#0369a1",
                  fontStyle: t.defaultValue ? "normal" : "italic",
                  fontWeight: 500,
                  lineHeight: 1,
                  overflow: "hidden",
                  whiteSpace: t.multiline ? "pre-wrap" : "nowrap",
                }}
                onMouseDown={(e) => handleTextInputMouseDown(t.id, e)}
                onDoubleClick={(e) => { e.stopPropagation(); setEditingTextInputId(t.id); }}
                title={t.label || "Fillable text input — recipient can type into this in the PDF"}
              >
                {t.defaultValue || (t.placeholder ? t.placeholder : "(fillable input)")}
                {(isSel || isDrag || isResize) && (
                  <>
                    {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => {
                      const isVert = edge === "n" || edge === "s";
                      const isHoriz = edge === "e" || edge === "w";
                      const cursor = isVert ? "ns-resize" : isHoriz ? "ew-resize" : (edge === "ne" || edge === "sw") ? "nesw-resize" : "nwse-resize";
                      const pos: React.CSSProperties = {};
                      if (edge.includes("n")) pos.top = -4;
                      if (edge.includes("s")) pos.bottom = -4;
                      if (edge.includes("e")) pos.right = -4;
                      if (edge.includes("w")) pos.left = -4;
                      if (isVert) { pos.left = "50%"; pos.transform = "translateX(-50%)"; }
                      if (isHoriz) { pos.top = "50%"; pos.transform = "translateY(-50%)"; }
                      return (
                        <div
                          key={edge}
                          className="absolute w-2 h-2 bg-sky-500 border border-white rounded-sm z-10"
                          style={{ ...pos, cursor }}
                          onMouseDown={(ev) => handleTextInputResize(t.id, edge, ev)}
                        />
                      );
                    })}
                    <div
                      className="absolute left-0 px-1 rounded-b text-[9px] leading-none py-0.5 whitespace-nowrap text-white pointer-events-none"
                      style={{ top: "100%", backgroundColor: "#0ea5e9" }}
                    >
                      {t.label || "Input"}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Radio group option overlays — each option of every group on this page */}
          {radioGroups.flatMap((g) =>
            g.options
              .filter((o) => o.page === currentPage)
              .map((o) => {
                const screenX = o.x * scale;
                const screenY = (pdfHeight - o.y - o.height) * scale;
                const oW = o.width * scale;
                const oH = o.height * scale;
                const isSel = selectedRadioOption?.groupId === g.id && selectedRadioOption?.optionId === o.id;
                const isDrag = draggingRadioOption?.groupId === g.id && draggingRadioOption?.optionId === o.id;
                const isResize = resizingRadioOption?.groupId === g.id && resizingRadioOption?.optionId === o.id;
                const isMultiSel = multiSelectedShapeIds.has(`ro:${g.id}/${o.id}`);
                const isDefault = g.defaultValue === o.value;
                const editorBorder = g.borderless
                  ? `${Math.max(1, scale)}px dashed rgba(124,58,237,0.55)`
                  : `${Math.max(1, scale)}px solid #7c3aed`;
                return (
                  <div
                    key={`${g.id}/${o.id}`}
                    className={`absolute z-9 select-none ${
                      isMultiSel
                        ? "ring-2 ring-violet-600"
                        : isSel || isDrag
                        ? "ring-2 ring-violet-500"
                        : "hover:ring-1 hover:ring-violet-400"
                    }`}
                    style={{
                      left: screenX,
                      top: screenY,
                      width: oW,
                      height: oH,
                      border: editorBorder,
                      // Render as a circle in the editor so it visually
                      // matches a radio button (vs. a checkbox square).
                      borderRadius: "50%",
                      backgroundColor: isDefault ? "rgba(124,58,237,0.18)" : "rgba(124,58,237,0.04)",
                      cursor: isDrag ? "grabbing" : "grab",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#7c3aed",
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                    onMouseDown={(e) => handleRadioOptionMouseDown(g.id, o.id, e)}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingRadioGroupId(g.id); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ kind: "radioOption", groupId: g.id, optionId: o.id, screenX: e.clientX, screenY: e.clientY }); }}
                    title={`${g.label || "Selection"} → ${o.label || o.value}${isDefault ? " (default)" : ""}${g.borderless ? " — borderless" : ""}`}
                  >
                    {isDefault ? (
                      <div
                        style={{
                          width: "55%",
                          height: "55%",
                          borderRadius: "50%",
                          backgroundColor: "#7c3aed",
                        }}
                      />
                    ) : null}
                    {(isSel || isDrag || isResize) && (
                      <>
                        {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => {
                          const isVert = edge === "n" || edge === "s";
                          const isHoriz = edge === "e" || edge === "w";
                          const cursor = isVert ? "ns-resize" : isHoriz ? "ew-resize" : (edge === "ne" || edge === "sw") ? "nesw-resize" : "nwse-resize";
                          const pos: React.CSSProperties = {};
                          if (edge.includes("n")) pos.top = -4;
                          if (edge.includes("s")) pos.bottom = -4;
                          if (edge.includes("e")) pos.right = -4;
                          if (edge.includes("w")) pos.left = -4;
                          if (isVert) { pos.left = "50%"; pos.transform = "translateX(-50%)"; }
                          if (isHoriz) { pos.top = "50%"; pos.transform = "translateY(-50%)"; }
                          return (
                            <div
                              key={edge}
                              className="absolute w-2 h-2 bg-violet-500 border border-white rounded-sm z-10"
                              style={{ ...pos, cursor }}
                              onMouseDown={(ev) => handleRadioOptionResize(g.id, o.id, edge, ev)}
                            />
                          );
                        })}
                        <div
                          className="absolute left-0 px-1 rounded-b text-[9px] leading-none py-0.5 whitespace-nowrap text-white pointer-events-none"
                          style={{ top: "100%", backgroundColor: "#7c3aed" }}
                        >
                          {(g.label || "Selection")}: {o.label || o.value}{isDefault ? " ●" : ""}
                        </div>
                      </>
                    )}
                  </div>
                );
              }),
          )}

          {/* Image overlays */}
          {pageImages.map((img) => {
            const screenX = img.x * scale;
            const screenY = (pdfHeight - img.y) * scale - img.height * scale;
            const imgW = img.width * scale;
            const imgH = img.height * scale;
            const isSel = img.id === selectedImageId;
            const isDrag = img.id === draggingImageId;

            return (
              <div
                key={img.id}
                className={`absolute z-9 select-none group ${isSel || isDrag ? "ring-2 ring-blue-500" : "ring-1 ring-transparent hover:ring-blue-300"}`}
                style={{ left: screenX, top: screenY, width: imgW, height: imgH, cursor: "move" }}
                onMouseDown={(e) => handleImageMouseDown(img.id, e)}
              >
                {imageUrls[img.storedName] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrls[img.storedName]} alt={img.label ?? "image"} className="w-full h-full object-contain pointer-events-none" />
                ) : (
                  <div className="w-full h-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-[10px] text-neutral-500">Loading...</div>
                )}
                {(isSel || isDrag) && (
                  <div className="absolute left-0 px-1 rounded-b text-[9px] leading-none py-0.5 whitespace-nowrap bg-blue-600 text-white" style={{ top: "100%" }}>
                    {img.label ?? "Image"}
                  </div>
                )}
              </div>
            );
          })}

          {/* Field markers — sized to match actual PDF output, colored by section */}
          {pageFields.map((field) => {
            const screenX = field.x * scale;
            const screenY = (pdfHeight - field.y) * scale;
            const isSelected = field.id === selectedId;
            const isDragging = field.id === draggingId;
            const isMultiSel = multiSelectedIds.has(field.id);
            const realFontPx = (field.fontSize ?? DEFAULT_FONT_SIZE) * scale;
            const fieldWidth = field.width ? field.width * scale : undefined;
            const sColor = getSectionColor(field.sectionId);

            return (
              <div
                key={field.id}
                className={`absolute select-none group ${
                  isSelected || isDragging || isMultiSel ? "z-20" : "z-10"
                }`}
                style={{
                  left: screenX,
                  top: screenY - realFontPx,
                  cursor: "move",
                  width: fieldWidth,
                  minWidth: fieldWidth ? undefined : 20,
                  outline: isMultiSel ? `2px dashed ${sColor}` : undefined,
                  outlineOffset: 1,
                }}
                onMouseDown={(e) => handleFieldMouseDown(field.id, e)}
                onDoubleClick={(e) => handleFieldDoubleClick(field.id, e)}
              >
                <div
                  className="border-b-2 whitespace-nowrap overflow-hidden"
                  style={{
                    fontSize: realFontPx,
                    lineHeight: `${realFontPx + 2}px`,
                    height: realFontPx + 4,
                    color: field.fontColor ?? "#000",
                    textAlign: field.align ?? "left",
                    borderColor: sColor,
                    backgroundColor: isSelected || isDragging || isMultiSel ? `${sColor}26` : `${sColor}1a`,
                    fontWeight: field.bold ? "bold" : undefined,
                    fontStyle: field.italic ? "italic" : undefined,
                    textDecoration: field.underline ? "underline" : undefined,
                  }}
                >
                  {previewValues[field.id] ? (
                    <span>{previewValues[field.id]}</span>
                  ) : (
                    <span className="opacity-60">{field.label || field.fieldKey}</span>
                  )}
                </div>
                <div
                  className={`absolute left-0 px-1 rounded-b text-[9px] leading-none py-0.5 whitespace-nowrap transition-opacity text-white ${
                    isSelected || isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  style={{
                    top: "100%",
                    backgroundColor: sColor,
                  }}
                >
                  {field.source === "package" ? `${field.packageName}.${field.fieldKey}` : field.source === "accounting" ? `accounting${field.lineKey ? `[${field.lineKey}]` : ""}.${field.fieldKey}` : `${field.source}.${field.fieldKey}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section-grouped field list below the PDF */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Fields on page {currentPage + 1} ({pageFields.length})
          </div>
          <div className="flex items-center gap-2">
            {fields.length > pageFields.length && (
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {fields.length} total across all pages
              </span>
            )}
            {/*
              Radix DropdownMenu renders into a Portal at <body>, so the
              picker cannot affect any ancestor's layout, scrollbar
              visibility, or ResizeObserver. Click-outside, Escape, and
              viewport-aware positioning come for free. The previous
              hand-rolled popover lived inside the editor tree and made
              the page flash continuously while it was open because its
              backdrop / absolute positioning interacted with the global
              hover-scrollbar styles in `app/globals.css`.
            */}
            <DropdownMenu open={showSectionPicker} onOpenChange={setShowSectionPicker}>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="outline" className="gap-1 text-xs">
                  <FolderPlus className="h-3 w-3" /> Add Section
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={4}
                className="w-64 max-h-96 overflow-y-auto p-0 py-1"
              >
                    {packageSectionTemplates.length > 0 && (
                      <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                        From snapshot (admin-configured)
                      </div>
                    )}
                    {packageSectionTemplates.map((tpl) => {
                      const defaultCount = tpl.fields.filter((f) => f.defaultOn).length;
                      const key = `${tpl.source}:${tpl.packageName ?? ""}:${tpl.lineKey ?? ""}:${tpl.name}`;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => openSectionConfig(tpl)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                        >
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tpl.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{tpl.name}</div>
                            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">{tpl.fields.length} fields ({defaultCount} default)</div>
                          </div>
                        </button>
                      );
                    })}
                    {packageSectionTemplates.length > 0 && (
                      <div className="border-t border-neutral-200 dark:border-neutral-800 my-1" />
                    )}
                    <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                      Built-in
                    </div>
                    {BUILT_IN_SECTION_TEMPLATES.map((tpl) => {
                      const defaultCount = tpl.fields.filter((f) => f.defaultOn).length;
                      const key = `${tpl.source}:${tpl.lineKey ?? ""}:${tpl.name}`;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => openSectionConfig(tpl)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                        >
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tpl.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{tpl.name}</div>
                            <div className="text-[10px] text-neutral-400 dark:text-neutral-500">{tpl.fields.length} fields ({defaultCount} default)</div>
                          </div>
                        </button>
                      );
                    })}
                    <div className="border-t border-neutral-200 dark:border-neutral-800 my-1" />
                    <button
                      type="button"
                      onClick={addEmptySection}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Custom Section (empty)</span>
                    </button>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {multiSelectedIds.size >= 2 && (
          <div className="flex items-center gap-1 flex-wrap rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-2 py-1.5">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300 mr-1">{multiSelectedIds.size} selected</span>
            <div className="flex items-center gap-0.5">
              <Button size="xs" variant="outline" onClick={() => alignFields("left")} className="text-[10px] h-6 px-1.5" title="Align left edges">⫷ Left</Button>
              <Button size="xs" variant="outline" onClick={() => alignFields("right")} className="text-[10px] h-6 px-1.5" title="Align right edges">Right ⫸</Button>
              <Button size="xs" variant="outline" onClick={() => alignFields("top")} className="text-[10px] h-6 px-1.5" title="Align top edges">⏶ Top</Button>
              <Button size="xs" variant="outline" onClick={() => alignFields("bottom")} className="text-[10px] h-6 px-1.5" title="Align bottom edges">⏷ Bot</Button>
              <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
              <Button size="xs" variant="outline" onClick={() => alignFields("dist-h")} className="text-[10px] h-6 px-1.5" title="Distribute horizontally">↔ Space H</Button>
              <Button size="xs" variant="outline" onClick={() => alignFields("dist-v")} className="text-[10px] h-6 px-1.5" title="Distribute vertically">↕ Space V</Button>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setMultiSelectedIds(new Set())} className="text-[10px] h-6 px-1.5 ml-auto text-neutral-500">Clear</Button>
          </div>
        )}

        {multiSelectedShapeIds.size >= 2 && (
          <div className="flex items-center gap-1 flex-wrap rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mr-1">{multiSelectedShapeIds.size} shapes selected</span>
            <div className="flex items-center gap-0.5">
              <Button size="xs" variant="outline" onClick={() => alignShapes("left")} className="text-[10px] h-6 px-1.5" title="Align left edges">⫷ Left</Button>
              <Button size="xs" variant="outline" onClick={() => alignShapes("right")} className="text-[10px] h-6 px-1.5" title="Align right edges">Right ⫸</Button>
              <Button size="xs" variant="outline" onClick={() => alignShapes("top")} className="text-[10px] h-6 px-1.5" title="Align top edges">⏶ Top</Button>
              <Button size="xs" variant="outline" onClick={() => alignShapes("bottom")} className="text-[10px] h-6 px-1.5" title="Align bottom edges">⏷ Bot</Button>
              <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
              <Button size="xs" variant="outline" onClick={() => alignShapes("dist-h")} className="text-[10px] h-6 px-1.5" title="Distribute horizontally">↔ Space H</Button>
              <Button size="xs" variant="outline" onClick={() => alignShapes("dist-v")} className="text-[10px] h-6 px-1.5" title="Distribute vertically">↕ Space V</Button>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setMultiSelectedShapeIds(new Set())} className="text-[10px] h-6 px-1.5 ml-auto text-neutral-500">Clear</Button>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto space-y-1 border rounded-md p-1.5 border-neutral-200 dark:border-neutral-800">
          {pageFields.length === 0 && sections.length === 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center py-3">
              No fields. Click &quot;Add Field&quot; then click on the PDF.
            </p>
          )}

          {/* Render each section */}
          {sections.map((section) => {
            const sectionFields = pageFields.filter((f) => f.sectionId === section.id);
            const isCollapsed = collapsedSections.has(section.id);
            const isRenaming = renamingSectionId === section.id;

            return (
              <div key={section.id} className="rounded border border-neutral-200 dark:border-neutral-800">
                {/* Section header */}
                <div
                  className="flex items-center gap-1.5 px-2 py-1.5 bg-neutral-50 dark:bg-neutral-900 rounded-t cursor-pointer select-none"
                  onClick={() => !isRenaming && toggleSectionCollapse(section.id)}
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: section.color }} />
                  {isCollapsed ? <ChevronRight className="h-3 w-3 text-neutral-400" /> : <ChevronDown className="h-3 w-3 text-neutral-400" />}

                  {isRenaming ? (
                    <form
                      className="flex items-center gap-1 flex-1 min-w-0"
                      onSubmit={(e) => { e.preventDefault(); renameSection(section.id, renameValue); }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-5 text-xs flex-1"
                        autoFocus
                        onBlur={() => renameSection(section.id, renameValue)}
                      />
                      <button type="submit" className="p-0.5 text-green-600 dark:text-green-400 hover:opacity-80">
                        <Check className="h-3 w-3" />
                      </button>
                      <button type="button" className="p-0.5 text-neutral-400 hover:opacity-80" onClick={() => setRenamingSectionId(null)}>
                        <X className="h-3 w-3" />
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 flex-1 truncate">
                      {section.name}
                    </span>
                  )}

                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">{sectionFields.length}</span>

                  {!isRenaming && (
                    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950 text-neutral-400 dark:text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400"
                        onClick={() => selectSectionFields(section.id)}
                        title="Select all fields in section"
                      >
                        <Crosshair className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500"
                        onClick={() => cycleSectionColor(section.id)}
                        title="Change color"
                      >
                        <div className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-600" style={{ backgroundColor: section.color }} />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500"
                        onClick={() => openSectionEdit(section.id)}
                        title="Edit section"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400"
                        onClick={() => deleteSection(section.id)}
                        title="Delete section"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Section fields */}
                {!isCollapsed && (
                  <div className="space-y-0.5 p-1">
                    {sectionFields.length === 0 && (
                      <p className="text-[10px] text-neutral-400 dark:text-neutral-500 text-center py-1.5">
                        No fields in this section on this page
                      </p>
                    )}
                    {sectionFields.map((f) => (
                      <FieldListItem
                        key={f.id}
                        field={f}
                        isSelected={f.id === selectedId}
                        isMultiSelected={multiSelectedIds.has(f.id)}
                        sectionColor={section.color}
                        validationStatus={validationMap.get(f.id)}
                        onSelect={() => { setSelectedId(f.id); setSelectedImageId(null); setSelectedDrawingId(null); }}
                        onCtrlClick={() => setMultiSelectedIds((prev) => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped fields */}
          {(() => {
            const ungrouped = pageFields.filter((f) => !f.sectionId || !sections.some((s) => s.id === f.sectionId));
            if (ungrouped.length === 0 && sections.length > 0) return null;
            if (ungrouped.length === 0 && sections.length === 0) return null;
            return (
              <div className={sections.length > 0 ? "pt-1" : ""}>
                {sections.length > 0 && (
                  <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium px-1 pb-0.5">
                    Ungrouped ({ungrouped.length})
                  </div>
                )}
                <div className="space-y-0.5">
                  {ungrouped.map((f) => (
                    <FieldListItem
                      key={f.id}
                      field={f}
                      isSelected={f.id === selectedId}
                      isMultiSelected={multiSelectedIds.has(f.id)}
                      validationStatus={validationMap.get(f.id)}
                      onSelect={() => { setSelectedId(f.id); setSelectedImageId(null); setSelectedDrawingId(null); }}
                      onCtrlClick={() => setMultiSelectedIds((prev) => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                    />
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Images on this page */}
      {pageImages.length > 0 && (
        <div className="space-y-1">
          <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Images on page {currentPage + 1} ({pageImages.length})
          </div>
          <div className="max-h-36 overflow-y-auto space-y-0.5 border rounded-md p-1.5 border-neutral-200 dark:border-neutral-800">
            {pageImages.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => { setSelectedImageId(img.id); setSelectedId(null); setSelectedDrawingId(null); }}
                className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  img.id === selectedImageId
                    ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300"
                }`}
              >
                <ImagePlus className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
                <span className="truncate font-medium flex-1">{img.label ?? "Image"}</span>
                <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">{img.width}×{img.height}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Section config dialog — pick which fields to include */}
      {sectionPickerTemplate && (() => {
        const tpl = sectionPickerTemplate;
        const checkedCount = tpl.fields.filter((f) => fieldSelections[f.fieldKey]?.checked).length;
        const defaultFields = tpl.fields.filter((f) => f.defaultOn);
        const extraFields = tpl.fields.filter((f) => !f.defaultOn);

        return (
          <Dialog open onOpenChange={(open) => { if (!open) { setSectionPickerTemplate(null); setEditingSectionId(null); } }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tpl.color }} />
                    {editingSectionId ? `Edit Section: ${tpl.name}` : `Add Section: ${tpl.name}`}
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => {
                        const s: Record<string, { checked: boolean; showLabel: boolean }> = {};
                        tpl.fields.forEach((f) => { s[f.fieldKey] = { ...fieldSelections[f.fieldKey], checked: true }; });
                        setFieldSelections(s);
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => {
                        const s: Record<string, { checked: boolean; showLabel: boolean }> = {};
                        tpl.fields.forEach((f) => { s[f.fieldKey] = { ...fieldSelections[f.fieldKey], checked: false }; });
                        setFieldSelections(s);
                      }}
                    >
                      Deselect All
                    </button>
                  </div>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{checkedCount} / {tpl.fields.length} selected</span>
                </div>

                {!editingSectionId && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={structuredLayout}
                      onChange={(e) => setStructuredLayout(e.target.checked)}
                      className="rounded border-neutral-300 dark:border-neutral-600 h-3.5 w-3.5"
                    />
                    <span className="text-sm text-neutral-700 dark:text-neutral-300">Bordered layout</span>
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500">(like Policy Details)</span>
                  </label>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-neutral-600 dark:text-neutral-400">Label color</label>
                    <input
                      type="color"
                      value={sectionLabelColor}
                      onChange={(e) => setSectionLabelColor(e.target.value)}
                      className="h-6 w-7 rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                    />
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">{sectionLabelColor}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-neutral-600 dark:text-neutral-400">Data color</label>
                    <input
                      type="color"
                      value={sectionDataColor}
                      onChange={(e) => setSectionDataColor(e.target.value)}
                      className="h-6 w-7 rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                    />
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">{sectionDataColor}</span>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto border rounded-md border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
                  {defaultFields.map((f) => (
                    <SectionFieldRow
                      key={f.fieldKey}
                      field={f}
                      selection={fieldSelections[f.fieldKey]}
                      onToggle={toggleFieldSel}
                    />
                  ))}

                  {extraFields.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 bg-neutral-50 dark:bg-neutral-900 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">
                        More fields
                      </div>
                      {extraFields.map((f) => (
                        <SectionFieldRow
                          key={f.fieldKey}
                          field={f}
                          selection={fieldSelections[f.fieldKey]}
                          onToggle={toggleFieldSel}
                        />
                      ))}
                    </>
                  )}
                </div>

                <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
                  Check &quot;Label&quot; to also add a static text label next to the value field on the PDF.
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setSectionPickerTemplate(null); setEditingSectionId(null); }}>Cancel</Button>
                <Button onClick={confirmSectionAdd} disabled={checkedCount === 0}>
                  {editingSectionId ? `Update Section (${checkedCount})` : `Add ${checkedCount} Field${checkedCount !== 1 ? "s" : ""} to PDF`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Policy picker dialog for live preview */}
      <Dialog open={showPolicyPicker} onOpenChange={setShowPolicyPicker}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Link Policy for Preview</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Choose an existing policy to preview real data on the template. This is for design preview only and does not affect generation.
          </p>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input
              value={policySearch}
              onChange={(e) => setPolicySearch(e.target.value)}
              placeholder="Search by policy number..."
              className="pl-8"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto border rounded-md border-neutral-200 dark:border-neutral-800">
            {policySearching && (
              <div className="flex items-center justify-center py-4 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching...
              </div>
            )}
            {!policySearching && policyResults.length === 0 && policySearch.trim() && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center py-4">No policies found</p>
            )}
            {!policySearching && policyResults.length === 0 && !policySearch.trim() && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 text-center py-4">Type a policy number to search</p>
            )}
            {policyResults.map((p, idx) => (
              <button
                key={`${p.id}-${idx}`}
                type="button"
                onClick={() => linkPolicy(p.id, p.policyNumber)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 border-b last:border-b-0 border-neutral-100 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300"
              >
                <span className="font-mono font-medium">{p.policyNumber}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPolicyPicker(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image upload dialog */}
      <Dialog open={showImageDialog} onOpenChange={(open) => { if (!open) cancelImageDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Image</DialogTitle>
          </DialogHeader>

          {!pendingImageFile ? (
            <div
              className="rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors"
              onClick={() => imageInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  if (!file.type.startsWith("image/")) { toast.error("Please select an image file (PNG, JPG)"); return; }
                  if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2 MB"); return; }
                  setPendingImageFile(file);
                  setPendingImageLabel(file.name.replace(/\.[^.]+$/, ""));
                  setPendingImagePreview(URL.createObjectURL(file));
                }
              }}
            >
              <div className="w-12 h-12 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
                <ImagePlus className="h-6 w-6 text-neutral-400 dark:text-neutral-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Click to choose a file or drag & drop
                </p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
                  PNG or JPG, max 2 MB
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-4 flex flex-col items-center gap-3">
                {pendingImagePreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pendingImagePreview} alt="Preview" className="max-h-52 max-w-full object-contain rounded" />
                )}
                <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>{pendingImageFile.name}</span>
                  <span className="text-neutral-300 dark:text-neutral-600">|</span>
                  <span>{(pendingImageFile.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
                      setPendingImageFile(null);
                      setPendingImagePreview("");
                      setPendingImageLabel("");
                    }}
                    className="ml-1 text-neutral-400 hover:text-red-500 transition-colors"
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Label</Label>
                <Input
                  value={pendingImageLabel}
                  onChange={(e) => setPendingImageLabel(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="Image label"
                />
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={cancelImageDialog} disabled={pendingImageUploading}>
              Cancel
            </Button>
            <Button onClick={confirmImageUpload} disabled={pendingImageUploading || !pendingImageFile} className="gap-1.5">
              {pendingImageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {pendingImageUploading ? "Uploading..." : "Insert Image"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Right-side drawer for field editing — only mounted when a field is selected */}
      {selectedField && (
        <SlideDrawer
          open
          onClose={() => setSelectedId(null)}
          title={`Edit: ${selectedField.label || selectedField.fieldKey}`}
          side="right"
          widthClass="w-[300px] sm:w-[340px]"
        >
          <div className="overflow-y-auto p-3 space-y-3 h-full overscroll-contain">
            {/* Quick actions */}
            <div className="flex gap-1">
              <Button
                size="xs"
                variant="outline"
                className="gap-1 text-xs flex-1"
                onClick={addAnotherField}
              >
                <Plus className="h-3 w-3" /> New
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="gap-1 text-xs flex-1"
                onClick={() => duplicateField(selectedField)}
              >
                <Copy className="h-3 w-3" /> Duplicate
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="gap-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                onClick={() => deleteField(selectedField.id)}
              >
                <Trash2 className="h-3 w-3" /> Delete
              </Button>
            </div>

            <div>
              <Label className="text-xs">Label</Label>
              <Input
                value={selectedField.label}
                onChange={(e) => updateField(selectedField.id, { label: e.target.value })}
                className="h-7 text-xs"
              />
            </div>

            {sections.length > 0 && (
              <div>
                <Label className="text-xs">Section</Label>
                <select
                  value={selectedField.sectionId ?? ""}
                  onChange={(e) =>
                    updateField(selectedField.id, {
                      sectionId: e.target.value || undefined,
                    })
                  }
                  className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
                >
                  <option value="">Ungrouped</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label className="text-xs">Data Source</Label>
              <select
                value={selectedField.source}
                onChange={(e) =>
                  updateField(selectedField.id, {
                    source: e.target.value as PdfFieldMapping["source"],
                    fieldKey: "",
                    packageName: undefined,
                    lineKey: undefined,
                  })
                }
                className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
              >
                {DATA_SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                {DATA_SOURCE_OPTIONS.find((o) => o.value === selectedField.source)?.description}
              </p>
            </div>

            {selectedField.source === "package" && (
              <div>
                <Label className="text-xs">Package Name</Label>
                <Input
                  value={selectedField.packageName ?? ""}
                  onChange={(e) => updateField(selectedField.id, { packageName: e.target.value })}
                  placeholder="e.g. vehicleinfo, policyinfo"
                  className="h-7 text-xs"
                />
              </div>
            )}

            {selectedField.source === "accounting" && (
              <div>
                <Label className="text-xs">Line Key</Label>
                <Input
                  value={selectedField.lineKey ?? ""}
                  onChange={(e) => updateField(selectedField.id, { lineKey: e.target.value })}
                  placeholder="e.g. tpo, own_vehicle_damage, main"
                  className="h-7 text-xs"
                />
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                  Which accounting section to pull from. Leave empty for the first/only line.
                </p>
              </div>
            )}

            {selectedField.source === "static" ? (
              <div>
                <Label className="text-xs">Static Value</Label>
                <Input
                  value={selectedField.staticValue ?? ""}
                  onChange={(e) => updateField(selectedField.id, { staticValue: e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
            ) : (
              <div>
                <Label className="text-xs">Field Key</Label>
                <Input
                  value={selectedField.fieldKey}
                  onChange={(e) => updateField(selectedField.id, { fieldKey: e.target.value })}
                  placeholder="e.g. fullName"
                  className="h-7 text-xs"
                  list={`hints-${selectedField.id}`}
                />
                {FIELD_KEY_HINTS[selectedField.source]?.length > 0 && (
                  <>
                    <datalist id={`hints-${selectedField.id}`}>
                      {FIELD_KEY_HINTS[selectedField.source].map((h) => (
                        <option key={h} value={h} />
                      ))}
                    </datalist>
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                      Suggestions: {FIELD_KEY_HINTS[selectedField.source].slice(0, 5).join(", ")}
                      {FIELD_KEY_HINTS[selectedField.source].length > 5 ? ", ..." : ""}
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Position &amp; Size</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">X (pts)</Label>
                  <Input
                    type="number"
                    value={selectedField.x}
                    onChange={(e) => updateField(selectedField.id, { x: Number(e.target.value) || 0 })}
                    className="h-7 text-xs"
                    step={0.5}
                  />
                </div>
                <div>
                  <Label className="text-xs">Y (pts)</Label>
                  <Input
                    type="number"
                    value={selectedField.y}
                    onChange={(e) => updateField(selectedField.id, { y: Number(e.target.value) || 0 })}
                    className="h-7 text-xs"
                    step={0.5}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <Label className="text-xs">Max Width (pts)</Label>
                  <Input
                    type="number"
                    value={selectedField.width ?? ""}
                    onChange={(e) => updateField(selectedField.id, { width: e.target.value ? Number(e.target.value) : undefined })}
                    className="h-7 text-xs"
                    placeholder="auto"
                  />
                </div>
                <div>
                  <Label className="text-xs">Align</Label>
                  <select
                    value={selectedField.align ?? "left"}
                    onChange={(e) =>
                      updateField(selectedField.id, { align: e.target.value as PdfFieldMapping["align"] })
                    }
                    className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Appearance</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Font Size</Label>
                  <Input
                    type="number"
                    value={selectedField.fontSize ?? DEFAULT_FONT_SIZE}
                    onChange={(e) => updateField(selectedField.id, { fontSize: Number(e.target.value) || DEFAULT_FONT_SIZE })}
                    className="h-7 text-xs"
                    min={4}
                    max={72}
                  />
                </div>
                <div>
                  <Label className="text-xs">Font Color</Label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={selectedField.fontColor ?? "#000000"}
                      onChange={(e) => updateField(selectedField.id, { fontColor: e.target.value })}
                      className="h-7 w-8 rounded border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                    />
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
                      {selectedField.fontColor ?? "#000000"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <Label className="text-xs mb-1 block">Style</Label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => updateField(selectedField.id, { bold: !selectedField.bold })}
                    className={`h-7 w-8 flex items-center justify-center rounded border text-xs font-bold transition-colors ${selectedField.bold ? "bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 border-neutral-800 dark:border-neutral-200" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                    title="Bold"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => updateField(selectedField.id, { italic: !selectedField.italic })}
                    className={`h-7 w-8 flex items-center justify-center rounded border text-xs italic transition-colors ${selectedField.italic ? "bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 border-neutral-800 dark:border-neutral-200" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                    title="Italic"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    onClick={() => updateField(selectedField.id, { underline: !selectedField.underline })}
                    className={`h-7 w-8 flex items-center justify-center rounded border text-xs underline transition-colors ${selectedField.underline ? "bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 border-neutral-800 dark:border-neutral-200" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                    title="Underline"
                  >
                    U
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Formatting</div>
              <div>
                <Label className="text-xs">Format</Label>
                <select
                  value={selectedField.format ?? "text"}
                  onChange={(e) =>
                    updateField(selectedField.id, {
                      format: e.target.value as PdfFieldMapping["format"],
                    })
                  }
                  className="w-full h-7 text-xs rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 dark:text-neutral-100 px-2"
                >
                  {FORMAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {selectedField.format === "currency" && (
                <div className="mt-2">
                  <Label className="text-xs">Currency Code</Label>
                  <Input
                    value={selectedField.currencyCode ?? "HKD"}
                    onChange={(e) => updateField(selectedField.id, { currencyCode: e.target.value })}
                    className="h-7 text-xs"
                    placeholder="HKD"
                  />
                </div>
              )}

              {selectedField.format === "boolean" && (
                <div className="mt-2 space-y-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Render text
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                      onClick={() => updateField(selectedField.id, { trueValue: "Yes", falseValue: "No" })}
                      title="Default — show 'Yes' or 'No'"
                    >
                      Yes / No
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                      onClick={() => updateField(selectedField.id, { trueValue: "✓", falseValue: "" })}
                      title="Show ✓ when true, blank when false (use inside the Yes box)"
                    >
                      ✓ / blank
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                      onClick={() => updateField(selectedField.id, { trueValue: "", falseValue: "✓" })}
                      title="Show ✓ when false, blank when true (use inside the No box)"
                    >
                      blank / ✓
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                      onClick={() => updateField(selectedField.id, { trueValue: "✓", falseValue: "✗" })}
                      title="Show ✓ when true, ✗ when false"
                    >
                      ✓ / ✗
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                      onClick={() => updateField(selectedField.id, { trueValue: "是", falseValue: "否" })}
                      title="Show 是 / 否"
                    >
                      是 / 否
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">When true</Label>
                      <Input
                        value={selectedField.trueValue ?? ""}
                        onChange={(e) => updateField(selectedField.id, { trueValue: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="Yes"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">When false</Label>
                      <Input
                        value={selectedField.falseValue ?? ""}
                        onChange={(e) => updateField(selectedField.id, { falseValue: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="No"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-neutral-400 dark:text-neutral-500 leading-snug">
                    Tip: place two fields with the same data source — one with <span className="font-mono">✓ / blank</span> inside the Yes box and one with <span className="font-mono">blank / ✓</span> inside the No box.
                  </p>
                </div>
              )}

              {selectedField.format === "match" && (
                <div className="mt-2 space-y-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Match value (case-insensitive)
                  </div>
                  <Input
                    value={selectedField.matchValue ?? ""}
                    onChange={(e) => updateField(selectedField.id, { matchValue: e.target.value })}
                    className="h-7 text-xs"
                    placeholder="e.g. Transportation"
                  />
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                      onClick={() => updateField(selectedField.id, { trueValue: "✓", falseValue: "" })}
                      title="Show ✓ when value matches, blank otherwise"
                    >
                      ✓ / blank
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                      onClick={() => updateField(selectedField.id, { trueValue: "✓", falseValue: "✗" })}
                      title="Show ✓ when matches, ✗ otherwise"
                    >
                      ✓ / ✗
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
                      onClick={() => updateField(selectedField.id, { trueValue: "●", falseValue: "○" })}
                      title="Show ● when matches, ○ otherwise"
                    >
                      ● / ○
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">When matches</Label>
                      <Input
                        value={selectedField.trueValue ?? ""}
                        onChange={(e) => updateField(selectedField.id, { trueValue: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="✓"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Otherwise</Label>
                      <Input
                        value={selectedField.falseValue ?? ""}
                        onChange={(e) => updateField(selectedField.id, { falseValue: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="(blank)"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-neutral-400 dark:text-neutral-500 leading-snug">
                    Place one field per option (e.g. Transportation, Seafood, Vegetables). Each compares the same snapshot value to a different match string and ticks its own box.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <Label className="text-xs">Prefix</Label>
                  <Input
                    value={selectedField.prefix ?? ""}
                    onChange={(e) => updateField(selectedField.id, { prefix: e.target.value })}
                    className="h-7 text-xs"
                    placeholder="e.g. $"
                  />
                </div>
                <div>
                  <Label className="text-xs">Suffix</Label>
                  <Input
                    value={selectedField.suffix ?? ""}
                    onChange={(e) => updateField(selectedField.id, { suffix: e.target.value })}
                    className="h-7 text-xs"
                    placeholder="e.g. %"
                  />
                </div>
              </div>
            </div>

            {/* Save button pinned at bottom of drawer */}
            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 pb-1">
              <Button
                size="sm"
                className="w-full gap-1.5"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save All Fields"}
              </Button>
            </div>
          </div>
        </SlideDrawer>
      )}

      {/* Drawing editing drawer — opens on double-click */}
      {(() => {
        const ed = editingDrawingId ? drawings.find((d) => d.id === editingDrawingId) : null;
        if (!ed || selectedImage) return null;
        return (
        <SlideDrawer
          open
          onClose={() => setEditingDrawingId(null)}
          title={`Border: ${sections.find((s) => s.id === ed.sectionId)?.name ?? "Rectangle"}`}
          side="right"
          widthClass="w-[300px] sm:w-[340px]"
        >
          <div className="overflow-y-auto p-3 space-y-3 h-full overscroll-contain">
            <div className="flex gap-1">
              <Button size="xs" variant="outline" className="gap-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => { setDrawings((prev) => prev.filter((dd) => dd.id !== ed.id)); setSelectedDrawingId(null); setEditingDrawingId(null); }}>
                <Trash2 className="h-3 w-3" /> Delete Border
              </Button>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Position</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">X (pts)</Label>
                  <Input type="number" value={ed.x} onChange={(e) => updateDrawing(ed.id, { x: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                </div>
                <div>
                  <Label className="text-xs">Y (pts)</Label>
                  <Input type="number" value={ed.y} onChange={(e) => updateDrawing(ed.id, { y: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Size</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Width (pts)</Label>
                  <Input type="number" value={ed.width} onChange={(e) => updateDrawing(ed.id, { width: Math.max(10, Number(e.target.value) || 10) })} className="h-7 text-xs" min={10} />
                </div>
                <div>
                  <Label className="text-xs">Height (pts)</Label>
                  <Input type="number" value={ed.height} onChange={(e) => updateDrawing(ed.id, { height: Math.max(10, Number(e.target.value) || 10) })} className="h-7 text-xs" min={10} />
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Appearance</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Stroke Color</Label>
                  <div className="flex items-center gap-1">
                    <input type="color" value={ed.strokeColor ?? "#000000"} onChange={(e) => updateDrawing(ed.id, { strokeColor: e.target.value })} className="w-6 h-6 rounded border border-neutral-300 cursor-pointer" />
                    <Input value={ed.strokeColor ?? "#000000"} onChange={(e) => updateDrawing(ed.id, { strokeColor: e.target.value })} className="h-7 text-xs flex-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Stroke Width</Label>
                  <Input type="number" value={ed.strokeWidth ?? 0.75} onChange={(e) => updateDrawing(ed.id, { strokeWidth: Math.max(0.25, Number(e.target.value) || 0.75) })} className="h-7 text-xs" min={0.25} step={0.25} />
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 pb-1">
              <Button size="sm" className="w-full gap-1.5" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save All"}
              </Button>
            </div>
          </div>
        </SlideDrawer>
        );
      })()}

      {/* Checkbox editing drawer — opens on double-click */}
      {(() => {
        const ec = editingCheckboxId ? checkboxes.find((c) => c.id === editingCheckboxId) : null;
        if (!ec || selectedImage) return null;
        return (
          <SlideDrawer
            open
            onClose={() => setEditingCheckboxId(null)}
            title={`Checkbox: ${ec.label || "Untitled"}`}
            side="right"
            widthClass="w-[300px] sm:w-[340px]"
          >
            <div className="overflow-y-auto p-3 space-y-3 h-full overscroll-contain">
              <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300 leading-snug">
                Renders as a real fillable form field — the recipient can click it in any PDF viewer (Adobe, Edge, Chrome, in-app preview) to tick or untick.
              </div>

              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => {
                    setCheckboxes((prev) => prev.filter((cc) => cc.id !== ec.id));
                    setSelectedCheckboxId(null);
                    setEditingCheckboxId(null);
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Delete Checkbox
                </Button>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <Label className="text-xs">Label (editor only)</Label>
                <Input
                  value={ec.label ?? ""}
                  onChange={(e) => updateCheckbox(ec.id, { label: e.target.value })}
                  placeholder="e.g. I agree to the terms"
                  className="h-7 text-xs"
                />
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Shown beside the box while editing. Not printed in the generated PDF.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!ec.defaultChecked}
                    onChange={(e) => updateCheckbox(ec.id, { defaultChecked: e.target.checked })}
                    className="h-3.5 w-3.5 accent-emerald-600"
                  />
                  <span>Pre-tick by default</span>
                </label>
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  When on, the box is ticked when the PDF is generated. The recipient can still untick it.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!ec.borderless}
                    onChange={(e) => updateCheckbox(ec.id, { borderless: e.target.checked })}
                    className="h-3.5 w-3.5 accent-emerald-600"
                  />
                  <span>No border in PDF</span>
                </label>
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Hides the box outline so it sits cleanly inside a checkbox already printed on the underlying PDF. The click area still works in any viewer.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Position</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">X (pts)</Label>
                    <Input type="number" value={ec.x} onChange={(e) => updateCheckbox(ec.id, { x: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                  </div>
                  <div>
                    <Label className="text-xs">Y (pts)</Label>
                    <Input type="number" value={ec.y} onChange={(e) => updateCheckbox(ec.id, { y: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                  </div>
                </div>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Size</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Width (pts)</Label>
                    <Input type="number" value={ec.width} onChange={(e) => updateCheckbox(ec.id, { width: Math.max(6, Number(e.target.value) || 6) })} className="h-7 text-xs" min={6} step={0.5} />
                  </div>
                  <div>
                    <Label className="text-xs">Height (pts)</Label>
                    <Input type="number" value={ec.height} onChange={(e) => updateCheckbox(ec.id, { height: Math.max(6, Number(e.target.value) || 6) })} className="h-7 text-xs" min={6} step={0.5} />
                  </div>
                </div>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 pb-1">
                <Button size="sm" className="w-full gap-1.5" onClick={handleSave} disabled={saving}>
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : "Save All"}
                </Button>
              </div>
            </div>
          </SlideDrawer>
        );
      })()}

      {/* Text input editing drawer — opens on double-click */}
      {(() => {
        const et = editingTextInputId ? textInputs.find((t) => t.id === editingTextInputId) : null;
        if (!et || selectedImage) return null;
        return (
          <SlideDrawer
            open
            onClose={() => setEditingTextInputId(null)}
            title={`Input: ${et.label || "Untitled"}`}
            side="right"
            widthClass="w-[300px] sm:w-[340px]"
          >
            <div className="overflow-y-auto p-3 space-y-3 h-full overscroll-contain">
              <div className="rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-2 py-1.5 text-[11px] text-sky-700 dark:text-sky-300 leading-snug">
                Renders as a real fillable text field — the recipient can click and type into it in any PDF viewer (Adobe, Edge, Chrome, in-app preview).
              </div>

              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => {
                    setTextInputs((prev) => prev.filter((tt) => tt.id !== et.id));
                    setSelectedTextInputId(null);
                    setEditingTextInputId(null);
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Delete Input
                </Button>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <Label className="text-xs">Label (editor only)</Label>
                <Input
                  value={et.label ?? ""}
                  onChange={(e) => updateTextInput(et.id, { label: e.target.value })}
                  placeholder="e.g. Driver 2 Name"
                  className="h-7 text-xs"
                />
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Shown beside the box while editing. Not printed in the generated PDF.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <Label className="text-xs">Pre-filled value</Label>
                <Input
                  value={et.defaultValue ?? ""}
                  onChange={(e) => updateTextInput(et.id, { defaultValue: e.target.value })}
                  placeholder="(blank)"
                  className="h-7 text-xs"
                />
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Initial text inside the field when the PDF is generated. The recipient can overwrite it.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <Label className="text-xs">Placeholder (editor preview)</Label>
                <Input
                  value={et.placeholder ?? ""}
                  onChange={(e) => updateTextInput(et.id, { placeholder: e.target.value })}
                  placeholder="e.g. Enter driver name"
                  className="h-7 text-xs"
                />
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Hint text shown in the editor preview when the field is empty. Most PDF viewers won't display this in the generated PDF.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!et.multiline}
                    onChange={(e) => updateTextInput(et.id, { multiline: e.target.checked })}
                    className="h-3.5 w-3.5 accent-sky-600"
                  />
                  <span>Allow multi-line input</span>
                </label>
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Recipient can press Enter for a new line — useful for addresses, remarks, or longer notes.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <Label className="text-xs">Font size (pts)</Label>
                <Input
                  type="number"
                  value={et.fontSize ?? 10}
                  min={6}
                  step={0.5}
                  onChange={(e) => updateTextInput(et.id, { fontSize: Math.max(6, Number(e.target.value) || 10) })}
                  className="h-7 text-xs"
                />
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Position</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">X (pts)</Label>
                    <Input type="number" value={et.x} onChange={(e) => updateTextInput(et.id, { x: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                  </div>
                  <div>
                    <Label className="text-xs">Y (pts)</Label>
                    <Input type="number" value={et.y} onChange={(e) => updateTextInput(et.id, { y: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                  </div>
                </div>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Size</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Width (pts)</Label>
                    <Input type="number" value={et.width} onChange={(e) => updateTextInput(et.id, { width: Math.max(20, Number(e.target.value) || 20) })} className="h-7 text-xs" min={20} step={0.5} />
                  </div>
                  <div>
                    <Label className="text-xs">Height (pts)</Label>
                    <Input type="number" value={et.height} onChange={(e) => updateTextInput(et.id, { height: Math.max(10, Number(e.target.value) || 10) })} className="h-7 text-xs" min={10} step={0.5} />
                  </div>
                </div>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 pb-1">
                <Button size="sm" className="w-full gap-1.5" onClick={handleSave} disabled={saving}>
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : "Save All"}
                </Button>
              </div>
            </div>
          </SlideDrawer>
        );
      })()}

      {/* Radio group editing drawer — opens on double-click of an option */}
      {(() => {
        const eg = editingRadioGroupId ? radioGroups.find((g) => g.id === editingRadioGroupId) : null;
        if (!eg) return null;
        const otherNames = radioGroups.filter((g) => g.id !== eg.id).map((g) => g.name);
        return (
          <SlideDrawer
            open
            onClose={() => setEditingRadioGroupId(null)}
            title={`Selection: ${eg.label || eg.name || "Untitled"}`}
            side="right"
            widthClass="w-[320px] sm:w-[360px]"
          >
            <div className="overflow-y-auto p-3 space-y-3 h-full overscroll-contain">
              <div className="rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-2 py-1.5 text-[11px] text-violet-700 dark:text-violet-300 leading-snug">
                Mutually-exclusive selection. The recipient can pick exactly one option in any standard PDF viewer.
              </div>

              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  className="gap-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={async () => {
                    const ok = await import("@/components/ui/global-dialogs").then((m) => m.confirmDialog({
                      title: `Delete selection "${eg.label || eg.name}"?`,
                      description: "All options inside this group will be removed.",
                      confirmLabel: "Delete",
                      destructive: true,
                    }));
                    if (!ok) return;
                    setRadioGroups((prev) => prev.filter((g) => g.id !== eg.id));
                    setSelectedRadioOption(null);
                    setEditingRadioGroupId(null);
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Delete Selection
                </Button>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <Label className="text-xs">Label (editor only)</Label>
                <Input
                  value={eg.label ?? ""}
                  onChange={(e) => updateRadioGroup(eg.id, { label: e.target.value })}
                  placeholder="e.g. Vehicle modified?"
                  className="h-7 text-xs"
                />
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Shown beside the options while editing. Not printed in the generated PDF.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <Label className="text-xs">Field name in PDF</Label>
                <Input
                  value={eg.name}
                  onChange={(e) => {
                    const cleaned = e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
                    updateRadioGroup(eg.id, { name: cleaned || "selection" });
                  }}
                  placeholder="e.g. modified"
                  className="h-7 text-xs font-mono"
                />
                {otherNames.includes(eg.name) && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                    Another group already uses this name — the generator will append a suffix to keep it unique.
                  </p>
                )}
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Used as the AcroForm field name. Lower-case letters, digits and underscores only.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!eg.borderless}
                    onChange={(e) => updateRadioGroup(eg.id, { borderless: e.target.checked })}
                    className="h-3.5 w-3.5 accent-violet-600"
                  />
                  <span>No border in PDF</span>
                </label>
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">
                  Hides each option's outline so it sits inside a circle already printed on the underlying PDF.
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Options</div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="gap-1 text-xs"
                    onClick={() => {
                      const last = eg.options[eg.options.length - 1];
                      const newOpt: PdfRadioOption = {
                        id: crypto.randomUUID(),
                        value: `option${eg.options.length + 1}`,
                        label: `Option ${eg.options.length + 1}`,
                        page: last?.page ?? currentPage,
                        x: (last?.x ?? Math.round(pdfWidth * 0.1)) + 60,
                        y: last?.y ?? Math.round(pdfHeight * 0.5),
                        width: last?.width ?? 12,
                        height: last?.height ?? 12,
                      };
                      updateRadioGroup(eg.id, { options: [...eg.options, newOpt] });
                    }}
                  >
                    <Plus className="h-3 w-3" /> Add Option
                  </Button>
                </div>

                <p className="text-[10px] text-violet-500 dark:text-violet-400 leading-snug">
                  Right-click any option on the PDF canvas to align / arrange the whole group.
                </p>

                <div className="space-y-2">
                  {eg.options.map((opt, idx) => {
                    const isDefault = eg.defaultValue === opt.value;
                    return (
                      <div
                        key={opt.id}
                        className="rounded-md border border-neutral-200 dark:border-neutral-800 p-2 space-y-2 bg-neutral-50 dark:bg-neutral-900"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Option {idx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateRadioGroup(eg.id, { defaultValue: isDefault ? "" : opt.value })}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                isDefault
                                  ? "border-violet-600 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                                  : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              }`}
                              title="Pre-select this option in the generated PDF"
                            >
                              {isDefault ? "Default ●" : "Set default"}
                            </button>
                            {eg.options.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  updateRadioGroup(eg.id, {
                                    options: eg.options.filter((o) => o.id !== opt.id),
                                    defaultValue: eg.defaultValue === opt.value ? "" : eg.defaultValue,
                                  });
                                  if (selectedRadioOption?.optionId === opt.id) setSelectedRadioOption(null);
                                }}
                                className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded"
                                title="Remove this option"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">Label</Label>
                            <Input
                              value={opt.label ?? ""}
                              onChange={(e) => updateRadioOption(eg.id, opt.id, { label: e.target.value })}
                              placeholder="Yes"
                              className="h-7 text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Stored value</Label>
                            <Input
                              value={opt.value}
                              onChange={(e) => {
                                const newVal = e.target.value;
                                const wasDefault = eg.defaultValue === opt.value;
                                updateRadioOption(eg.id, opt.id, { value: newVal });
                                if (wasDefault) updateRadioGroup(eg.id, { defaultValue: newVal });
                              }}
                              placeholder="yes"
                              className="h-7 text-xs font-mono"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">X (pts)</Label>
                            <Input type="number" value={opt.x} onChange={(e) => updateRadioOption(eg.id, opt.id, { x: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                          </div>
                          <div>
                            <Label className="text-[10px]">Y (pts)</Label>
                            <Input type="number" value={opt.y} onChange={(e) => updateRadioOption(eg.id, opt.id, { y: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">Width (pts)</Label>
                            <Input type="number" value={opt.width} onChange={(e) => updateRadioOption(eg.id, opt.id, { width: Math.max(6, Number(e.target.value) || 6) })} className="h-7 text-xs" min={6} step={0.5} />
                          </div>
                          <div>
                            <Label className="text-[10px]">Height (pts)</Label>
                            <Input type="number" value={opt.height} onChange={(e) => updateRadioOption(eg.id, opt.id, { height: Math.max(6, Number(e.target.value) || 6) })} className="h-7 text-xs" min={6} step={0.5} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-2 leading-snug">
                  Tip: click an option on the canvas to select it, then nudge it with the arrow keys (Shift+arrow = 10 pt).
                </p>
              </div>

              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 pb-1">
                <Button size="sm" className="w-full gap-1.5" onClick={handleSave} disabled={saving}>
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : "Save All"}
                </Button>
              </div>
            </div>
          </SlideDrawer>
        );
      })()}

      {/* Right-click context menu for checkboxes and radio options.
          Rendered at the cursor position using a fixed-positioned div so it
          sits above everything else. Clicking anywhere outside dismisses it. */}
      {ctxMenu && (() => {
        const closeMenu = () => setCtxMenu(null);

        // Arrange helpers used by radio option menu items.
        function arrangeGroup(groupId: string, dir: "align-h" | "align-v" | "space-h" | "space-v" | "same-size") {
          setRadioGroups((prev) =>
            prev.map((g) => {
              if (g.id !== groupId) return g;
              const opts = [...g.options];
              switch (dir) {
                case "align-h": {
                  const refY = Math.min(...opts.map((o) => o.y));
                  return { ...g, options: opts.map((o) => ({ ...o, y: refY })) };
                }
                case "align-v": {
                  const refX = Math.min(...opts.map((o) => o.x));
                  return { ...g, options: opts.map((o) => ({ ...o, x: refX })) };
                }
                case "space-h": {
                  const sorted = [...opts].sort((a, b) => a.x - b.x);
                  const step = (sorted[sorted.length - 1].x - sorted[0].x) / (sorted.length - 1);
                  const moved = sorted.map((o, i) => ({ ...o, x: Math.round((sorted[0].x + i * step) * 100) / 100 }));
                  return { ...g, options: moved };
                }
                case "space-v": {
                  const sorted = [...opts].sort((a, b) => b.y - a.y);
                  const step = (sorted[0].y - sorted[sorted.length - 1].y) / (sorted.length - 1);
                  const moved = sorted.map((o, i) => ({ ...o, y: Math.round((sorted[0].y - i * step) * 100) / 100 }));
                  return { ...g, options: moved };
                }
                case "same-size": {
                  const w = opts[0].width, h = opts[0].height;
                  return { ...g, options: opts.map((o) => ({ ...o, width: w, height: h })) };
                }
              }
              return g;
            }),
          );
          closeMenu();
        }

        // Position the menu near the cursor, keeping it on-screen.
        const menuStyle: React.CSSProperties = {
          position: "fixed",
          zIndex: 9999,
          top: Math.min(ctxMenu.screenY, window.innerHeight - 260),
          left: Math.min(ctxMenu.screenX, window.innerWidth - 200),
        };

        const group = ctxMenu.kind === "radioOption"
          ? radioGroups.find((g) => g.id === ctxMenu.groupId)
          : null;

        const itemCls = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200";
        const sepCls = "my-1 border-t border-neutral-200 dark:border-neutral-700";
        const headerCls = "px-3 py-1 text-[10px] uppercase tracking-wide font-semibold text-neutral-400 dark:text-neutral-500 select-none";

        return (
          <>
            {/* Invisible overlay to capture click-outside */}
            <div className="fixed inset-0 z-9998" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
            <div
              style={menuStyle}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-xl overflow-hidden min-w-[180px] py-1"
            >
              {ctxMenu.kind === "checkbox" && (() => {
                const cb = checkboxes.find((c) => c.id === ctxMenu.id);
                if (!cb) return null;

                // Use shift-click selection if it contains 2+ checkboxes,
                // otherwise offer "all on page" as a fallback.
                const selectedCbIds = [...multiSelectedShapeIds]
                  .filter((k) => k.startsWith("cb:"))
                  .map((k) => k.slice(3));
                const targetIds = selectedCbIds.length >= 2
                  ? selectedCbIds
                  : checkboxes.filter((c) => c.page === cb.page).map((c) => c.id);
                const targetLabel = selectedCbIds.length >= 2
                  ? `${selectedCbIds.length} selected`
                  : `all ${targetIds.length} on page`;

                function arrangeCheckboxes(dir: "align-h" | "align-v" | "space-h" | "space-v" | "same-size") {
                  setCheckboxes((prev) => {
                    const sel = prev.filter((c) => targetIds.includes(c.id));
                    if (sel.length < 2) return prev;
                    let updated: PdfCheckbox[] = sel;
                    switch (dir) {
                      case "align-h": {
                        const refY = Math.min(...sel.map((c) => c.y));
                        updated = sel.map((c) => ({ ...c, y: refY }));
                        break;
                      }
                      case "align-v": {
                        const refX = Math.min(...sel.map((c) => c.x));
                        updated = sel.map((c) => ({ ...c, x: refX }));
                        break;
                      }
                      case "space-h": {
                        const sorted = [...sel].sort((a, b) => a.x - b.x);
                        const step = (sorted[sorted.length - 1].x - sorted[0].x) / (sorted.length - 1);
                        updated = sorted.map((c, i) => ({ ...c, x: Math.round((sorted[0].x + i * step) * 100) / 100 }));
                        break;
                      }
                      case "space-v": {
                        const sorted = [...sel].sort((a, b) => b.y - a.y);
                        const step = (sorted[0].y - sorted[sorted.length - 1].y) / (sorted.length - 1);
                        updated = sorted.map((c, i) => ({ ...c, y: Math.round((sorted[0].y - i * step) * 100) / 100 }));
                        break;
                      }
                      case "same-size": {
                        const w = sel[0].width, h = sel[0].height;
                        updated = sel.map((c) => ({ ...c, width: w, height: h }));
                        break;
                      }
                    }
                    const updatedMap = new Map(updated.map((c) => [c.id, c]));
                    return prev.map((c) => updatedMap.get(c.id) ?? c);
                  });
                  closeMenu();
                }

                return (
                  <>
                    <div className={headerCls}>Checkbox</div>
                    {targetIds.length >= 2 && (
                      <>
                        <div className={`${headerCls} pt-2`}>Align {targetLabel}</div>
                        {selectedCbIds.length < 2 && (
                          <div className="px-3 py-1 text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
                            Shift-click checkboxes first to align only specific ones
                          </div>
                        )}
                        <button className={itemCls} onClick={() => arrangeCheckboxes("align-h")}>
                          Line up in a row (same Y)
                        </button>
                        <button className={itemCls} onClick={() => arrangeCheckboxes("align-v")}>
                          Stack in a column (same X)
                        </button>
                        <button className={itemCls} onClick={() => arrangeCheckboxes("space-h")}>
                          Space evenly left → right
                        </button>
                        <button className={itemCls} onClick={() => arrangeCheckboxes("space-v")}>
                          Space evenly top → bottom
                        </button>
                        <button className={itemCls} onClick={() => arrangeCheckboxes("same-size")}>
                          Make all same size
                        </button>
                        <div className={sepCls} />
                      </>
                    )}
                    <button className={itemCls} onClick={() => { updateCheckbox(cb.id, { borderless: !cb.borderless }); closeMenu(); }}>
                      {cb.borderless ? "✓ " : ""}No border in PDF
                    </button>
                    <button className={itemCls} onClick={() => { updateCheckbox(cb.id, { defaultChecked: !cb.defaultChecked }); closeMenu(); }}>
                      {cb.defaultChecked ? "✓ " : ""}Pre-ticked by default
                    </button>
                    <button className={itemCls} onClick={() => { setEditingCheckboxId(cb.id); closeMenu(); }}>
                      Edit properties…
                    </button>
                    <div className={sepCls} />
                    <button className={`${itemCls} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950`}
                      onClick={() => { setCheckboxes((prev) => prev.filter((c) => c.id !== cb.id)); setSelectedCheckboxId(null); closeMenu(); }}>
                      Delete checkbox
                    </button>
                  </>
                );
              })()}

              {ctxMenu.kind === "radioOption" && group && (() => {
                const opt = group.options.find((o) => o.id === ctxMenu.optionId);
                const isDefault = group.defaultValue === opt?.value;
                return (
                  <>
                    <div className={headerCls}>{group.label || "Selection"}</div>
                    {group.options.length >= 2 && (
                      <>
                        <div className={`${headerCls} pt-2`}>Arrange all options</div>
                        <button className={itemCls} onClick={() => arrangeGroup(group.id, "align-h")}>
                          Line up in a row (same Y)
                        </button>
                        <button className={itemCls} onClick={() => arrangeGroup(group.id, "align-v")}>
                          Stack in a column (same X)
                        </button>
                        <button className={itemCls} onClick={() => arrangeGroup(group.id, "space-h")}>
                          Space evenly left → right
                        </button>
                        <button className={itemCls} onClick={() => arrangeGroup(group.id, "space-v")}>
                          Space evenly top → bottom
                        </button>
                        <button className={itemCls} onClick={() => arrangeGroup(group.id, "same-size")}>
                          Make all same size
                        </button>
                        <div className={sepCls} />
                      </>
                    )}
                    <button className={itemCls} onClick={() => { updateRadioGroup(group.id, { borderless: !group.borderless }); closeMenu(); }}>
                      {group.borderless ? "✓ " : ""}No border in PDF
                    </button>
                    {opt && (
                      <button className={itemCls} onClick={() => { updateRadioGroup(group.id, { defaultValue: isDefault ? "" : opt.value }); closeMenu(); }}>
                        {isDefault ? "✓ " : ""}Pre-select "{opt.label || opt.value}"
                      </button>
                    )}
                    <button className={itemCls} onClick={() => { setEditingRadioGroupId(group.id); closeMenu(); }}>
                      Edit selection…
                    </button>
                    <div className={sepCls} />
                    {opt && group.options.length > 1 && (
                      <button className={`${itemCls} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950`}
                        onClick={() => {
                          updateRadioGroup(group.id, {
                            options: group.options.filter((o) => o.id !== opt.id),
                            defaultValue: group.defaultValue === opt.value ? "" : group.defaultValue,
                          });
                          if (selectedRadioOption?.optionId === opt.id) setSelectedRadioOption(null);
                          closeMenu();
                        }}>
                        Delete this option
                      </button>
                    )}
                    <button className={`${itemCls} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950`}
                      onClick={async () => {
                        closeMenu();
                        const ok = await import("@/components/ui/global-dialogs").then((m) => m.confirmDialog({
                          title: `Delete "${group.label || group.name}" selection?`,
                          description: "All options inside this group will be removed.",
                          confirmLabel: "Delete",
                          destructive: true,
                        }));
                        if (!ok) return;
                        setRadioGroups((prev) => prev.filter((g) => g.id !== group.id));
                        setSelectedRadioOption(null);
                      }}>
                      Delete whole selection
                    </button>
                  </>
                );
              })()}
            </div>
          </>
        );
      })()}

      {/* Image editing drawer */}
      {selectedImage && (
        <SlideDrawer
          open
          onClose={() => setSelectedImageId(null)}
          title={`Image: ${selectedImage.label ?? "Untitled"}`}
          side="right"
          widthClass="w-[300px] sm:w-[340px]"
        >
          <div className="overflow-y-auto p-3 space-y-3 h-full overscroll-contain">
            <div className="flex gap-1">
              <Button size="xs" variant="outline" className="gap-1 text-xs flex-1" onClick={() => duplicateImage(selectedImage)}>
                <Copy className="h-3 w-3" /> Duplicate
              </Button>
              <Button size="xs" variant="outline" className="gap-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => deleteImage(selectedImage.id)}>
                <Trash2 className="h-3 w-3" /> Delete
              </Button>
            </div>

            <div>
              <Label className="text-xs">Label</Label>
              <Input
                value={selectedImage.label ?? ""}
                onChange={(e) => updateImage(selectedImage.id, { label: e.target.value })}
                className="h-7 text-xs"
              />
            </div>

            {imageUrls[selectedImage.storedName] && (
              <div className="rounded border border-neutral-200 dark:border-neutral-800 p-2 bg-neutral-50 dark:bg-neutral-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrls[selectedImage.storedName]} alt={selectedImage.label ?? "preview"} className="max-h-32 mx-auto object-contain" />
              </div>
            )}

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Position</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">X (pts)</Label>
                  <Input type="number" value={selectedImage.x} onChange={(e) => updateImage(selectedImage.id, { x: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                </div>
                <div>
                  <Label className="text-xs">Y (pts)</Label>
                  <Input type="number" value={selectedImage.y} onChange={(e) => updateImage(selectedImage.id, { y: Number(e.target.value) || 0 })} className="h-7 text-xs" step={0.5} />
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">Size</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Width (pts)</Label>
                  <Input type="number" value={selectedImage.width} onChange={(e) => updateImage(selectedImage.id, { width: Number(e.target.value) || 10 })} className="h-7 text-xs" min={5} />
                </div>
                <div>
                  <Label className="text-xs">Height (pts)</Label>
                  <Input type="number" value={selectedImage.height} onChange={(e) => updateImage(selectedImage.id, { height: Number(e.target.value) || 10 })} className="h-7 text-xs" min={5} />
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 pb-1">
              <Button size="sm" className="w-full gap-1.5" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save All"}
              </Button>
            </div>
          </div>
        </SlideDrawer>
      )}

      {/* Template Settings drawer */}
      {showSettings && (
      <SlideDrawer
        open
        onClose={() => setShowSettings(false)}
        title="Template Settings"
        side="right"
        widthClass="w-[340px] sm:w-[400px]"
      >
        <div className="overflow-y-auto p-3 space-y-4 h-full overscroll-contain">
          <div>
            <Label className="text-xs">Description</Label>
            <Input
              value={settingsDesc}
              onChange={(e) => setSettingsDesc(e.target.value)}
              className="mt-1 h-8 text-xs"
              placeholder="Brief description of this template"
            />
          </div>

          {/* Repeatable slots — controls how many indexed rows
              ("Driver 1 …", "Driver 2 …", …) appear in the field
              picker for repeatable package fields. Empty rows render
              blank on the generated PDF, so a 4-driver form just
              shows whichever drivers actually have data. */}
          <div>
            <Label className="text-xs">Repeatable slots</Label>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-1.5">
              Number of indexed rows (Driver 1 / 2 / 3 …) the picker
              exposes for repeatable fields. Default: {DEFAULT_REPEATABLE_SLOTS}.
              Slots without data render blank on the PDF.
            </p>
            <Input
              type="number"
              min={1}
              max={20}
              value={settingsRepeatableSlots}
              onChange={(e) => setSettingsRepeatableSlots(e.target.value)}
              className="mt-1 h-8 text-xs w-24"
              placeholder={String(DEFAULT_REPEATABLE_SLOTS)}
            />
          </div>

          {/* Restrict to Flows */}
          <div>
            <Label className="text-xs">
              Restrict to Flows <span className="text-neutral-400">(optional)</span>
            </Label>
            <div className="mt-1.5 space-y-1">
              {availableFlows.length === 0 && (
                <span className="text-[11px] text-neutral-400">No flows defined</span>
              )}
              {availableFlows.map((f) => (
                <label key={f.value} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsFlows.includes(f.value)}
                    onChange={(e) =>
                      setSettingsFlows((prev) =>
                        e.target.checked ? [...prev, f.value] : prev.filter((v) => v !== f.value),
                      )
                    }
                    className="h-3.5 w-3.5"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          {/* Show When Status */}
          {availableStatuses.length > 0 && (
            <div>
              <Label className="text-xs">
                Show When Status <span className="text-neutral-400">(empty = always)</span>
              </Label>
              <div className="mt-1.5 space-y-1">
                {availableStatuses.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settingsShowWhenStatus.includes(s.value)}
                      onChange={(e) =>
                        setSettingsShowWhenStatus((prev) =>
                          e.target.checked ? [...prev, s.value] : prev.filter((v) => v !== s.value),
                        )
                      }
                      className="h-3.5 w-3.5"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Insurance Company */}
          <div>
            <Label className="text-xs">
              Insurance Company <span className="text-neutral-400">(empty = all companies)</span>
            </Label>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5 mb-1.5">
              Restrict this template to policies linked to specific insurance companies.
            </p>
            <div className="space-y-1">
              {availableOrgs.length === 0 && (
                <span className="text-[11px] text-neutral-400">No insurance companies found</span>
              )}
              {availableOrgs.map((ins) => (
                <label key={ins.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsInsurerIds.includes(ins.id)}
                    onChange={(e) =>
                      setSettingsInsurerIds((prev) =>
                        e.target.checked ? [...prev, ins.id] : prev.filter((id) => id !== ins.id),
                      )
                    }
                    className="h-3.5 w-3.5"
                  />
                  {ins.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Cover Type (Accounting Line Key)</Label>
            <Input
              value={settingsLineKey}
              onChange={(e) => setSettingsLineKey(e.target.value.trim())}
              className="mt-1 h-8 text-xs"
              placeholder="e.g. tpo, od"
            />
            <p className="mt-1 text-[10px] text-neutral-400">
              For multi-cover policies (TPO + OD): set to the premium line key.
              Leave empty for all policies.
            </p>
          </div>

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 pb-1">
            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={handleSaveSettings}
              disabled={settingsSaving}
            >
              <Save className="h-3.5 w-3.5" />
              {settingsSaving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </SlideDrawer>
      )}
    </div>
  );
}
