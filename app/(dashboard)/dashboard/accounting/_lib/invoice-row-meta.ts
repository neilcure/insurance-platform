/**
 * Per-row classifier and presentation helpers for the Accounting
 * dashboard.
 *
 * Why this exists
 * ---------------
 * The dashboard's old "All Invoices" list mixed five very different
 * record types into one flat list:
 *   • client receivable invoices
 *   • agent receivable settlements (we collect net premium FROM agent)
 *   • agent commission payables (we PAY commission TO agent)
 *   • credit notes (refund-to-client)
 *   • statement parents (bundled multi-policy receivables)
 *
 * On top of that, sending a "debit note" template against an existing
 * receivable rotates the SAME row's `invoiceNumber` from `HIDIINV-…`
 * to `HIDIDEBT-…` — same record, same money, different document. The
 * old UI rendered the rotated number as if it were a new "thing",
 * which made one record look like it was being counted twice.
 *
 * This helper:
 *   1. Classifies each row into a stable category so each section of
 *      the UI knows what fields apply.
 *   2. Computes a stable display id (the lifecycle setCode, e.g.
 *      `2026-3389`) that does NOT rotate when a debit-note or receipt
 *      template is sent against the row. The current `invoiceNumber`
 *      becomes "the latest document for this record", not the
 *      record's identity.
 *
 * The shape mirrors what `app/api/accounting/invoices/route.ts`
 * returns after the route was updated to add `documentLifecycle`,
 * `setCode`, `parentPolicyId`, `parentPolicyNumber`, `groupPolicyId`,
 * `isEndorsement`, `warnings`, and `flowKey`.
 */

import type { InvoiceDirection, InvoiceType, PremiumType, EntityType, InvoiceStatus } from "@/lib/types/accounting";

export type InvoiceCategory =
  | "client_receivable"          // Money to collect from a client
  | "agent_receivable"           // Money to collect from an agent (net premium settlement)
  | "agent_commission_payable"   // Commission we owe an agent (typically created when the client paid us directly)
  | "credit_note"                // Refund owed back to a client / reversal
  | "statement_bundle"           // Statement parent that bundles many individual invoices
  | "other";                     // Anything not yet classified — surfaced so missing branches are obvious

export type InvoiceWarning = "overpaid" | "orphan_no_policy" | "status_mismatch";

export type LifecycleEntry = {
  trackingKey: string;
  documentNumber: string;
  status: string | null;
  timestamp: string | null;
};

/**
 * Subset of the API response this dashboard cares about. Treat as
 * read-only — the renderer never mutates these.
 */
export type InvoiceRow = {
  id: number;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  direction: InvoiceDirection;
  premiumType: PremiumType;
  entityType: EntityType;
  entityName: string | null;
  status: InvoiceStatus | string;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  invoiceDate: string | null;
  dueDate: string | null;
  scheduleId: number | null;

  policyId: number | null;
  policyNumber: string | null;
  flowKey: string | null;
  clientName: string | null;
  agentName: string | null;
  documentNumbers: Record<string, string> | null;
  documentLifecycle: LifecycleEntry[];
  setCode: string | null;
  parentPolicyId: number | null;
  parentPolicyNumber: string | null;
  /** Group-by key the UI uses to cluster a parent + endorsements. */
  groupPolicyId: number | null;
  isEndorsement: boolean;
  warnings: InvoiceWarning[];

  /**
   * True when at least one verified/confirmed/recorded payment on this
   * receivable has `accounting_payments.payer = 'client'` — i.e. the
   * client paid admin DIRECTLY (skipping the agent).
   *
   * In that case `paid > total` is BY DESIGN, not a data error: the
   * receivable's total is `agentPremium` (net), the client paid
   * `clientPremium` (full), and the difference is the agent commission
   * which lives on a SEPARATE payable (AP-…) row.
   *
   * The dashboard uses this flag to:
   *   • render the "Client paid directly" badge instead of "overpaid"
   *   • suppress the false data-integrity warning
   *   • keep the headline numbers honest
   *
   * See `.cursor/rules/insurance-platform-architecture.mdc` "Payment
   * paths (who pays admin)" + the "NEVER use invoice `entityType` to
   * determine who made a payment — use `accounting_payments.payer`"
   * rule.
   */
  wasClientPaidDirectly: boolean;
  /** Same as above for `submitted` (not yet verified) client-direct payments. */
  hasClientDirectSubmitted: boolean;

  totalGainCents?: number;
  totalNetPremiumCents?: number;
};

export const CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  client_receivable: "Client Premium",
  agent_receivable: "Agent Settlement",
  agent_commission_payable: "Agent Commission",
  credit_note: "Credit Note",
  statement_bundle: "Statement",
  other: "Other",
};

/**
 * Tailwind class for the category accent. Kept in sync with the
 * status badges used elsewhere in the app for visual consistency.
 */
