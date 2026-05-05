/**
 * Shared pagination contract used by every dashboard list/table in the app.
 *
 * See `.cursor/skills/pagination/SKILL.md` for the full architecture, the
 * per-page applicability matrix, and verification recipe.
 *
 * Server response shape (every paginated GET endpoint):
 *
 *   { rows: T[], total: number, limit: number, offset: number }
 *
 * Client side reads `total` to render "Showing X-Y of Z" and bound page
 * navigation. `limit`/`offset` are echoed back so the consumer can detect
 * stale responses (e.g. user clicked Next twice fast — only the latest
 * matching offset is rendered).
 */

export type Paginated<T> = {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
};

export type PaginationParams = {
  limit: number;
  offset: number;
};

/**
 * Page sizes a user can pick from in the `<Pagination>` bar.
 *
 * Keep this list short — the dropdown is meant for "small / medium / large /
 * very large", not a continuous slider.
 */
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 50;

/**
 * Hard upper bound any API route MUST clamp `limit` to. Routes can use a
 * lower per-route max (e.g. audit log caps at 200) — this is the floor on
 * the ceiling.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * Type guard for paginated responses. Older endpoints still return a bare
 * array — consumers that haven't been migrated yet should tolerate both
 * shapes via this guard. New code should require the new shape.
 */
export function isPaginatedResponse<T>(value: unknown): value is Paginated<T> {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { rows?: unknown }).rows) &&
    typeof (value as { total?: unknown }).total === "number"
  );
}

/**
 * Server-side helper: parse and clamp `limit` / `offset` from a URL search
 * params bag. Use in every paginated GET handler so the parsing rules stay
 * consistent.
 *
 * @example
 *   const { limit, offset } = parsePaginationParams(url.searchParams, {
 *     defaultLimit: 50,
 *     maxLimit: 500,
 *   });
 */
export function parsePaginationParams(
  searchParams: URLSearchParams,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): PaginationParams {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = opts.maxLimit ?? MAX_PAGE_SIZE;
  const rawLimit = Number(searchParams.get("limit"));
  const rawOffset = Number(searchParams.get("offset"));
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : defaultLimit, 1),
    maxLimit,
  );
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);
  return { limit, offset };
}
