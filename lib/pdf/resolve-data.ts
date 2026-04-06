import type { PdfFieldMapping } from "@/lib/types/pdf-template";
import {
  resolveAndFormat,
  type SnapshotData,
  type AccountingLineCtx,
  type InvoiceCtx,
  type StatementCtx,
  type ResolveContext,
} from "@/lib/field-resolver";

export type { SnapshotData };

export type AccountingLineContext = AccountingLineCtx;
export type InvoiceContext = InvoiceCtx;
export type StatementContext = StatementCtx;

export type MergeContext = {
  policyNumber: string;
  createdAt: string;
  snapshot: SnapshotData;
  agent?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  organisation?: Record<string, unknown> | null;
  accountingLines?: AccountingLineContext[];
  invoiceData?: InvoiceContext | null;
  statementData?: StatementContext | null;
  isTpoWithOd?: boolean;
};

function toResolveContext(ctx: MergeContext): ResolveContext {
  const snap = ctx.snapshot ?? {};
  return {
    policyNumber: ctx.policyNumber,
    createdAt: ctx.createdAt,
    snapshot: ctx.snapshot,
    policyExtra: snap as Record<string, unknown>,
    agent: ctx.agent,
    client: ctx.client,
    organisation: ctx.organisation,
    accountingLines: ctx.accountingLines,
    invoiceData: ctx.invoiceData,
    statementData: ctx.statementData,
    isTpoWithOd: ctx.isTpoWithOd,
  };
}

export function resolveFieldValue(
  field: PdfFieldMapping,
  ctx: MergeContext,
): string {
  return resolveAndFormat(
    {
      source: field.source,
      fieldKey: field.fieldKey,
      packageName: field.packageName,
      lineKey: field.lineKey,
      staticValue: field.staticValue,
    },
    toResolveContext(ctx),
    {
      format: field.format,
      currencyCode: field.currencyCode,
      prefix: field.prefix,
      suffix: field.suffix,
    },
  );
}