export const CATEGORY_ACCENT: Record<InvoiceCategory, string> = {
  client_receivable: "border-blue-500/40 bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200",
  agent_receivable: "border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
  agent_commission_payable: "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  credit_note: "border-rose-500/40 bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200",
  statement_bundle: "border-purple-500/40 bg-purple-50 text-purple-900 dark:bg-purple-950/30 dark:text-purple-200",
  other: "border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
};

/**
 * Pick the category from the underlying tuple (direction × premiumType
 * × invoiceType × entityType). Every accounting record falls into
 * exactly ONE category, so this is the source of truth used by the
 * dashboard sections, the per-row badge, and the field-gating logic.
 *
 * NOTE: the rule for "agent_commission_payable" intentionally does
 * NOT look at notes/string keywords — that violates
 * `dynamic-config-first.mdc`. We use the structural fields
 * (direction='payable' + premiumType='agent_premium' +
 * entityType='agent'), which is what `lib/agent-commission.ts`
 * actually writes.
 */
export function classifyInvoice(row: InvoiceRow): InvoiceCategory {
  if (row.invoiceType === "credit_note") return "credit_note";
  if (row.invoiceType === "statement") return "statement_bundle";

  if (row.direction === "payable") {
    if (row.premiumType === "agent_premium" && row.entityType === "agent") {
      return "agent_commission_payable";
    }
    return "other";
  }

  if (row.direction === "receivable") {
    if (row.entityType === "client") return "client_receivable";
    if (row.entityType === "agent") return "agent_receivable";
    return "other";
  }

  return "other";
}

/**
 * Stable display identifier for this record. Prefers the lifecycle
 * setCode (e.g. `2026-3389`) so the same record keeps the same
 * headline through quotation → invoice → debit note → receipt — the
 * documents are listed BELOW as the record's history, not used as
 * the record's identity. Falls back to the row's invoiceNumber if
 * no setCode is available (e.g. `AP-…` rows that don't follow the
 * group-code scheme yet).
 */
export function getStableRecordId(row: InvoiceRow): {
  primary: string;
  /** True when we fell back to the rotating invoiceNumber. */
  isFallback: boolean;
} {
  if (row.setCode) {
    const yearMatch = row.invoiceNumber.match(/-(\d{4})-/);
    const year = yearMatch?.[1] ?? new Date(row.createdAt).getFullYear();
    return { primary: `${year}-${row.setCode}`, isFallback: false };
  }
  return { primary: row.invoiceNumber, isFallback: true };
}

/**
 * Whether this row's `notes` field carries information the user
 * actually needs to read. We hide notes for auto-generated rows
 * where the notes are just a restatement of the policy + premium
 * type (e.g. "Agent commission · POL-2026-1234"). The structured
 * fields already convey that information, so showing the notes
 * adds visual noise without new signal.
 */
export function shouldShowNotes(row: InvoiceRow, category: InvoiceCategory): boolean {
  if (!row.notes) return false;
  const trimmed = row.notes.trim();
  if (!trimmed) return false;
  if (category === "agent_commission_payable") {
    // Auto-generated payables are pattern "Agent commission · <num>".
    if (/^Agent commission\s*[·•·-]?\s*/i.test(trimmed)) return false;
  }
  return true;
}

/**
 * The latest lifecycle entry — i.e. the most recent document the
 * sender produced for this record. Used to render the "current
 * document" tag next to the stable id.
 */
export function getLatestLifecycleEntry(row: InvoiceRow): LifecycleEntry | null {
  if (!row.documentLifecycle || row.documentLifecycle.length === 0) return null;
  return row.documentLifecycle[row.documentLifecycle.length - 1];
}

/**
 * Outstanding cents capped at zero — we use the SAME formula the
 * stats endpoint uses (GREATEST(total - paid, 0)) so the per-row
 * outstanding column never disagrees with the headline card.
 */
export function getOutstandingCents(row: InvoiceRow): number {
  const total = Number(row.totalAmountCents) || 0;
  const paid = Number(row.paidAmountCents) || 0;
  return Math.max(total - paid, 0);
}

/**
 * Should this row render the "Client paid directly" badge?
 * True when the receivable has a counted client-payer payment — the
 * lifecycle the architecture explicitly calls out as "client pays
 * admin directly, admin creates AP commission to agent".
 *
 * We only show the badge on the receivable side: payable rows
 * (AP-…) wouldn't make sense to label this way.
 */
export function shouldShowClientPaidDirectlyBadge(row: InvoiceRow): boolean {
  if (row.direction !== "receivable") return false;
  return row.wasClientPaidDirectly || row.hasClientDirectSubmitted;
}

/**
 * Human-readable warning labels. Centralised here so the dashboard
 * and any future audit page render the same strings.
 */
export const WARNING_LABELS: Record<InvoiceWarning, { title: string; tone: "warn" | "danger" }> = {
  overpaid: { title: "Overpaid — paid amount exceeds total", tone: "danger" },
  orphan_no_policy: { title: "Orphan — no underlying policy", tone: "warn" },
  status_mismatch: { title: "Status / paid amount mismatch", tone: "warn" },
};
