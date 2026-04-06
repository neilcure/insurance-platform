import type { InvoiceStatus, PaymentStatus } from "@/lib/types/accounting";

export function fmtCurrency(cents: number, currency = "HKD"): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  partial: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  submitted: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  cancelled: "bg-neutral-300 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-500",
  refunded: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  statement_created: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
};

export const PAYMENT_STATUS_COLORS: Record<PaymentStatus | string, string> = {
  recorded: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  submitted: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
};

export const ALL_STATUS_COLORS: Record<string, string> = {
  ...INVOICE_STATUS_COLORS,
  ...PAYMENT_STATUS_COLORS,
};

/**
 * Calculate pro-rata refund for a policy cancelled before a given cutoff period.
 * @param totalPremiumCents - Original total premium in cents
 * @param policyStartDate - Policy effective start date
 * @param cancellationDate - Date of cancellation
 * @param policyTermMonths - Full term of the policy in months (default 12)
 * @param refundCutoffMonths - Max months after start that allow refund (default 8)
 * @returns refundCents (0 if outside cutoff), usedMonths, remainingMonths
 */
export function calculateProRataRefund(
  totalPremiumCents: number,
  policyStartDate: string | Date,
  cancellationDate: string | Date,
  policyTermMonths = 12,
  refundCutoffMonths = 8,
): {
  eligible: boolean;
  refundCents: number;
  usedMonths: number;
  remainingMonths: number;
  usedPremiumCents: number;
} {
  const start = new Date(policyStartDate);
  const cancel = new Date(cancellationDate);

  if (cancel <= start) {
    return { eligible: true, refundCents: totalPremiumCents, usedMonths: 0, remainingMonths: policyTermMonths, usedPremiumCents: 0 };
  }

  const diffMs = cancel.getTime() - start.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const totalDays = (policyTermMonths / 12) * 365;

  const usedMonths = Math.ceil(diffDays / 30.44);

  if (usedMonths > refundCutoffMonths) {
    return { eligible: false, refundCents: 0, usedMonths, remainingMonths: Math.max(0, policyTermMonths - usedMonths), usedPremiumCents: totalPremiumCents };
  }

  const usedFraction = Math.min(diffDays / totalDays, 1);
  const usedPremiumCents = Math.round(totalPremiumCents * usedFraction);
  const refundCents = Math.max(0, totalPremiumCents - usedPremiumCents);
  const remainingMonths = Math.max(0, policyTermMonths - usedMonths);

  return { eligible: true, refundCents, usedMonths, remainingMonths, usedPremiumCents };
}

export { resolveInvoicePrefix as getInvoiceTypePrefix } from "@/lib/resolve-prefix";
