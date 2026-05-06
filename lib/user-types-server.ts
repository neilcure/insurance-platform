import "server-only";

/**
 * Server-only loader for user_type metadata.
 *
 * Reads the admin-configurable list from `form_options` group_key
 * `user_types`; falls back to ALL enum values (humanised) when nothing
 * is configured.
 *
 * Use in server components, route handlers, and migrations. Client
 * components must use the `useUserTypes` hook instead — see
 * `hooks/use-user-types.ts`.
 *
 * Lives in its own file (separated from `lib/user-types.ts`) to keep
 * `postgres` out of client bundles. The `"server-only"` directive at
 * the top guarantees a build error if anyone tries to import it from
 * a client component.
 */
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { userTypeEnum } from "@/db/schema/core";
import { and, eq } from "drizzle-orm";
import {
  getDefaultUserTypeOptions,
  humanizeUserType,
  type UserType,
  type UserTypeOption,
} from "./user-types";

export async function loadUserTypeOptions(): Promise<UserTypeOption[]> {
  const rows = await db
    .select({
      value: formOptions.value,
      label: formOptions.label,
      sortOrder: formOptions.sortOrder,
    })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, "user_types"), eq(formOptions.isActive, true)))
    .orderBy(formOptions.sortOrder);

  if (rows.length === 0) return getDefaultUserTypeOptions();

  const enumValues = userTypeEnum.enumValues as readonly string[];
  return rows
    .filter((r) => enumValues.includes(r.value))
    .map((r) => ({
      value: r.value as UserType,
      label: r.label || humanizeUserType(r.value),
      sortOrder: r.sortOrder ?? 0,
    }));
}
