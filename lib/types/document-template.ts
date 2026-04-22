export type TemplateFieldMapping = {
  key: string;
  label: string;
  format?: "text" | "currency" | "date" | "boolean" | "number";
  currencyCode?: string;
  /**
   * Optional group label inherited from the underlying package field's
   * `meta.group` (set in the Package Fields editor). Captured at field-add /
   * save time so the rendered document can show "Section 1 Excess",
   * "Section 2 Excess" sub-headings between fields without having to fetch
   * package metadata at render time. Empty / undefined => no sub-heading
   * for this field. Only honored when the parent section's
   * `showFieldGroupHeaders` flag is true.
   */
  group?: string;
};

export type TemplateSection = {
  id: string;
  title: string;
  /**
   * Per-section override for the rendered title font size. Falls back to
   * the template-wide `meta.layout.sectionTitleSize` when unset, which
   * itself defaults to "sm". Lets a single section be made bigger or
   * smaller without affecting the rest of the document.
   */
  titleSize?: "xs" | "sm" | "md" | "lg";
  /** Where to pull data from in the snapshot */
  source: "insured" | "contactinfo" | "package" | "policy" | "agent" | "accounting" | "client" | "organisation" | "statement";
  /** Required when source is "package" */
  packageName?: string;
  /** Which audience sees this section: "all" (default), "client", or "agent" */
  audience?: "all" | "client" | "agent";
  /** Render fields as a table (one row per item) instead of label–value pairs */
  layout?: "default" | "table";
  /**
   * Number of label/value pairs to render per row in the default layout.
   *  - `1` (default): one field per line (Vehicle Info style today).
   *  - `2`: pack two fields per line as a 2-column grid — useful for sections
   *    with many short fields (Vehicle Info, Insured Info, etc.) to save
   *    vertical space.
   * Ignored for `layout: "table"`, the special "totals" / "line_items" sections.
   */
  columns?: 1 | 2;
  /**
   * Render sub-headings between fields that come from different package
   * groups (e.g. "Section 1 Excess", "Section 2 Excess"). The group label
   * itself is read from each field's `group` property — set automatically
   * when a field is added in the editor based on the underlying package's
   * `meta.group`. Defaults to false to keep existing templates unchanged.
   */
  showFieldGroupHeaders?: boolean;
  /**
   * How many group blocks to pack per row when `showFieldGroupHeaders` is
   * true. Each block renders its header followed by its fields stacked
   * underneath, like a mini section-within-a-section.
   *  - `1` (default): one group block per row — vertical stack.
   *  - `2`: two group blocks side-by-side — useful when a section has many
   *    small groups (e.g. excesses, premium splits) that would otherwise
   *    waste vertical space.
   * Ignored when `showFieldGroupHeaders` is false.
   */
  fieldGroupColumns?: 1 | 2;
  /**
   * Per-group hide list. Group names listed here will not have their
   * sub-heading rendered, even when `showFieldGroupHeaders` is true —
   * the fields still render, they're just no longer visually separated
   * by that group's title. Useful when most groups in a section are
   * informative but a couple are noise (e.g. "OTHER" buckets used in the
   * package editor that don't need to show up to clients).
   *
   * Empty/undefined => every group's header is shown (backward
   * compatible). Hidden via the per-group eye toggles in the section
   * editor. NOTE: in the 2-column group layout, hiding a header still
   * keeps the bucket as a column — only its title disappears, since the
   * fields themselves still need a place to render.
   */
  hiddenGroupHeaders?: string[];
  fields: TemplateFieldMapping[];
};

