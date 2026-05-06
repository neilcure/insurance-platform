import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { loadUserTypeOptions } from "@/lib/user-types-server";

/**
 * Returns the list of user_types to expose in admin pickers.
 *
 * Source order:
 *   1. `form_options` rows with `groupKey = "user_types"` and
 *      `isActive = true` — admin-editable via the existing form-options
 *      admin UI.
 *   2. Fallback: every value in `userTypeEnum.enumValues` with a
 *      humanised default label, when no form_options rows exist yet.
 *
 * The fallback means the app works out of the box on a fresh install
 * without anyone hand-typing a list of user types in code.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  await requireUser();
  const options = await loadUserTypeOptions();
  return NextResponse.json(options, {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
