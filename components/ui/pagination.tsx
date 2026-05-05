"use client";

/**
 * `<Pagination>` — single page-bar used by every dashboard list/table in
 * this app.
 *
 * See `.cursor/skills/pagination/SKILL.md` for the architecture, the
 * per-page applicability matrix, and verification recipe.
 *
 * Two display modes:
 *   - Wide (sm and up): "Showing 1-50 of 437" + page-size dropdown +
 *     numbered buttons (with truncation) + Prev / Next.
 *   - Narrow (<sm): Prev / "Page X of Y" / Next + page-size icon-dropdown.
 *
 * The component is purely presentational. State (page, pageSize, total)
 * is owned by the caller, typically via `usePagination`.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PAGE_SIZE_OPTIONS,
  type PageSize,
} from "@/lib/pagination/types";

export type PaginationProps = {
  /** 0-based current page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Total row count (across every page). */
  total: number;
  /** When true, the bar disables navigation and shows a spinner next to
   *  the "Showing" label. */
  loading?: boolean;
  /** Called when the user picks a different page (0-based). */
  onPageChange: (page: number) => void;
  /** Called when the user picks a different size. */
  onPageSizeChange: (size: number) => void;
  /** Override the page-size options. Defaults to `PAGE_SIZE_OPTIONS`. */
  pageSizeOptions?: readonly number[];
  /** When true, hide the page-size dropdown entirely. Useful for surfaces
   *  with a fixed cadence (e.g. Audit Log defaults to 30). */
  hidePageSize?: boolean;
  /** Optional label used in "Showing 1-50 of 437 <noun>". Default
   *  "results". */
  itemNoun?: string;
  className?: string;
};

const SIBLING_COUNT = 1;
const ELLIPSIS = "…" as const;

function buildPageList(current: number, totalPages: number): Array<number | typeof ELLIPSIS> {
  if (totalPages <= 1) return [0];

  const firstIdx = 0;
  const lastIdx = totalPages - 1;

  const leftSibling = Math.max(current - SIBLING_COUNT, firstIdx);
  const rightSibling = Math.min(current + SIBLING_COUNT, lastIdx);

  const showLeftEllipsis = leftSibling > firstIdx + 1;
  const showRightEllipsis = rightSibling < lastIdx - 1;

  const out: Array<number | typeof ELLIPSIS> = [firstIdx];
  if (showLeftEllipsis) out.push(ELLIPSIS);
  for (let i = leftSibling; i <= rightSibling; i++) {
    if (i !== firstIdx && i !== lastIdx) out.push(i);
  }
  if (showRightEllipsis) out.push(ELLIPSIS);
  if (lastIdx !== firstIdx) out.push(lastIdx);
  return out;
}

export function Pagination({
  page,
  pageSize,
  total,
  loading,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  hidePageSize,
  itemNoun = "results",
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const firstShown = total === 0 ? 0 : safePage * pageSize + 1;
  const lastShown = Math.min(total, (safePage + 1) * pageSize);

  const pageList = React.useMemo(
    () => buildPageList(safePage, totalPages),
    [safePage, totalPages],
  );

  const canPrev = safePage > 0 && !loading;
  const canNext = safePage + 1 < totalPages && !loading;

  if (total === 0 && !loading) {
    // Caller is responsible for rendering an empty placeholder; we render
    // nothing so the bar doesn't hang under an empty list.
    return null;
  }

  return (
    <div
      className={cn(
        "mt-3 flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800",
        "sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {/* Showing X-Y of Z + size picker */}
      <div className="flex items-center justify-between gap-2 sm:justify-start sm:gap-3">
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : null}
          <span className="whitespace-nowrap">
            {total === 0
              ? `0 ${itemNoun}`
              : `${firstShown.toLocaleString()}\u2013${lastShown.toLocaleString()} of ${total.toLocaleString()} ${itemNoun}`}
          </span>
        </div>
        {!hidePageSize && (
          // Native <select> keeps the trigger compact and matches the
          // height of the prev/next buttons (`h-7`). Width auto-sizes
          // to the longest option.
          <select
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            disabled={loading}
            aria-label="Rows per page"
            className={cn(
              "h-7 rounded-md border border-neutral-300 bg-white px-1.5 text-[11px] text-neutral-900",
              "dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Navigation — wider gaps between Prev / page-numbers / Next so the
       *  three groups read distinctly; tighter spacing within the
       *  page-number row keeps the digits visually grouped. */}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!canPrev}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Previous page"
          className="h-7 px-1.5 text-[11px]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:ml-0.5 sm:inline">Prev</span>
        </Button>

        {/* Mobile: just "Page X of Y" */}
        <span className="px-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 sm:hidden">
          {safePage + 1} / {totalPages}
        </span>

        {/* Desktop: numbered buttons with truncation */}
        <div className="hidden items-center gap-1 sm:flex">
          {pageList.map((p, idx) =>
            p === ELLIPSIS ? (
              <span
                key={`ellipsis-${idx}`}
                className="px-0.5 text-[11px] text-neutral-400"
                aria-hidden="true"
              >
                {ELLIPSIS}
              </span>
            ) : (
              <Button
                key={`page-${p}`}
                type="button"
                size="xs"
                variant={p === safePage ? "default" : "outline"}
                onClick={() => onPageChange(p)}
                disabled={loading}
                aria-current={p === safePage ? "page" : undefined}
                aria-label={`Go to page ${p + 1}`}
                className="h-7 min-w-7 px-1.5 text-[11px]"
              >
                {p + 1}
              </Button>
            ),
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!canNext}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Next page"
          className="h-7 px-1.5 text-[11px]"
        >
          <span className="hidden sm:mr-0.5 sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export type { PageSize };