export type DocumentTemplateMeta = {
  type: "quotation" | "invoice" | "receipt" | "certificate" | "letter" | "credit_note" | "debit_note" | "endorsement" | "statement" | "custom";
  /** Restrict to specific flows (empty = available for all flows) */
  flows?: string[];
  /** Only show this document when policy status matches (empty = always) */
  showWhenStatus?: string[];
  /** Client-specific status visibility (fallback to showWhenStatus when empty) */
  showWhenStatusClient?: string[];
  /** Agent-specific status visibility (fallback to showWhenStatus when empty) */
  showWhenStatusAgent?: string[];
  /** Restrict to specific insurance companies by their policy record IDs (empty = all) */
  insurerPolicyIds?: number[];
  /** Whether this document requires client confirmation after sending (default: true for quotation, false for others) */
  requiresConfirmation?: boolean;
  /** Prefix for auto-generated document numbers (e.g. "QUO", "INV", "REC") */
  documentPrefix?: string;
  /** Group name for shared document numbering — templates in the same group share one random code */
  documentSetGroup?: string;
  /** Mark as agent template — auto-appends (A) to document numbers */
  isAgentTemplate?: boolean;
  /** When true, this single template generates both a Client copy and an Agent copy (with "(A)" suffix). */
  enableAgentCopy?: boolean;
  /**
   * Marks this template as the section master.  Only one template should have
   * this flag set at a time.  Other templates can "Sync from Master" to pull
   * the latest section configuration (fields, columns, layout, audience) in
   * one click without touching their own header, type, or flow settings.
   */
  isMaster?: boolean;
  /** Where this template should be listed/rendered */
  showOn?: ("policy" | "agent")[];
  /** When true, hides the document if no statement exists for this audience (requires Payment Schedule) */
  requiresStatement?: boolean;
  /** Restrict to a specific accounting line key (e.g. "tpo", "od"). Only shows when the policy has a premium line with this key. Empty = all. */
  accountingLineKey?: string;
  header: {
    title: string;
    /** "sm" | "md" | "lg" | "xl" — controls the rendered title font-size (default "lg") */
    titleSize?: "sm" | "md" | "lg" | "xl";
    subtitle?: string;
    /** "xs" | "sm" | "md" — controls the rendered subtitle font-size (default "sm") */
    subtitleSize?: "xs" | "sm" | "md";
    /** Tailwind-compatible hex color for the subtitle text (default "#737373") */
    subtitleColor?: string;
    showDate?: boolean;
    showPolicyNumber?: boolean;
  };
  sections: TemplateSection[];
  footer?: {
    text?: string;
    showSignature?: boolean;
  };
  /**
   * Template-wide layout overrides. Applies to every section in the
   * template — kept template-level (not per-section) so the editor UI
   * stays clean and the document looks visually consistent. Both fields
   * are optional with sensible defaults so existing templates render
   * unchanged.
   */
  layout?: {
    /**
     * Font size of section titles in the rendered output (preview /
     * email / print). Defaults to "sm". Useful for fitting more on a
     * single A4 page (smaller) or making titles more prominent (larger).
     */
    sectionTitleSize?: "xs" | "sm" | "md" | "lg";
    /**
     * Vertical spacing between sections.
     *  - "compact": minimal gaps — best for cramming the most onto one A4.
     *  - "normal" (default): the current tightened default.
     *  - "loose": extra breathing room — useful for sparse documents.
     */
    sectionSpacing?: "compact" | "normal" | "loose";
  };
};

export function resolveDocumentTemplateShowOn(
  meta: DocumentTemplateMeta | null | undefined,
): ("policy" | "agent")[] {
  const configured = meta?.showOn?.filter((v): v is "policy" | "agent" => v === "policy" || v === "agent") ?? [];
  let result: ("policy" | "agent")[];
  if (configured.length > 0) {
    result = [...new Set(configured)];
  } else if (meta?.type === "statement" && meta?.isAgentTemplate) {
    result = ["agent"];
  } else {
    result = ["policy"];
  }
  // Agent statements must list under Agent Details even if Show On was saved as policy-only.
  if (meta?.type === "statement" && meta?.isAgentTemplate && !result.includes("agent")) {
    result = [...result, "agent"];
  }
  // Client workflow docs (invoice, receipt, …) stay on Policy Details unless the template is agent-only.
  if (!meta?.isAgentTemplate && meta?.type !== "statement" && !result.includes("policy")) {
    result = [...result, "policy"];
  }
  return [...new Set(result)];
}

export type DocumentTemplateRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  meta: DocumentTemplateMeta | null;
};
