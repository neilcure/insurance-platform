/**
 * Single source of truth for user_type metadata — CLIENT-SAFE PART.
 *
 * The set of legal `user_type` values is owned by the schema enum
 * `userTypeEnum.enumValues` (`db/schema/core.ts`). What's surfaced
 * to pickers, in what order, with what label, can be admin-edited
 * via `form_options` group_key `user_types` — see
 * `lib/user-types-server.ts` for the server loader.
 *
 * USE THIS instead of:
 *   - hand-typed `Record<string, string>` of labels
 *   - hand-typed arrays of allowed user types in any picker
 *   - chained `userType === "admin" || userType === "internal_staff" || ...`
 *     — call `isAdminLikeUserType` instead
 *
 * NOTE: This file is imported by CLIENT components (via the
 * `useUserTypes` hook). Do NOT add DB imports here, or `postgres`
 * will leak into the client bundle. Server-only logic lives in
 * `lib/user-types-server.ts`.
 */
import { userTypeEnum } from "@/db/schema/core";

export type UserType = (typeof userTypeEnum.enumValues)[number];

export type UserTypeOption = {
  value: UserType;
  label: string;
  sortOrder?: number;
};

/**
 * Roles that bypass per-field visibility filters and can see EVERY
 * accounting field by default.
 *
 * INTENTIONALLY HARDCODED. This is a security primitive used in auth
 * checks across the app. Making it admin-editable allows self-lockout
 * (delete `admin` from the list and no human can administer the
 * tenant). If you need to grant another user_type the same privilege,
 * add it here AND audit every call site of `isAdminLikeUserType`.
 *
 * Tracked under `.cursor/skills/dynamic-config-first/SKILL.md` —
 * deliberate exception, not an oversight.
 */
const ADMIN_LIKE: UserType[] = ["admin", "internal_staff", "accounting"];

/** True for back-office roles. Single check instead of ad-hoc
 *  `userType === "admin" || ...` chains. */
export function isAdminLikeUserType(value: string | null | undefined): boolean {
  return !!value && (ADMIN_LIKE as string[]).includes(value);
}

/** Humanise an enum value into a default label
 *  (`internal_staff` → `Internal Staff`). Used as the fallback when
 *  `form_options.user_types` doesn't override the label for a value. */
export function humanizeUserType(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Enum values that exist in the schema for backwards-compatibility but
 * SHOULD NOT appear in admin pickers by default. They mirror the
 * `// Legacy (still in DB but hidden in UI)` comment in
 * `db/schema/core.ts` — keep this list in sync with that comment.
 *
 * Why this isn't in the DB schema: removing values from a Postgres
 * enum requires a destructive migration (`ALTER TYPE … RENAME VALUE`
 * doesn't drop), and historical rows may still reference the value.
 * The legacy values stay legal at the DB level; this list is the
 * UI-side de-emphasis.
 *
 * If an admin explicitly adds a row to `form_options.user_types` for a
 * legacy value (`groupKey="user_types"`, `value="service_provider"`),
 * `loadUserTypeOptions` returns it as configured — admin override wins.
 *
 * Tracked under `.cursor/skills/dynamic-config-first/SKILL.md` as a
 * deliberate, narrow deprecation flag (NOT a business-logic hardcode).
 */
const LEGACY_USER_TYPES: UserType[] = ["service_provider"];

/**
 * Returns the user_types to show in pickers when no `form_options`
 * configuration exists yet. Derived from the schema enum — no
 * hand-typed list of values. Legacy enum values (see
 * `LEGACY_USER_TYPES` above) are excluded so deprecated user types
 * don't surface in admin pickers on a fresh install.
 */
export function getDefaultUserTypeOptions(): UserTypeOption[] {
  const legacy = new Set<string>(LEGACY_USER_TYPES);
  return userTypeEnum.enumValues
    .filter((value) => !legacy.has(value))
    .map((value, idx) => ({
      value,
      label: humanizeUserType(value),
      sortOrder: idx,
    }));
}

/**
 * Resolves a user_type value to its display label, given an optional
 * label map (from `form_options` or a hook). Falls back to humanising
 * the enum value when no label is configured.
 */
export function getUserTypeLabel(
  value: string | null | undefined,
  labelMap?: Record<string, string>,
): string {
  if (!value) return "Unknown";
  return (labelMap && labelMap[value]) || humanizeUserType(value);
}
