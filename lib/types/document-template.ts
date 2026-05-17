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
  /**
   * Tracks the most recent "Apply section to other templates" action.
   * Set automatically by the editor after a successful apply — no need to
   * edit this manually. Displayed as a small badge on the section header
   * so admins can see at a glance which sections have been pushed out.
   */
  lastAppliedAt?: string;   // ISO-8601 timestamp
  lastAppliedCount?: number; // number of templates successfully updated
  /** Where to pull data from in the snapshot */
  source: "insured" | "contactinfo" | "package" | "policy" | "agent" | "accounting" | "client" | "organisation" | "statement";
  /** Required when source is "package" */
  packageName?: string;
  /** Which audience sees this section: "all" (default), "client", or "agent" */
  audience?: "all" | "client" | "agent";
  /**
   * When the section is visible to both audiences (`audience: "all"`), the
   * renderer normally strips agent-premium / agent-credit fields from the
   * client copy and client-premium / client-credit fields from the agent
   * copy. Set these to override that default for a specific section.
   *
   * `showClientPremiumOnAgentCopy: true` → keep client-premium fields on the
   * agent copy (e.g. so the agent can see what the client is paying).
   * `showAgentPremiumOnClientCopy: true` → keep agent-premium fields on the
   * client copy.
   *
   * No effect unless `audience` is "all" (or unset).
   */
  showClientPremiumOnAgentCopy?: boolean;
  showAgentPremiumOnClientCopy?: boolean;
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
  /**
   * Per-group override for fields-per-row INSIDE a single group. Key =
   * group name (matches `TemplateFieldMapping.group`). When unset for
   * a group the section-level `columns` value is used. Lets a section
   * mix dense and sparse groups (e.g. 2-per-row excesses next to
   * 1-per-row notes) without needing a section split.
   *
   * Only honored when `showFieldGroupHeaders` is true — without group
   * boundaries there is no "group" context to override. Falls back to
   * `columns` for any group not present in the map.
   */
  groupColumns?: Record<string, 1 | 2>;
  /**
   * Group names that should occupy the FULL section width regardless of
   * `fieldGroupColumns`. Only meaningful when `fieldGroupColumns: 2`
   * (two group blocks per row) — listed groups break out of the 2-col
   * grid and span the whole row, with adjacent narrower groups still
   * pairing up two-per-row above/below them. Useful for one big group
   * (e.g. premium breakdown) sitting alongside several short groups.
   *
   * Ignored when `fieldGroupColumns` is 1 (everything is full-width
   * already). Empty/undefined => no group is forced full-width.
   */
  fullWidthGroups?: string[];
  /**
   * Per-group visibility gate based on the policy's active accounting
   * line keys (a.k.a. cover types — `tpo`, `od`, `pd`, …). Keyed by
   * group name (matches `TemplateFieldMapping.group`).
   *
   * The group's fields render ONLY when EVERY listed key is present
   * in the policy's cover-line set. This is the right knob for
   * "Sum Premium (TPO + PD)" style groups that should only appear on
   * multi-cover policies — set `["tpo", "pd"]` on the Sum Premium
   * group and it auto-disappears for single-cover policies, without
   * affecting any other group.
   *
   * Empty / missing entry for a group => no cover-type gate
   * (existing behaviour). The synthetic "Other" bucket (fields with
   * no `meta.group`) is intentionally ungatable here because it has
   * no stable name to key by.
   */
  groupCoverTypes?: Record<string, string[]>;
  /**
   * Section-level cover-types gate. When set, the WHOLE section is
   * hidden unless every listed key is present in the policy's
   * cover-line set. Useful for sections that don't use per-group
   * headers (e.g. a standalone "Multi-cover summary" section).
   *
   * Combines with `groupCoverTypes` — a group is shown only when
   * BOTH section-level and per-group gates pass.
   */
  sectionCoverTypes?: string[];
  /**
   * Inverse of `groupCoverTypes` — keys whose simultaneous presence
   * HIDES the group. The group's fields render UNLESS every listed
   * key is present in the policy's cover-line set.
   *
   * Use to swap per-cover rows for a combined-sum row on multi-cover
   * policies (e.g. hide "General Accounting" + "PD Accounting" groups
   * when the policy has both `tpo` AND `own_vehicle_damage`, since
   * "Sum Premium (TPO + PD)" already conveys the totals).
   *
   * Combines with `groupCoverTypes` (AND): a group renders iff
   * `groupCoverTypes` passes AND `groupHideCoverTypes` does NOT match.
   */
  groupHideCoverTypes?: Record<string, string[]>;
  /**
   * Inverse of `sectionCoverTypes` — hides the WHOLE section when
   * every listed key is present in the policy's cover-line set.
   * Useful for a "Per-cover detail" section that should disappear on
   * multi-cover policies in favour of a combined-sum section.
   */
  sectionHideCoverTypes?: string[];
  /**
   * Per-group visibility gate based on the policy's resolved
   * **category** slug (e.g. `tpo`, `comp`, `tpo_with_od`), keyed by
   * group name (matches `TemplateFieldMapping.group`).
   *
   * Each policy resolves to exactly ONE category (via
   * `form_options.policy_category` config), so this is a much simpler
   * mental model than the `groupCoverTypes` / `groupHideCoverTypes`
   * pair above: the group renders only when the policy's category is
   * in the list. Empty / missing entry => no gate (always show).
   *
   * This is the preferred admin-facing config — the older line-key
   * gates are kept for backwards compatibility on templates that were
   * configured before the category picker existed, but new templates
   * should set this field instead.
   */
  groupCoverCategories?: Record<string, string[]>;
  /**
   * Section-level mirror of `groupCoverCategories`. When set, the
   * WHOLE section is hidden unless the policy's category slug is in
   * the list. Combines with `sectionCoverTypes` /
   * `sectionHideCoverTypes` (AND).
   */
  sectionCoverCategories?: string[];
  /**
   * Optional typography for label/value rows in this section only (typical
   * use: Premium). Overrides template-wide `meta.layout.bodyFontSize` /
   * `labelColor` / `valueColor` for this block. Email and print HTML use the
   * same rules as the on-screen preview.
   */
  premiumTypography?: {
    /** When set, replaces `layout.bodyFontSize` for rows in this section. */
    bodyFontSize?: "xs" | "sm" | "md" | "lg";
    /** Hex label colour (e.g. `#737373`). */
    labelColor?: string;
    /** Hex value colour (e.g. `#1a1a1a`). */
    valueColor?: string;
    /**
     * When true, the last visible row in this section whose format is
     * `currency`, `negative_currency`, or `number` is rendered bolder on the
     * value side (document field order).
     */
    emphasizeLatestAmount?: boolean;
  };
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
    /**
     * Font size for the auto-generated document number (e.g. "INV-2025-0001")
     * shown in the top-right of the header. Defaults to "md" which matches
     * the previous hard-coded `text-base` (~14px in print) so existing
     * templates render unchanged. Use a smaller value when the prefix is
     * long and was wrapping or competing with the title.
     */
    documentNumberSize?: "xs" | "sm" | "md" | "lg" | "xl";
    /**
     * Hex color for the document number value. Defaults to "#1a1a1a"
     * (the previous hard-coded near-black) so existing templates render
     * unchanged. The "DOC NO." label above stays in the muted neutral
     * palette so the number itself remains the visual anchor.
     */
    documentNumberColor?: string;
    /**
     * Stored filename of the logo image (uploaded to the shared template
     * file store — see `lib/storage-pdf-templates.ts`). Empty/undefined
     * means no logo. Served via `/api/pdf-templates/images/[storedName]`
     * so the same auth + cache headers apply for free.
     */
    logoStoredName?: string;
    /**
     * Rendered logo height. Width auto-scales to preserve aspect ratio.
     *  - "sm" ≈ 32px (compact, sits beside title text)
     *  - "md" (default) ≈ 48px (typical letterhead)
     *  - "lg" ≈ 72px (prominent, takes most of the header band)
     */
    logoSize?: "sm" | "md" | "lg";
    /**
     * Where the logo sits in the header row.
     *  - "left" (default): logo on the left, title block to its right.
     *  - "right": logo on the right (where the doc-no usually sits) —
     *    doc-no falls underneath the title block in this mode.
     *  - "center": logo centred above the title block (full-width row).
     */
    logoPosition?: "left" | "right" | "center";
  };
  sections: TemplateSection[];
  footer?: {
    text?: string;
    /**
     * @deprecated Use `showAuthorizedSignature` + `showClientSignature`
     * instead. Kept for backward compatibility — when truthy and the new
     * flags are both unset, both signature blocks are rendered (matches
     * the legacy single-toggle behaviour).
     */
    showSignature?: boolean;
    /**
     * Show the company-side signature block (e.g. director, agent rep).
     * When unset, falls back to the legacy `showSignature` flag.  Independent
     * from `showClientSignature` so a template can include only one.
     */
    showAuthorizedSignature?: boolean;
    /**
     * Show the recipient-side signature block (the client signs by hand
     * after print, or — in a future iteration — captures an e-signature
     * online).  When unset, falls back to `showSignature`.
     */
    showClientSignature?: boolean;
    /**
     * Stored filename of the AUTHORIZED signature image (the company's
     * pre-signed signature, e.g. director's scanned wet sig).  When set,
     * the image is rendered above the line so the document arrives
     * already executed by the issuer.  Empty/undefined => render an empty
     * line that the company representative can hand-sign on a printout.
     * Stored in the same blob table as logos so the same /pdf-templates/
     * images endpoint can serve it.
     */
    authorizedSignatureImage?: string;
    /**
     * Rendered height of the authorized-signature image. Width auto-scales
     * to preserve aspect ratio. Defaults to "md" (~48px), which sits
     * comfortably above the signature line without dominating it.
     */
    authorizedSignatureImageHeight?: "sm" | "md" | "lg";
    /** Hex color for the footer text. Defaults to "#a3a3a3" (neutral-400). */
    textColor?: string;
    /** Footer text font size. Defaults to "xs" (~11px in print). */
    textSize?: "xs" | "sm" | "md";
    /** Horizontal alignment for the footer text. Defaults to "left". */
    textAlign?: "left" | "center" | "right";
    /**
     * Custom labels for the two signature lines. When unset they fall back
     * to the original "Authorized Signature" / "Client Signature" wording.
     * Useful for templates that need different roles (e.g. "Issuer" /
     * "Insured", "Agent" / "Client", "Broker" / "Underwriter").
     */
    signatureLeftLabel?: string;
    signatureRightLabel?: string;
    /**
     * When true, render a small "Page X of Y" indicator under the footer
     * text. Only meaningful for print/PDF — the on-screen preview shows a
     * single "Page 1" placeholder so admins can see where it'll appear.
     */
    showPageNumbers?: boolean;
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
    /**
     * Body text size for field labels & values across the document.
     * Defaults to "sm" which matches the previous hard-coded 11/13 px
     * pair. Useful for fitting more content per A4 page (smaller) or
     * making the document easier to read at distance (larger).
     */
    bodyFontSize?: "xs" | "sm" | "md" | "lg";
    /**
     * Hex color (e.g. "#737373") for field labels (the left-hand side
     * of each row). Falls back to the previous neutral-500 default.
     * Validated only as "starts with #" — render paths trust the value.
     */
    labelColor?: string;
    /**
     * Hex color for field values (the right-hand side of each row).
     * Falls back to the previous neutral-900 default. Useful for
     * brand-coloring a quote or making a draft watermark look subtler.
     */
    valueColor?: string;
    /**
     * Font size for field-group sub-headings inside sections (only shown
     * when `section.showFieldGroupHeaders` is true). Defaults to "xs".
     * Smaller keeps things tight; larger makes group boundaries prominent.
     */
    groupHeaderSize?: "xs" | "sm" | "md";
    /**
     * Hex color for field-group sub-headings. Defaults to "#737373"
     * (neutral-500), matching the previous hard-coded style.
     */
    groupHeaderColor?: string;
  };
};

/**
 * Resolve the effective "show authorized signature" / "show client signature"
 * flags for a template footer.
 *
 * Compatibility table:
 *   - New flags set explicitly → use them as-is.
 *   - Only the legacy `showSignature` is set → both blocks show (mirrors
 *     pre-split behaviour where one toggle controlled both).
 *   - Nothing set → both flags false (no signature lines rendered).
 *
 * Centralising this logic prevents render paths (on-screen, email, print)
 * from drifting on how the legacy flag should be interpreted.
 */
export function resolveSignatureFlags(
  footer: DocumentTemplateMeta["footer"] | undefined,
): { showAuthorized: boolean; showClient: boolean } {
  if (!footer) return { showAuthorized: false, showClient: false };
  const newFieldsSet =
    typeof footer.showAuthorizedSignature === "boolean" ||
    typeof footer.showClientSignature === "boolean";
  if (newFieldsSet) {
    return {
      showAuthorized: footer.showAuthorizedSignature ?? false,
      showClient: footer.showClientSignature ?? false,
    };
  }
  if (footer.showSignature) return { showAuthorized: true, showClient: true };
  return { showAuthorized: false, showClient: false };
}

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
